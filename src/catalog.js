/* 本地药品目录防错：用公开的「身份字段」（药名 / 规格 / 厂家 / 批准文号）核对录入文字。
   边界（不可突破）：
   - 只做文字比对，不判断药的真伪、优劣、能否同服，不提供用法用量。
   - 目录未收录 ≠ 药有问题。查不到只提示"请核对药盒"，绝不说"不存在/错误/不能吃"。
   - 目录只在浏览器本地，不上传；内置为演示样本（不完整），可导入公开数据扩充。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MedCatalog = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const R = (typeof module === 'object' && module.exports) ? require('./rules.js') : (typeof self !== 'undefined' ? self.MedRules : null);
  const KEY = 'med-reader.catalog.custom.v1';

  // 内置演示目录：只有身份文字，没有用法用量。刻意标注"不完整"，避免被当作权威药品库。
  const BUILTIN = [
    { name: '阿莫西林胶囊', spec: '0.25g' },
    { name: '阿莫西林胶囊', spec: '0.5g' },
    { name: '二甲双胍片', spec: '0.25g' },
    { name: '二甲双胍片', spec: '0.5g' },
    { name: '阿托伐他汀钙片', spec: '10mg' },
    { name: '阿托伐他汀钙片', spec: '20mg' },
    { name: '苯磺酸氨氯地平片', spec: '5mg' },
    { name: '缬沙坦胶囊', spec: '80mg' },
    { name: '硝苯地平控释片', spec: '30mg' },
    { name: '奥美拉唑肠溶胶囊', spec: '20mg' },
    { name: '阿司匹林肠溶片', spec: '100mg' },
    { name: '布洛芬片', spec: '0.2g' },
    { name: '对乙酰氨基酚片', spec: '0.5g' },
    { name: '氯雷他定片', spec: '10mg' },
    { name: '左甲状腺素钠片', spec: '50μg' },
    { name: '左甲状腺素钠片', spec: '100μg' }
  ].map(function (e) { return Object.assign({ maker: '', approval: '', builtin: true }, e); });

  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/\s+/g, '')
      .replace(/[（）()【】\[\]]/g, '')
      .replace(/[，,、；;。:：]/g, '')
      .toLowerCase();
  }

  // 规格归一：0.25g 与 250mg 视为同一规格文字，避免误报"（规格不符）"。
  function canonSpec(s) {
    const t = norm(s).replace(/每[片粒袋支瓶]/g, '');
    const m = t.match(/^(\d+(?:\.\d+)?)(mg|g|μg|ug|ml|iu|万单位)$/);
    if (!m) return { key: t, parsed: false };
    const num = parseFloat(m[1]);
    const unit = m[2];
    let ns, val;
    if (unit === 'g') { ns = 'mass'; val = num * 1000; }
    else if (unit === 'mg') { ns = 'mass'; val = num; }
    else if (unit === 'μg' || unit === 'ug') { ns = 'mass'; val = num / 1000; }
    else if (unit === 'ml') { ns = 'vol'; val = num; }
    else if (unit === 'iu') { ns = 'iu'; val = num; }
    else { ns = 'wan'; val = num; }
    return { key: ns + ':' + Math.round(val * 1e6) / 1e6, parsed: true };
  }

  function specEqual(a, b) {
    const ca = canonSpec(a), cb = canonSpec(b);
    if (ca.parsed && cb.parsed) return ca.key === cb.key;
    return norm(a) !== '' && norm(a) === norm(b);
  }

  function allEntries(custom) {
    const extra = Array.isArray(custom) ? custom : [];
    return BUILTIN.concat(extra);
  }

  function loadCustom() {
    try {
      const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveCustom(entries) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(entries));
      return true;
    } catch (e) { return false; }
  }

  // 导入公开数据 CSV：药名,规格,厂家,批准文号。只取身份字段，忽略其余列。
  function parseCsv(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const entries = [];
    let skipped = 0;
    lines.forEach(function (line, idx) {
      const cells = line.split(',').map(function (c) { return c.replace(/^"|"$/g, '').trim(); });
      if (!cells.length) return;
      if (idx === 0 && /药名|名称|name/i.test(cells[0])) return;
      const name = cells[0];
      if (!name) { skipped++; return; }
      const entry = { name: name, spec: cells[1] || '', maker: cells[2] || '', approval: cells[3] || '', builtin: false };
      entries.push(entry);
    });
    return { entries: entries, skipped: skipped };
  }

  function uniqueSpecs(entries) {
    const seen = Object.create(null);
    const out = [];
    entries.forEach(function (e) {
      const s = String(e.spec || '').trim();
      if (!s || seen[norm(s)]) return;
      seen[norm(s)] = true;
      out.push(s);
    });
    return out;
  }

  /* 核对入口。返回 { status, title, detail, candidates, matched }
     status: ok | spec_mismatch | name_hint | name_not_found | need_spec | no_input | blocked_appearance
     文案纪律：只说"请核对"，不说"不存在/错误/不能吃/有问题"。 */
  function verify(drugName, spec, custom) {
    const nameRaw = String(drugName == null ? '' : drugName).trim();
    const specRaw = String(spec == null ? '' : spec).trim();
    const nn = norm(nameRaw);

    if (R && R.containsAppearance && R.containsAppearance(nameRaw + ' ' + specRaw)) {
      return {
        status: 'blocked_appearance',
        title: '这段描述不能用作核对依据',
        detail: '为防止相同外观药品混杂导致误食，药物特征暂不支持以外形记录。请改用药盒上的药名和规格文字。',
        candidates: [], matched: []
      };
    }
    if (!nn) {
      return { status: 'no_input', title: '请先填写药名', detail: '药名在药盒正面，照着写就行。', candidates: [], matched: [] };
    }

    const catalog = allEntries(custom === undefined ? loadCustom() : custom);
    const exact = catalog.filter(function (e) { return norm(e.name) === nn; });
    let pool = exact;
    let statusName = 'exact';

    if (!exact.length && nn.length >= 3) {
      pool = catalog.filter(function (e) {
        const en = norm(e.name);
        return en.length >= 3 && (en.indexOf(nn) !== -1 || nn.indexOf(en) !== -1);
      });
      statusName = 'partial';
    }

    if (!pool.length) {
      return {
        status: 'name_not_found',
        title: '本地目录没有收录这个药名',
        detail: '这不代表这个药有问题。请以药盒和纸质说明书为准，继续照原文填写即可。',
        candidates: [], matched: []
      };
    }

    const specs = uniqueSpecs(pool);
    if (!specRaw) {
      return {
        status: 'need_spec',
        title: '请再填一下规格',
        detail: '规格一般在药盒上，是 g、mg、ml 前面的数字。填完可以帮您对一眼有没有抄错。',
        candidates: specs.slice(0, 6), matched: pool.slice(0, 8)
      };
    }

    const specOk = pool.some(function (e) { return specEqual(e.spec, specRaw); });
    if (statusName === 'partial') {
      return {
        status: 'name_hint',
        title: '目录里有相近的药名，请确认一下',
        detail: '目录找到「' + pool[0].name + '」。请核对药盒上的完整药名是否一致；这只是文字比对，不涉及用法用量。',
        candidates: specs.slice(0, 6), matched: pool.slice(0, 8)
      };
    }
    if (!specOk) {
      return {
        status: 'spec_mismatch',
        title: '规格文字对不上，请看一眼药盒',
        detail: '目录里「' + pool[0].name + '」记录的规格有：' + (specs.join('、') || '未记录') + '。您填的是「' + specRaw + '」。请核对后再继续；这不代表药有问题。',
        candidates: specs.slice(0, 6), matched: pool.slice(0, 8)
      };
    }
    return {
      status: 'ok',
      title: '药名和规格与本地目录一致',
      detail: '目录里有「' + pool[0].name + '」和规格「' + specRaw + '」。这只是文字核对，不说明药怎么用、能不能一起吃。',
      candidates: specs.slice(0, 6), matched: pool.slice(0, 8)
    };
  }

  return {
    KEY: KEY,
    BUILTIN: BUILTIN,
    norm: norm,
    canonSpec: canonSpec,
    specEqual: specEqual,
    parseCsv: parseCsv,
    loadCustom: loadCustom,
    saveCustom: saveCustom,
    allEntries: allEntries,
    verify: verify
  };
});
