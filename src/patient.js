/* 服药人信息（可跳过、可留空）与其对用法方案的作用。
   核心原则：只做「从说明书原文里选人群段落」这一件事——
   1) 不生成任何医学判断；2) 不按体重计算剂量（mg/kg 只照抄原文写法）；
   3) 匹配不上就保持原样（黄条不解除），绝不猜一个方案。
*/
(function (root, factory) {
  const R = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.MedRules;
  const E = (typeof module === 'object' && module.exports) ? require('./extractor.js') : root.MedExtractor;
  if (typeof module === 'object' && module.exports) module.exports = factory(R, E);
  else root.MedPatient = factory(R, E);
})(typeof self !== 'undefined' ? self : this, function (R, E) {
  'use strict';

  const STORE_KEY = 'med_patient_v1';

  function get() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // 只保留四个允许的字段，其余一律丢弃；全部为空视为未设置。
  function set(profile) {
    const p = profile || {};
    const clean = {};
    if (p.nickname) clean.nickname = String(p.nickname).slice(0, 12);
    if (p.gender === '男' || p.gender === '女') clean.gender = p.gender;
    if (p.age != null && p.age !== '' && isFinite(p.age) && p.age > 0 && p.age < 130) {
      clean.age = Math.round(Number(p.age));
    }
    if (p.weight != null && p.weight !== '' && isFinite(p.weight) && p.weight > 0 && p.weight < 300) {
      clean.weight = Math.round(Number(p.weight) * 10) / 10;
    }
    try {
      if (Object.keys(clean).length === 0) localStorage.removeItem(STORE_KEY);
      else localStorage.setItem(STORE_KEY, JSON.stringify(clean));
    } catch (e) { /* 存储不可用时静默降级为会话内使用 */ }
    return clean;
  }

  function hasProfile() {
    const p = get();
    return !!(p && (p.age || p.weight || p.gender || p.nickname));
  }

  /* ---------- 人群段落匹配 ---------- */

  // 把用法用量切成句子（与规则层 splitSentences 同源，但需保留分隔符语义）
  function splitUsage(text) {
    return String(text || '')
      .split(/[。；;\n]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  // 单句与年龄是否匹配。返回 { ok, label } 或 { ok:false }
  // 解析顺序：显式年龄范围 > 显式门槛 > 人群关键词。全部保守：解析不出来就当不匹配。
  function sentenceMatchesAge(sentence, age) {
    const s = String(sentence || '');
    if (!s) return { ok: false };

    // 新生儿/婴幼儿专属句子：只有很小的年龄才匹配
    if (/新生儿|婴幼儿|婴儿/.test(s) && age > 3) return { ok: false };

    // 「6~12岁」范围：6 <= age < 12（12 岁通常由"12岁以上"句接管）
    const range = s.match(/([0-9]+)\s*[~～\-—到至]\s*([0-9]+)\s*岁/);
    if (range) {
      const lo = parseInt(range[1], 10), hi = parseInt(range[2], 10);
      return { ok: age >= lo && age < hi, label: range[0] + '人群' };
    }

    // 「12岁以上」门槛
    const min = s.match(/([0-9]+)\s*岁以上/);
    if (min) {
      const v = parseInt(min[1], 10);
      return { ok: age >= v, label: min[0] };
    }

    // 「6岁以下」上限
    const max = s.match(/([0-9]+)\s*岁以下/);
    if (max) {
      const v = parseInt(max[1], 10);
      return { ok: age <= v, label: max[0] };
    }

    // 人群关键词：成人（≥18 才匹配）、儿童/小儿（<12）、老年（不用于选段）
    if (/成人|成年/.test(s)) return { ok: age >= 18, label: '成人' };
    if (/儿童|小儿|幼儿/.test(s)) return { ok: age >= 0 && age < 12, label: '儿童' };
    return { ok: false };
  }

  // 从用法用量全文中选出与服药人匹配的人群句子组。
  // 返回 { matched, label, sentences, freqText }
  // freqText 是选中句子里由抽取层频次正则找到的内容（可能为空——选了段落但没有频次表达时不算成功）。
  function selectRegimen(usageText, profile) {
    const p = profile || {};
    if (!p.age && !p.weight) return { matched: false };
    const age = p.age;
    const sents = splitUsage(usageText);
    // 老年段不选：那是调整方案，不是默认方案；正文无人群词的句子（如总则）也不单独入选
    const picked = [];
    let label = '';
    sents.forEach(function (s) {
      const m = sentenceMatchesAge(s, age);
      if (m.ok) {
        picked.push(s);
        if (!label) label = m.label;
      }
    });
    if (!picked.length) return { matched: false };
    const freqText = picked.join('。');
    const freqMatch = E.findFrequency ? E.findFrequency(freqText) : '';
    return { matched: !!freqMatch, label: label || '对应人群', sentences: picked, freqText: freqText };
  }

  /* ---------- 应用到记录 ---------- */

  // 把患者信息应用进抽取记录：多方案记录里选出对应人群的方案并重新换算频次。
  // 不满足条件（无年龄/无匹配/换算失败）时原样返回，绝不降安全等级。
  function applyPatient(record, profile) {
    if (!record || !profile || !profile.age) return record;
    // 仅处理"多方案"记录：单一明确方案没有选择问题
    if (!record.frequency || !record.frequency.multiRegimen) return record;

    // 从原文里找用法用量段（source_text 是全文）
    const sections = E.parseSections(record.source_text || '');
    const usage = sections['用法用量'] || '';
    if (!usage) return record;

    const sel = selectRegimen(usage, profile);
    if (!sel.matched) return record;

    const conv = R.convertFrequency(sel.freqText);
    if (conv.needsCheck || !conv.times.length) return record;

    const out = Object.assign({}, record);
    out.frequency = Object.assign({}, record.frequency, {
      times: conv.times.slice(),
      timeExample: conv.times.join(' / '),
      // 选中人群方案后，时间示例对这位服药人是确定的；multiRegimen 保留（原文确实有多套），
      // 但 needsHumanCheck 会因 patientApplied 而不再因多方案挂黄条。
      timingHint: conv.timingHint || record.frequency.timingHint
    });
    out.patientApplied = {
      label: sel.label,
      age: profile.age,
      note: '已按「' + sel.label + '」方案显示；原文还有其他人群的用法，请勿转给其他人使用'
    };
    // 选择依据变了，黄条结论要跟着重算（multiRegimen 保留，但不再因它挂黄条）
    const check = R.needsHumanCheck(out);
    out.needs_human_check = check.flag;
    out.check_reasons = check.reasons;
    return out;
  }

  return {
    get: get,
    set: set,
    hasProfile: hasProfile,
    selectRegimen: selectRegimen,
    sentenceMatchesAge: sentenceMatchesAge,
    applyPatient: applyPatient,
    STORE_KEY: STORE_KEY
  };
});
