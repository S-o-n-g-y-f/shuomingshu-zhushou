/*
 * OCR 模块：拍照后用 AI 视觉模型逐字抄录说明书文字。
 * 设计红线（不可突破）：
 * 1. AI 只做"把照片变成文字"这一件事，提示词禁止任何解读、总结、补充；
 * 2. 识别结果必须进现有核对层，且在核对页明示"来自 AI 识别，请逐字核对"；
 * 3. 识别是可选步骤：任何失败都回退到手动粘贴，绝不阻塞主流程；
 * 4. 客户端限流，防止配额被打爆。
 */
(function (root) {
  'use strict';

  // —— 纯常量：提示词。只抄录，不判断，不换算，不解释。——
  const OCR_SYSTEM_PROMPT =
    '你是文字抄录工具。把用户给的药品说明书或药盒照片里的所有文字逐字抄录下来，保持原来的行顺序。' +
    '不许解释，不许总结，不许改写，不许补充照片里没有的内容；看不清的字或行，在对应位置原样输出【看不清】。' +
    '除了抄录的文字本身，不要输出任何其他内容。';

  const OCR_USER_PROMPT = '请逐字抄录这张照片里的全部文字。';

  // 多张照片：结构指令（归组/排序/合并）不是医疗解读，仍属"把照片变成文字"
  const OCR_MULTI_USER_PROMPT =
    '这些照片可能拍的是同一份药品说明书的连续几页。请逐字抄录照片里的文字：' +
    '如果几张照片属于同一份说明书，按正常阅读顺序合并成一份完整文字，重复出现的内容只保留一份，保持行序；' +
    '如果某张照片显然不是同一份说明书的，忽略那张照片。只输出抄录的文字。';

  const MAX_PHOTOS = 4;

  const DAILY_LIMIT = 30;
  const USAGE_KEY = 'med_ocr_usage_v1';

  // —— 纯函数：构造消息。system 必须是第一条（云服务 SDK 硬性要求）。——
  function buildOcrMessages(dataUrl) {
    return [
      { role: 'system', content: OCR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: OCR_USER_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ];
  }

  function buildOcrMultiMessages(dataUrls) {
    const imgs = (Array.isArray(dataUrls) ? dataUrls : []).slice(0, MAX_PHOTOS);
    const parts = [{ type: 'text', text: OCR_MULTI_USER_PROMPT }];
    imgs.forEach(function (u) { parts.push({ type: 'image_url', image_url: { url: u } }); });
    return [
      { role: 'system', content: OCR_SYSTEM_PROMPT },
      { role: 'user', content: parts }
    ];
  }

  // —— 纯函数：只做保守清理（代码围栏、首尾空白、包裹引号），不改一个字。——
  function cleanOcrText(raw) {
    let t = String(raw == null ? '' : raw);
    t = t.replace(/^\s*```[a-zA-Z0-9]*\s*\n?/, '').replace(/\n?\s*```\s*$/, '');
    t = t.replace(/^\s*"([\s\S]*)"\s*$/, '$1');
    return t.trim();
  }

  // —— 纯函数：从模型列表里挑视觉模型。不猜测：没有明确 supportsImages === true 就是没有。——
  function pickVisionModel(models) {
    const list = Array.isArray(models) ? models : [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m && m.disabled !== true && m.supportsImages === true) return m;
    }
    return null;
  }

  // —— 纯函数：错误码 -> 老人能看懂的提示。任何失败都引导回手动粘贴。——
  function ocrErrorMessage(err) {
    const code = (err && err.error && err.error.code) ? String(err.error.code) : '';
    if (code === 'model_no_vision') return '当前没有可用的文字识别模型，请直接粘贴说明书文字。';
    if (code.indexOf('quota_') === 0) return '今天的识别次数用完了，请明天再试，或直接粘贴说明书文字。';
    if (code.indexOf('auth_') === 0) return '识别服务暂时连不上，请直接粘贴说明书文字。';
    if (code.indexOf('request_') === 0) return '这张照片没法识别（可能太大或格式不对），请重新拍一张，或直接粘贴文字。';
    if (code.indexOf('gateway_') === 0 || code.indexOf('model_') === 0) return '识别服务忙，请稍等几秒再试一次，或直接粘贴文字。';
    return '识别失败，请直接粘贴说明书文字。';
  }

  // —— 纯函数：每日限流。store 可注入（浏览器传 localStorage，测试传假对象）。——
  function dateKey(d) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function quotaInfo(store, now) {
    const today = dateKey(now);
    let used = 0;
    try {
      const raw = store ? store.getItem(USAGE_KEY) : null;
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.date === today && typeof saved.count === 'number') used = saved.count;
      }
    } catch (e) { used = 0; }
    return { ok: used < DAILY_LIMIT, used: used, left: Math.max(0, DAILY_LIMIT - used) };
  }

  function bumpQuota(store, now) {
    if (!store) return;
    const info = quotaInfo(store, now);
    try {
      store.setItem(USAGE_KEY, JSON.stringify({ date: dateKey(now), count: info.used + 1 }));
    } catch (e) { /* 存不了也不阻塞识别 */ }
  }

  // —— 浏览器部分：图片压缩 + 云端调用。——
  const OCR_CONFIG = {
    endpoint: 'https://med-reader-55704.app.workbuddy.host',
    publishableKey: 'wbpk_sKg5deUK7kbF7aE0xmwKmr_jptBySxFnMiG56S2LOS4UWNDaBp96n22'
  };

  let client = null;
  let visionModelId = null;

  function isAvailable() {
    return typeof WorkBuddyCloud !== 'undefined' &&
      WorkBuddyCloud && typeof WorkBuddyCloud.createWorkBuddyCloud === 'function';
  }

  function ensureClient() {
    if (!client) {
      if (!isAvailable()) return null;
      client = WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: OCR_CONFIG.endpoint,
        publishableKey: OCR_CONFIG.publishableKey
      });
    }
    return client;
  }

  // 压到长边 maxEdge 以内再发，省流量也稳。
  function resizeImageToDataUrl(dataUrl, maxEdge, quality) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          const scale = Math.min(1, maxEdge / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', quality));
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('image load failed')); };
      img.src = dataUrl;
    });
  }

  // —— 共用内部步骤 ——
  function ensureVisionModel(c) {
    if (visionModelId) return Promise.resolve(visionModelId);
    return c.llm.models.list().then(function (models) {
      const m = pickVisionModel(models);
      if (!m) throw { error: { code: 'model_no_vision' } };
      visionModelId = m.id;
      return visionModelId;
    });
  }

  async function streamText(messages) {
    let out = '';
    for await (const chunk of client.llm.chat.completions.create({
      model: visionModelId,
      messages: messages,
      stream: true
    })) {
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (delta && delta.content) out += delta.content;
    }
    return out;
  }

  // 主入口（单张）：dataUrl -> { ok:true, text } | { ok:false, message }
  async function recognize(dataUrl) {
    const store = (typeof localStorage !== 'undefined') ? localStorage : null;
    const now = new Date();
    const q = quotaInfo(store, now);
    if (!q.ok) {
      return { ok: false, message: '今天的识别次数用完了（每天 ' + DAILY_LIMIT + ' 次），请直接粘贴说明书文字。' };
    }

    const c = ensureClient();
    if (!c) return { ok: false, message: '识别组件没有加载成功，请直接粘贴说明书文字。' };

    try { await ensureVisionModel(c); }
    catch (e) { return { ok: false, message: ocrErrorMessage(e) }; }

    let small;
    try { small = await resizeImageToDataUrl(dataUrl, 1600, 0.85); }
    catch (e) { small = dataUrl; }

    let out = '';
    try { out = await streamText(buildOcrMessages(small)); }
    catch (e) { return { ok: false, message: ocrErrorMessage(e) }; }

    const text = cleanOcrText(out);
    if (!text) return { ok: false, message: '没认出文字，请换一张清楚一点的照片，或直接粘贴文字。' };

    bumpQuota(store, now);
    return { ok: true, text: text };
  }

  // 主入口（多张，同一份说明书归组合并）：dataUrls -> { ok, text | message }
  async function recognizeMany(dataUrls) {
    const imgs = (Array.isArray(dataUrls) ? dataUrls : []).slice(0, MAX_PHOTOS);
    if (imgs.length === 0) return { ok: false, message: '请先选择照片。' };
    if (imgs.length === 1) return recognize(imgs[0]);

    const store = (typeof localStorage !== 'undefined') ? localStorage : null;
    const now = new Date();
    if (!quotaInfo(store, now).ok) {
      return { ok: false, message: '今天的识别次数用完了（每天 ' + DAILY_LIMIT + ' 次），请直接粘贴说明书文字。' };
    }

    const c = ensureClient();
    if (!c) return { ok: false, message: '识别组件没有加载成功，请直接粘贴说明书文字。' };

    try { await ensureVisionModel(c); }
    catch (e) { return { ok: false, message: ocrErrorMessage(e) }; }

    let smalls = [];
    try {
      smalls = await Promise.all(imgs.map(function (u) { return resizeImageToDataUrl(u, 1280, 0.85); }));
    } catch (e) { smalls = imgs; }

    let out = '';
    try { out = await streamText(buildOcrMultiMessages(smalls)); }
    catch (e) { return { ok: false, message: ocrErrorMessage(e) }; }

    const text = cleanOcrText(out);
    if (!text) return { ok: false, message: '没认出文字，请换几张清楚一点的照片，或直接粘贴文字。' };

    bumpQuota(store, now);
    return { ok: true, text: text, photos: imgs.length };
  }

  const api = {
    OCR_SYSTEM_PROMPT: OCR_SYSTEM_PROMPT,
    OCR_USER_PROMPT: OCR_USER_PROMPT,
    OCR_MULTI_USER_PROMPT: OCR_MULTI_USER_PROMPT,
    MAX_PHOTOS: MAX_PHOTOS,
    DAILY_LIMIT: DAILY_LIMIT,
    buildOcrMessages: buildOcrMessages,
    buildOcrMultiMessages: buildOcrMultiMessages,
    cleanOcrText: cleanOcrText,
    pickVisionModel: pickVisionModel,
    ocrErrorMessage: ocrErrorMessage,
    quotaInfo: quotaInfo,
    bumpQuota: bumpQuota,
    isAvailable: isAvailable,
    recognize: recognize,
    recognizeMany: recognizeMany
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MedOCR = api;
})(typeof window !== 'undefined' ? window : this);
