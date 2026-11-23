/* 规则层：确定性、可单测。所有时间换算与严重警示定位都在此，不交给 LLM 推断。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MedRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 常见时间示例：仅展示，不是医嘱。用户可编辑。
  const TIME_PRESETS = {
    '每日一次': ['08:00'],
    '一日一次': ['08:00'],
    '每天一次': ['08:00'],
    '每日二次': ['08:00', '20:00'],
    '每日两次': ['08:00', '20:00'],
    '一日二次': ['08:00', '20:00'],
    '一天两次': ['08:00', '20:00'],
    '每日三次': ['08:00', '13:00', '18:00'],
    '一日三次': ['08:00', '13:00', '18:00'],
    '一天三次': ['08:00', '13:00', '18:00'],
    '每日四次': ['08:00', '12:00', '16:00', '20:00'],
    '一日五次': ['06:00', '10:00', '14:00', '18:00', '22:00'],
    '睡前': ['21:00'],
    '每晚一次': ['21:00'],
    '晚间一次': ['21:00'],
    '早晚各一次': ['08:00', '20:00'],
    '分二次服用': ['08:00', '20:00'],
    '分三次服用': ['08:00', '13:00', '18:00'],
    '分四次服用': ['08:00', '12:00', '16:00', '20:00'],
    // 「顿服」是规范药学术语：把一天的剂量一次服完，即每日一次。含义唯一，可安全换算。
    '顿服': ['08:00']
  };

  // 次数 -> 时间示例。只做确定性映射，不推测。
  const COUNT_TIMES = {
    1: ['08:00'],
    2: ['08:00', '20:00'],
    3: ['08:00', '13:00', '18:00'],
    4: ['08:00', '12:00', '16:00', '20:00'],
    5: ['06:00', '10:00', '14:00', '18:00', '22:00']
  };

  const CN_DIGITS = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 };
  function toCount(raw) {
    if (/^[0-9]$/.test(raw)) return parseInt(raw, 10);
    return CN_DIGITS[raw] || 0;
  }

  // 严重警示关键词：原文命中即原句前置，不做医学分级、不改写。
  const SEVERE_KEYWORDS = [
    '过敏性休克', '休克', '呼吸困难', '喉头水肿', '血管性水肿',
    '严重皮疹', '剥脱性皮炎', '重症多形红斑', '史蒂文斯', '斯约',
    '肝功能异常', '肝衰竭', '黄疸', '粒细胞缺乏', '白细胞减少',
    '血小板减少', '出血', '心律失常', '抽搐', '意识障碍',
    '急性肾损伤', '肾功能衰竭', '横纹肌溶解', '再生障碍性贫血'
  ];

  const COMMON_MARKERS = ['常见', '较常见', '偶见', '少见', '多见'];

  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/\s+/g, '')
      .replace(/[（）()]/g, '')
      .replace(/[，,、；;。]/g, '');
  }

  // 原文明确写出的服药时段。这是说明书要求，不是可随意替换的示例时间。
  const TIMING_WORDS = [
    ['早晨', /早晨|早上|清晨|晨起/],
    ['上午', /上午/],
    ['中午', /中午/],
    ['晚间', /晚间|晚上|每晚/],
    ['睡前', /睡前/],
    ['饭前', /饭前|餐前/],
    ['饭后', /饭后|餐后/],
    ['随餐', /与餐同服|随餐|餐时|进餐时/]
  ];
  function detectTimingHint(src) {
    const hits = TIMING_WORDS.reduce(function (acc, pair) {
      if (pair[1].test(src) && acc.indexOf(pair[0]) === -1) {
        acc.push(pair[0]);
      }
      return acc;
    }, []);
    // "饭前或饭后"意思是二选一，不能提示成两个时段都要做到。
    const i = hits.indexOf('饭前');
    const j = hits.indexOf('饭后');
    if (i !== -1 && j !== -1) {
      hits.splice(Math.max(i, j), 1);
      hits.splice(Math.min(i, j), 1, '饭前或饭后');
    }
    return hits.join('、');
  }

  // 从频次原文中提取常见时间示例。返回 {times, matched, needsCheck, timingHint}
  // timingHint 保留原文时段要求（如"早晨"）；times 只是便于理解的示例，不是医嘱。
  function convertFrequency(text) {
    const src = String(text == null ? '' : text).trim();
    const timingHint = detectTimingHint(src);
    function ret(times, matched, needsCheck) {
      return { times: times, matched: matched, needsCheck: needsCheck, timingHint: timingHint };
    }
    if (!src) return ret([], '', true);
    const n = normalize(src);
    // 精确短语优先，长词先匹配，避免"每日一次"被"每日"截断
    const phrases = Object.keys(TIME_PRESETS).sort((a, b) => b.length - a.length);
    const hit = phrases.find(function (p) { return n.indexOf(p) !== -1; });
    if (hit) return ret(TIME_PRESETS[hit].slice(), hit, false);
    // 阿拉伯数字写法：每日 3 次 / 一天2次
    const m = n.match(/(?:每日|一日|每天|一天)(\d+)次/);
    if (m && COUNT_TIMES[parseInt(m[1], 10)]) {
      const count = parseInt(m[1], 10);
      return ret(COUNT_TIMES[count].slice(), m[0], false);
    }
    // 每 12 小时 1 次 / 每8小时1次：间隔能整除一天，换算为等间隔时间点。
    // 仅接受 6/8/12/24 小时且后接 1 次 —— 其他写法不猜。
    const h = n.match(/每(\d+)小时1次/);
    if (h && [6, 8, 12, 24].indexOf(parseInt(h[1], 10)) !== -1) {
      const count = 24 / parseInt(h[1], 10);
      return ret(COUNT_TIMES[count].slice(), h[0], false);
    }
    // "1日1次" 这类日频次写法（前面是数字而非"一"）
    const d = n.match(/(\d+)日(\d+)次/);
    if (d && COUNT_TIMES[parseInt(d[2], 10)]) {
      const count = parseInt(d[2], 10);
      return ret(COUNT_TIMES[count].slice(), d[0], false);
    }
    // 每日一次的同义写法：每日口服1次 / 每日早晨口服一片 / 每天1片 / 每日仅需服用一粒
    // 中文"一"与阿拉伯数字"1"都接受；只认单剂量结构，剂量区间（1-2片）不在此列。
    // "早晨"等时段词由 timingHint 单独保留，不因换算成 08:00 而丢失。
    const once = n.match(/每(?:日|天)(?:早晨口服|早晨|仅需服用|服用|口服)?([1一])(?:次|片|粒)/);
    if (once) return ret(COUNT_TIMES[1].slice(), once[0], false);
    // "每日一次" 前面带适应症文字时，phrase 表已按归一化命中；这里兜底
    // "一次一片" 这类以单次剂量开始的写法（配合每日/每天）。
    const once2 = n.match(/每(?:日|天)[^0-9一二三四五六七八九十]{0,10}一次/);
    if (once2) return ret(COUNT_TIMES[1].slice(), once2[0], false);
    // 「早餐时一次服用」：早餐时 + 一次 = 每日一次（如乳果糖）。时段要求由 timingHint 保留。
    const breakfast = n.match(/(?:早餐|早晨|早上)[^0-9]{0,4}一次/);
    if (breakfast) return ret(COUNT_TIMES[1].slice(), breakfast[0], false);
    // "分三次服用" / "顿服" 已在 phrases 表；"一日五次"数字写法补这里
    const f = n.match(/(?:每日|一日|每天|一天)(\d+)次服用/);
    if (f && COUNT_TIMES[parseInt(f[1], 10)]) {
      const count = parseInt(f[1], 10);
      return ret(COUNT_TIMES[count].slice(), f[0], false);
    }
    return ret([], '', true);
  }

  // 按需服药（PRN）识别：这类药本来就不按固定时间表吃——疼了才吃、发作了才含服。
  // 原文没有固定频次却有明确的"按需"语义时，正确输出是「按需服用」类别，
  // 而不是笼统的"无法换算请核对"——后者让用户以为工具没看懂，前者才是准确答案。
  // 只在固定频次换算失败后才调用（先固定、后按需），避免覆盖正常方案。
  function detectPRN(usageText) {
    const s = String(usageText || '');
    if (!s) return false;
    return /必要时|需要时|可重复|发作时|疼痛时|疼痛缓解|24小时内(?:不得|不)超过|预防性使用|应急|急救/.test(s);
  }

  // 把不良反应原文切成句子（保留原句，不改写）
  function splitSentences(text) {
    return String(text == null ? '' : text)
      .split(/[。；;\n]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  // 严重警示定位：命中关键词的原句原样返回。纯匹配，不判断严重程度。
  function locateSevere(adverseText) {
    const sentences = splitSentences(adverseText);
    const severe = [];
    const seen = Object.create(null);
    sentences.forEach(function (s) {
      const hit = SEVERE_KEYWORDS.find(function (k) { return s.indexOf(k) !== -1; });
      if (hit && !seen[s]) {
        seen[s] = true;
        severe.push({ text: s, keyword: hit });
      }
    });
    return severe;
  }

  // 常见反应：带"常见/偶见"等标记的原句，最多取 3 条，一句话带过。
  function locateCommon(adverseText) {
    const sentences = splitSentences(adverseText);
    return sentences
      .filter(function (s) { return COMMON_MARKERS.some(function (k) { return s.indexOf(k) !== -1; }); })
      .slice(0, 3);
  }

  // 安全门槛：这些情况必须挂黄条"请确认或咨询药师"
  function needsHumanCheck(record) {
    const reasons = [];
    if (!record || typeof record !== 'object') return { flag: true, reasons: ['无记录'] };
    const mustHave = ['drug_name', 'dosage', 'frequency'];
    mustHave.forEach(function (k) {
      const f = record[k];
      if (!f || !f.value || !String(f.value).trim()) reasons.push('关键字段缺失：' + k);
    });
    // 出处校验：source 是截断到 200 字的展示片段，value 可能落在截断之后（如美托洛尔
    // 的 50-100mg 在原段后半部分）。用完整原文 source_text 兜底，避免把正确的抽取
    // 误判成"无出处"而亮黄条。source_text 缺失时才退回 source。
    const fullText = String(record.source_text || '');
    ['drug_name', 'dosage', 'frequency'].forEach(function (k) {
      const f = record[k];
      if (!f || !f.value) return;
      const pool = fullText || String(f.source || '');
      if (pool && pool.indexOf(String(f.value)) === -1) {
        reasons.push('字段无原文出处：' + k);
      }
    });
    // 频次无法换算才挂黄条。按需服药（prn）没有固定时间表不是"看不懂"，
    // 而是这类药的正确用法本身——由界面展示「按需服用」类别，不算需人工确认。
    if (record.frequency && record.frequency.times && record.frequency.times.length === 0 && !record.frequency.prn) {
      reasons.push('频次无法换算为时间示例');
    }
    // 多方案记录：默认不假装选其中一种。若已按服药人年龄明确选定了人群方案
    // （patientApplied，由 patient.js 应用，选自原文段落而非猜测），对这位服药人
    // 时间示例是确定的，不再因多方案挂黄条；界面会同时提示"勿转给其他人群"。
    if (record.frequency && record.frequency.multiRegimen && !record.patientApplied) {
      reasons.push('原文含多种用法，时间示例仅为其中一种');
    }
    // 原文写明睡前/晚间服，但示例时间落在白天 —— 这是矛盾，不是"可以照着做"的提示。
    // 宁可挂黄条让人核对，也不能让老人按 08:00 服睡前药。
    if (record.frequency && /睡前|晚间/.test(record.frequency.timingHint || '')) {
      const dayTimes = (record.frequency.times || []).filter(function (t) {
        const h = parseInt(String(t).slice(0, 2), 10);
        return !isNaN(h) && h >= 6 && h < 18;
      });
      if (dayTimes.length) reasons.push('原文要求睡前或晚间服用，与时间示例矛盾，请核对');
    }
    if (record.ocr_confidence != null && record.ocr_confidence < 0.7) reasons.push('识别置信度低');
    if (record.image_blurry === true) reasons.push('照片模糊');
    return { flag: reasons.length > 0, reasons: reasons };
  }

  // 禁止项自检：任何外观描述进入身份卡都拦截（颜色/形状/胶囊外观）
  const APPEARANCE_PATTERN = new RegExp([
    '(红白|红黄|蓝白|白绿|黑白)',
    '(颜色|形状|外观|长什么样|长得像)',
    '(椭圆|圆形|长条|方形|菱形)',
    '(红|黄|蓝|绿|白|黑|棕|粉|灰|紫|橙|透明)(色)?(药片|片剂|胶囊|药丸|颗粒|圆片|小圆片|药粒)'
  ].join('|'));
  function containsAppearance(text) {
    return APPEARANCE_PATTERN.test(String(text == null ? '' : text));
  }

  return {
    TIME_PRESETS: TIME_PRESETS,
    SEVERE_KEYWORDS: SEVERE_KEYWORDS,
    normalize: normalize,
    convertFrequency: convertFrequency,
    detectTimingHint: detectTimingHint,
    detectPRN: detectPRN,
    splitSentences: splitSentences,
    locateSevere: locateSevere,
    locateCommon: locateCommon,
    needsHumanCheck: needsHumanCheck,
    containsAppearance: containsAppearance
  };
});
