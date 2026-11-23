/* 抽取层：本地正则（默认，零成本） + 真实 API 接口预留。输出统一数据契约。
   支持两种文本形态：
   1. 标准说明书格式（【标题】分段）——按段落定位字段
   2. 非标准/零散文本——退回逐行正则（旧行为） */
(function (root, factory) {
  const api = factory(
    (typeof module === 'object' && module.exports) ? require('./rules.js') : root.MedRules
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MedExtractor = api;
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  /* ---------- 通用小工具 ---------- */

  function field(value, source) {
    return { value: value || '', source: source || '' };
  }

  // 频次：覆盖 一日2次 / 每日三次 / 每日2-3次 / 早晚各一次 / 睡前 / 顿服 / 分2次服用 / 每12小时1次
  const FREQ_RE = new RegExp(
    '(每日|一日|每天)\\s*[0-9一二三四五六七八九十]+\\s*(?:[-~～至到]\\s*[0-9一二三四五六七八九十]+)?\\s*次' +
    '|早晚各一次|每晚一次|睡前|顿服' +
    '|分[0-9一二三两]+次服用' +
    '|每\\s*[0-9]+\\s*小时\\s*[0-9一两二三四]+\\s*次'
  );

  function findFrequency(text) {
    const m = String(text || '').match(FREQ_RE);
    return m ? m[0] : '';
  }

  // 按需服药（PRN）判定：必须同时满足
  // 1) 固定频次换算失败；2) 段里有按需语义词；3) 整段没有任何频次表达（含区间写法）。
  // 第 3 条用比 FREQ_RE 更宽的 ANY_FREQ_RE：连"分2～3次服用"这类带区间的写法也算
  // 固定方案 —— 区间方案是"次数待定"，按需药是"没有时间表"，两者是完全不同的核对要求。
  const ANY_FREQ_RE = new RegExp(
    '(?:每日|一日|每天|一天)\\s*[0-9一二三四五六七八九十]+\\s*(?:[-~～至到]\\s*[0-9一二三四五六七八九十]+\\s*)?次' +
    '|分[0-9一二三两]+(?:\\s*[-~～至到]\\s*[0-9一二三四五六七八九十]+\\s*)?次服用' +
    '|每\\s*\\d+\\s*(?:[-~～至到]\\s*\\d+\\s*)?小时\\s*[0-9一两二三四]+\\s*次' +
    '|每\\s*\\d+\\s*分钟'
  );
  function isPRN(conv, freqSrc, usageText) {
    if (!conv.needsCheck) return false;
    if (R.detectPRN(freqSrc)) return true;
    return R.detectPRN(usageText) && !ANY_FREQ_RE.test(String(usageText || ''));
  }

  // 多方案检测：用法段里出现两种以上"不同"的频次表达（如 一日1次 / 一日3次），
  // 说明原文按病情或人群给了多套方案。此时即便第一个短语能换算，也不能
  // 假定它适用于所有人 —— 强制挂黄条，把原文交给用户核对。
  // 只做字面去重，不做语义等价判断：一日一次/每日一次算两种字面写法，
  // 但它们换算结果相同，用"归一到次数"来判断是否真的冲突。
  function hasMultipleRegimens(usageText) {
    const s = String(usageText || '');
    const re = /(?:每日|一日|每天|一天|每\s*\d+\s*小时)\s*[0-9一二三四五六七八九十]+\s*(?:[-~～至到]\s*[0-9一二三四五六七八九十]+\s*)?次|早晚各一次|每晚一次|睡前|顿服|分[0-9一二三两]+次服用/g;
    const counts = new Set();
    let m;
    while ((m = re.exec(s)) !== null) {
      const phrase = m[0].replace(/\s+/g, '');
      // 归一到每日次数：每12小时1次 -> 2次；其余取短语里的数字
      let c = null;
      const h = phrase.match(/每(\d+)小时1次/);
      if (h) {
        const hours = parseInt(h[1], 10);
        if (hours === 6 || hours === 8 || hours === 12 || hours === 24) c = 24 / hours;
      } else {
        const num = phrase.match(/(?:每日|一日|每天|一天|分)([0-9一二三四五六七八九十两]+)次/);
        if (num) {
          const raw = num[1];
          c = /^[0-9]$/.test(raw) ? parseInt(raw, 10) : ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 }[raw] || null);
        }
        if (phrase === '早晚各一次') c = 2;
        if (phrase === '顿服' || phrase === '睡前' || phrase === '每晚一次') c = 1;
      }
      if (c != null) counts.add(c);
    }
    return counts.size > 1;
  }

  /* ---------- 标准格式：【标题】分段解析 ---------- */

  // 把 【标题】...【下一个标题】 切成 { 标题: 内容 }。无【】或只有一段时返回空对象。
  // 只认行首标题：正文里的交叉引用（如「请参照【用法用量】」「见【用法用量】」）
  // 不是新段落，若按任意位置切段会把原段截断，导致用法用量被抓成空或后半段。
  function parseSections(text) {
    const map = {};
    const re = /^[ \t]*【([^【】]{1,20})】/gm;
    const marks = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      marks.push({ title: m[1].trim(), start: m.index + m[0].length, end: -1 });
      if (marks.length > 1) marks[marks.length - 2].end = m.index;
    }
    if (marks.length < 2) return map;
    marks.forEach(function (s) {
      map[s.title] = text.slice(s.start, s.end === -1 ? text.length : s.end).trim();
    });
    return map;
  }

  function firstMeaningfulLine(sectionText) {
    const lines = String(sectionText || '').split('\n')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !/^[-—=]+$/.test(s); });
    return lines.length ? lines[0] : '';
  }

  /* ---------- 非标准格式的旧正则 ---------- */

  const FIELD_PATTERNS = {
    drug_name: /(?:通用名称|药品名称|通用名|名称)[：:\s]*([^\n【】]+)/,
    specification: /(?:规格)[：:\s]*([^\n【】]+)/,
    dosage: /(?:用法用量|用法用量：)[：:\s]*([^\n【】]+)/,
    contraindications: /(?:禁忌)[：:\s]*([^\n【】]+)/,
    adverse: /(?:不良反应)[：:\s]*([\s\S]*?)(?=\n{0,2}(?:【|注意事项|禁忌|贮藏|有效期|生产企业|批准文号)[：:【]|$)/,
    indications: /(?:适应症)[：:\s]*([^\n【】]+)/
  };

  function grab(text, key) {
    const m = text.match(FIELD_PATTERNS[key]);
    return m ? m[1].trim() : '';
  }

  /* ---------- 主流程 ---------- */

  // 本地抽取：不做医学判断，只做文本定位 + 规则层换算。
  function extractLocal(text, options) {
    const opt = options || {};
    const raw = String(text == null ? '' : text);
    const sections = parseSections(raw);
    const standard = Object.keys(sections).length >= 2;

    let drugLine = '', specLine = '', usageLine = '', contraLine = '', adverseFull = '';
    // 严重警示扫描范围：不良反应 + 注意事项。很多严重警示写在注意事项里
    // （如阿莫西林"抽搐"），只读不良反应段会漏报。
    let severeScanText = '';
    let drugName = '';

    if (standard) {
      const nameSec = sections['药品名称'] || sections['通用名称'] || '';
      // 药品名称段落里优先取"通用名称："一行，其次首行
      const generic = nameSec.match(/(?:通用名称|通用名)[：:\s]*([^\n]+)/);
      drugName = generic ? generic[1].trim() : firstMeaningfulLine(nameSec);
      drugLine = nameSec;
      specLine = sections['规格'] || '';
      usageLine = sections['用法用量'] || '';
      contraLine = sections['禁忌'] || '';
      adverseFull = sections['不良反应'] || '';
      severeScanText = [adverseFull, sections['注意事项'] || ''].filter(Boolean).join('\n');
    } else {
      drugLine = grab(raw, 'drug_name');
      specLine = grab(raw, 'specification');
      usageLine = grab(raw, 'dosage');
      contraLine = grab(raw, 'contraindications');
      adverseFull = grab(raw, 'adverse');
      severeScanText = adverseFull;
      drugName = drugLine.split(/[（(]/)[0].trim();
    }

    // 用量：优先"一次…"句式；没有就用用法段落首句
    let dosageVal = '';
    const dosageMatch = usageLine.match(/一次\s*([^，,。；;\n]+)/);
    if (dosageMatch) {
      dosageVal = dosageMatch[1].trim();
    } else {
      const firstSentence = usageLine.split(/。|\n/)[0];
      dosageVal = firstSentence ? firstSentence.trim() : '';
    }

    const freqSrc = findFrequency(usageLine) || usageLine.slice(0, 60);
    const conv = R.convertFrequency(freqSrc);
    // 时段词可能写在用量句而不是频次短语里（如"每日早晨口服一片"），
    // 所以从整段用法用量再取一次，避免"早晨"被换算成 08:00 后丢失。
    const timingHint = conv.timingHint || R.detectTimingHint(usageLine);
    const multiRegimen = standard && hasMultipleRegimens(usageLine);
    // 按需服药识别：先固定、后按需，且整段无固定频次表达才成立。
    const prn = isPRN(conv, freqSrc, usageLine);

    const record = {
      drug_name: field(drugName, drugLine.slice(0, 80)),
      specification: field(specLine.split('\n')[0].trim(), specLine.slice(0, 80)),
      dosage: field(dosageVal, usageLine.slice(0, 200)),
      frequency: Object.assign(field(freqSrc, freqSrc), {
        times: conv.times,
        timeExample: conv.times.length ? conv.times.join(' / ') : '',
        needsCheck: conv.needsCheck,
        timingHint: timingHint,
        // 多方案时时间示例保留（用户仍能看到），但标记需核对，不假装是唯一答案。
        multiRegimen: multiRegimen,
        prn: prn
      }),
      contraindications: contraLine
        ? contraLine.split(/[，,。；;\n]/).map(function (s) { return s.trim(); }).filter(Boolean)
        : [],
      adverse: {
        severe: R.locateSevere(severeScanText),
        common: R.locateCommon(adverseFull),
        full: adverseFull
      },
      ocr_confidence: opt.ocrConfidence != null ? opt.ocrConfidence : 1,
      image_blurry: opt.imageBlurry === true,
      source_text: raw,
      mode: 'local',
      disclaimers: [
        '仅帮您看清说明书原文，不提供用药建议，请以纸质说明书和医嘱为准。',
        '时间点为常见时间示例，仅供参考，请自行核对，不是医嘱。',
        '严重警示为原文关键词定位，非医学分级。',
        '请凭药盒和药名确认，不要凭颜色形状认药。'
      ]
    };

    const check = R.needsHumanCheck(record);
    record.needs_human_check = check.flag;
    record.check_reasons = check.reasons;
    return record;
  }

  // 真实 API 预留：填入 endpoint 后走 POST。默认不启用，保持 0 成本。
  async function extractWithAPI(text, config) {
    if (!config || !config.endpoint) return extractLocal(text);
    const resp = await fetch(config.endpoint, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, config.headers || {}),
      body: JSON.stringify({
        prompt: '你是药品说明书信息抽取助手。只抽取原文出现的字段，不推断、不补充；没有填null。只输出JSON，字段：drug_name,specification,dosage,frequency,contraindications,adverse_full。每个字段带source原文片段。',
        text: text
      })
    });
    if (!resp.ok) throw new Error('API 请求失败：' + resp.status);
    const data = await resp.json();
    // API 结果仍要过本地规则层校验，避免模型幻觉直接进卡片。
    const merged = extractLocal(text);
    const src = data.result || data;
    ['drug_name', 'specification', 'dosage'].forEach(function (k) {
      if (src[k]) merged[k] = field(src[k].value || src[k], src[k].source || '');
    });
    if (src.frequency) {
      const fv = src.frequency.value || src.frequency;
      const c = R.convertFrequency(fv);
      // API 频次同样按"先固定、后按需"分类，与本地路径口径一致。
      const prn = isPRN(c, fv, merged.source_text) || merged.frequency.prn;
      merged.frequency = Object.assign(field(fv, fv), {
        times: c.times,
        timeExample: c.times.join(' / '),
        needsCheck: c.needsCheck,
        timingHint: c.timingHint || merged.frequency.timingHint,
        prn: prn
      });
    }
    merged.mode = 'api';
    const check = R.needsHumanCheck(merged);
    merged.needs_human_check = check.flag;
    merged.check_reasons = check.reasons;
    return merged;
  }

  return { extractLocal: extractLocal, extractWithAPI: extractWithAPI, parseSections: parseSections, findFrequency: findFrequency };
});
