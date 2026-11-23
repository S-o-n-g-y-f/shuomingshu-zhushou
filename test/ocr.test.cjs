const assert = require('node:assert/strict');
const O = require('../src/ocr.js');

function t(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; }
}

// —— 提示词安全：只抄录，不解读 ——
t('系统提示词要求逐字抄录', () => {
  assert.ok(O.OCR_SYSTEM_PROMPT.includes('逐字抄录'));
});
t('系统提示词明令禁止解释/总结/改写/补充', () => {
  for (const w of ['不许解释', '不许总结', '不许改写', '不许补充']) {
    assert.ok(O.OCR_SYSTEM_PROMPT.includes(w), '缺少禁令: ' + w);
  }
});
t('系统提示词要求看不清输出占位符而非猜测', () => {
  assert.ok(O.OCR_SYSTEM_PROMPT.includes('【看不清】'));
});
t('系统提示词不含任何医疗判断字眼', () => {
  for (const w of ['建议', '剂量', '适应', '禁忌', '相互作用', '服药']) {
    assert.ok(!O.OCR_SYSTEM_PROMPT.includes(w), '出现医疗字眼: ' + w);
  }
});

// —— 消息构造：system 必须第一条，图片走 image_url ——
t('buildOcrMessages 第一条是 system', () => {
  const m = O.buildOcrMessages('data:image/jpeg;base64,xxx');
  assert.equal(m[0].role, 'system');
  assert.equal(m[1].role, 'user');
});
t('buildOcrMessages 用户消息含图片与文字', () => {
  const m = O.buildOcrMessages('data:image/jpeg;base64,xxx');
  const parts = m[1].content;
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[1].type, 'image_url');
  assert.equal(parts[1].image_url.url, 'data:image/jpeg;base64,xxx');
});

// —— 结果清理：只动格式不动内容 ——
t('cleanOcrText 去掉代码围栏', () => {
  assert.equal(O.cleanOcrText('```\n阿莫西林胶囊\n```'), '阿莫西林胶囊');
});
t('cleanOcrText 去掉包裹引号', () => {
  assert.equal(O.cleanOcrText('"阿莫西林胶囊 0.25g"'), '阿莫西林胶囊 0.25g');
});
t('cleanOcrText 保留正文与换行', () => {
  const src = '阿莫西林胶囊\n0.25g\n口服。一次 0.5g（2 粒）';
  assert.equal(O.cleanOcrText(src), src);
});
t('cleanOcrText 空输入返回空串', () => {
  assert.equal(O.cleanOcrText(''), '');
  assert.equal(O.cleanOcrText(null), '');
});

// —— 视觉模型挑选：不猜测，没有明确支持图片就是没有 ——
t('pickVisionModel 挑选 supportsImages 的可用模型', () => {
  const m = O.pickVisionModel([
    { id: 'a', disabled: true, supportsImages: true },
    { id: 'b', supportsImages: true },
    { id: 'c' }
  ]);
  assert.equal(m.id, 'b');
});
t('pickVisionModel 没有视觉模型返回 null', () => {
  assert.equal(O.pickVisionModel([{ id: 'a' }]), null);
  assert.equal(O.pickVisionModel([]), null);
  assert.equal(O.pickVisionModel(null), null);
});

// —— 错误提示：全部引导回手动粘贴，不出现技术术语 ——
t('ocrErrorMessage 按错误码映射且都提到可粘贴', () => {
  const codes = ['quota_exceeded', 'auth_origin_mismatch', 'request_stream_required', 'gateway_timeout', 'whatever'];
  for (const c of codes) {
    const msg = O.ocrErrorMessage({ error: { code: c } });
    assert.ok(msg.includes('粘贴'), c + ' 未引导到粘贴: ' + msg);
    assert.ok(!msg.includes('Origin') && !msg.includes('gateway'), c + ' 泄漏技术词');
  }
});
t('ocrErrorMessage 对无 error 对象安全', () => {
  assert.ok(O.ocrErrorMessage(null).includes('粘贴'));
});

// —— 每日限流：可注入 store 的纯逻辑 ——
function fakeStore() {
  const map = {};
  return { getItem: (k) => (k in map ? map[k] : null), setItem: (k, v) => { map[k] = String(v); } };
}
const day1 = new Date(2026, 10, 23, 10, 0, 0);
const day2 = new Date(2026, 10, 24, 9, 0, 0);

t('限额内允许，用满 30 次后拒绝', () => {
  const s = fakeStore();
  assert.equal(O.quotaInfo(s, day1).ok, true);
  for (let i = 0; i < O.DAILY_LIMIT; i++) O.bumpQuota(s, day1);
  const q = O.quotaInfo(s, day1);
  assert.equal(q.used, O.DAILY_LIMIT);
  assert.equal(q.ok, false);
});
t('跨天自动重置', () => {
  const s = fakeStore();
  for (let i = 0; i < O.DAILY_LIMIT; i++) O.bumpQuota(s, day1);
  assert.equal(O.quotaInfo(s, day2).ok, true);
});
t('损坏的存储记录当作 0 处理不崩溃', () => {
  const s = fakeStore();
  s.setItem('med_ocr_usage_v1', '{broken json');
  const q = O.quotaInfo(s, day1);
  assert.equal(q.used, 0);
  assert.equal(q.ok, true);
});
t('store 为 null 时安全返回', () => {
  assert.equal(O.quotaInfo(null, day1).ok, true);
  O.bumpQuota(null, day1); // 不抛异常即可
});

console.log('OCR 模块测试完成');
