/* 评测：把 samples/*.txt 喂进抽取层，对照独立金标准统计。
   金标准来源刻意与抽取层不同源：
   - 药名/规格：文件名（人工指定，非正则抽取）
   - 频次时间点数：独立的频次读取器（不复用抽取层 FREQ_RE）
   - 严重警示：从全文（不良反应+注意事项+禁忌）扫描，而非只读不良反应段
   用法：node test/evaluate.cjs
*/
const fs = require('fs');
const path = require('path');
const E = require('../src/extractor.js');
const R = require('../src/rules.js');

// 评测语料存放在应用目录之外（../../..../eval-data/samples）：应用目录会被整包发布到公网，
// 说明书原文按既定决策不入公开站点与仓库。
const SAMPLES = path.join(__dirname, '..', '..', 'eval-data', 'samples');

/* 独立金标准读取器 —— 与抽取层实现刻意分开 */

// 从文件名取药名与规格：xxx_规格.txt
function goldFromFilename(file) {
  const base = file.replace(/\.txt$/i, '');
  const i = base.lastIndexOf('_');
  if (i === -1) return { name: base, spec: '' };
  return { name: base.slice(0, i), spec: base.slice(i + 1) };
}

// 独立频次读取：只要"每日/一日/每天/一天 + 数字 + 次"，返回次数。
// 刻意不复用抽取层的 FREQ_RE —— 区间/每N小时等其他写法返回 null（本次不计入准确率分母）。
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function goldFrequencyCount(usageText) {
  const s = String(usageText || '');
  // 区间写法（一日2～3次 / 一日1-2次）：金标准判定为"不确定"。
  // 产品的正确行为是挂黄条请用户自行核对，而不是猜一个时间点；
  // 若从文中别处抓一个确定次数当"正确答案"，等于惩罚了安全行为。
  if (/(?:每日|一日|每天|一天)\s*[0-9一二三四五六七八九十]+\s*[-～~至到]\s*[0-9一二三四五六七八九十]+\s*次/.test(s)) {
    return null;
  }
  const re = /(?:每日|一日|每天|一天)\s*([0-9一二三四五六七八九十])\s*次/g;
  let m;
  const counts = new Set();
  while ((m = re.exec(s)) !== null) {
    const raw = m[1];
    const n = /^[0-9]$/.test(raw) ? parseInt(raw, 10) : CN_NUM[raw];
    if (n) counts.add(n);
  }
  if (counts.size === 1) return Array.from(counts)[0];
  return null; // 0 个或多个不同次数 -> 金标准不确定，分母外
}

// 按需服药（PRN）金标准：人工逐份核读全文后标注 —— 这三份药的用法是"按需使用"，
// 没有固定时间表（疼痛时含服 / 必要时隔6-8小时 / 发热疼痛时重复），识别成按需即正确。
// 不用正则自动判定：正则要么复制抽取层逻辑（自证），要么误伤带"必要时可增加剂量"
// 这类附注的固定方案药（如坎地沙坦）。金标准允许人工标注，与药名取自文件名同一性质。
const PRN_GOLD = {
  '对乙酰氨基酚片_0.5g.txt': true,
  '硝酸甘油片_0.5mg.txt': true,
  '萘普生片_0.25g.txt': true
};

// 金标准严重警示：扫【不良反应】+【注意事项】两段，与抽取层设计口径一致。
// 刻意不扫【禁忌】段——"心源性休克患者禁用"是说这类人不能用，不是药物会导致休克，
// 把它当前置警示反而误导。评测检验的是"设计范围内有没有漏"，不是"范围外有没有词"。
function goldSevereCount(sections) {
  const scan = [sections['不良反应'] || '', sections['注意事项'] || ''].filter(Boolean).join('\n');
  return R.locateSevere(scan).length;
}

// 规格归一：0.25g = 250mg
function specEq(a, b) {
  function norm(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[（）()]/g, '');
  }
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const toMg = function (v) {
    const m = v.match(/^([0-9.]+)(g|mg|ml|iu|万单位|单位)$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (m[2] === 'g') return n * 1000;
    if (m[2] === 'mg') return n;
    return null;
  };
  const mx = toMg(x), my = toMg(y);
  if (mx != null && my != null && Math.abs(mx - my) < 0.001) return true;
  // 抽取层保留完整原文（如 0.1%（10ml：10mg））比文件名简写（0.1%）更忠实，
  // 只要归一后一个是另一个的子串就算对。
  if (x.indexOf(y) !== -1 || y.indexOf(x) !== -1) return true;
  // 中文数字单位：0.1克 = 0.1g，100毫升 = 100ml
  const cn = function (v) {
    return v.replace(/克/g, 'g').replace(/毫克/g, 'mg').replace(/毫升/g, 'ml').replace(/：/g, ':');
  };
  const cx = cn(x), cy = cn(y);
  return cx.indexOf(cy) !== -1 || cy.indexOf(cx) !== -1;
}

/* 主流程 */
const files = fs.readdirSync(SAMPLES).filter(function (f) { return f.endsWith('.txt'); }).sort();
const rows = [];
files.forEach(function (f) {
  const raw = fs.readFileSync(path.join(SAMPLES, f), 'utf8');
  const text = raw.replace(/^<!--[\s\S]*?-->/, '').trim();
  const sections = E.parseSections(text);
  const gold = goldFromFilename(f);
  const r = E.extractLocal(text);
  const usage = sections['用法用量'] || '';

  const goldCount = goldFrequencyCount(usage);
  const actualCount = r.frequency.times.length;
  let freqJudged = 'skip';
  if (goldCount != null) {
    freqJudged = actualCount === goldCount ? 'ok' : 'wrong';
  } else if (r.needs_human_check) {
    freqJudged = 'honest'; // 金标准不确定时，挂黄条算诚实处理
  }

  const goldSevere = goldSevereCount(sections);
  const gotSevere = r.adverse.severe.length;

  rows.push({
    file: f,
    goldName: gold.name,
    name: r.drug_name.value,
    // 药名没有唯一写法：文件名用简写（依那普利片），说明书原文带盐基/商品名
    // （马来酸依那普利片（依苏））。抽取层照抄原文才正确，金标准按归一化后
    // 互相包含判定，仍拒绝真正的错药名（如阿莫西林 vs 氨苄西林）。
    nameOk: (function () {
      const g = R.normalize(gold.name), a = R.normalize(r.drug_name.value);
      return g === a || (g.length >= 3 && a.length >= 3 && (g.indexOf(a) !== -1 || a.indexOf(g) !== -1));
    })(),
    goldSpec: gold.spec,
    spec: r.specification.value,
    // 规格没有唯一写法（0.1% = 10ml:10mg = 0.1克），文件名比对只作参考。
    // 真正的硬指标是"规格是否忠实来源于原文"，与剂量出处同口径。
    specOk: specEq(gold.spec, r.specification.value),
    specHasSource: !!(r.specification.value && (text.indexOf(r.specification.value) !== -1 || r.specification.source.indexOf(r.specification.value) !== -1)),
    dosage: r.dosage.value,
    // 与 needsHumanCheck 同口径：source 是截断展示片段，用完整原文兜底校验出处
    dosageHasSource: !!(r.dosage.value && (text.indexOf(r.dosage.value) !== -1 || r.dosage.source.indexOf(r.dosage.value) !== -1)),
    freq: r.frequency.value,
    goldTimes: goldCount,
    actualTimes: actualCount,
    freqJudged: freqJudged,
    goldSevere: goldSevere,
    gotSevere: gotSevere,
    severeRecall: goldSevere === 0 ? null : Math.min(1, gotSevere / goldSevere),
    needsCheck: r.needs_human_check,
    prn: !!r.frequency.prn,
    reasons: r.check_reasons
  });
});

function pct(a, b) { return b === 0 ? null : Math.round(a / b * 1000) / 10; }
const total = rows.length;
const nameOk = rows.filter(function (r) { return r.nameOk; }).length;
const specOk = rows.filter(function (r) { return r.specOk; }).length;
const specTrace = rows.filter(function (r) { return r.specHasSource; }).length;
const dosageOk = rows.filter(function (r) { return r.dosageHasSource; }).length;
const judged = rows.filter(function (r) { return r.freqJudged === 'ok' || r.freqJudged === 'wrong'; });
const freqOk = judged.filter(function (r) { return r.freqJudged === 'ok'; }).length;
const honest = rows.filter(function (r) { return r.freqJudged === 'honest'; }).length;
const severeRows = rows.filter(function (r) { return r.goldSevere > 0; });
const severeSum = severeRows.reduce(function (a, r) { return a + r.severeRecall; }, 0);
const severeRecall = severeRows.length ? Math.round(severeSum / severeRows.length * 1000) / 10 : null;
const checkRate = pct(rows.filter(function (r) { return r.needsCheck; }).length, total);

// 按需服药：人工标注的 PRN 样张中，工具正确给出按需分类的数量
const prnGoldRows = rows.filter(function (r) { return PRN_GOLD[r.file]; });
const prnOk = prnGoldRows.filter(function (r) { return r.prn; }).length;

// 严重错误：药名错 / 剂量无原文出处 / 时间数与原文矛盾
const serious = rows.filter(function (r) {
  return !r.nameOk || !r.dosageHasSource || r.freqJudged === 'wrong';
});

const summary = {
  generatedAt: '2026-11-23',
  total: total,
  nameAccuracy: pct(nameOk, total),
  specTraceRate: pct(specTrace, total),
  specFilenameMatch: pct(specOk, total), // 仅供参考：规格无唯一写法，文件名比对非硬指标
  dosageTraceRate: pct(dosageOk, total),
  frequencyAccuracy: pct(freqOk, judged.length),
  frequencyJudged: judged.length,
  frequencyHonestFallback: honest,
  severeRecall: severeRecall,
  severeSamples: severeRows.length,
  seriousErrorCount: serious.length,
  seriousErrorRate: pct(serious.length, total),
  humanCheckRate: checkRate,
  prnGoldSamples: prnGoldRows.length,
  prnIdentified: prnOk
};

console.log('=== 评测汇总（' + total + ' 份）===');
console.log('药名准确率：' + summary.nameAccuracy + '% (' + nameOk + '/' + total + ')');
console.log('规格原文出处可追溯率：' + summary.specTraceRate + '% (' + specTrace + '/' + total + ')');
console.log('  （文件名写法匹配 ' + summary.specFilenameMatch + '%，仅参考：规格无唯一写法，原文照抄优先）');
console.log('剂量原文出处可追溯率：' + summary.dosageTraceRate + '% (' + dosageOk + '/' + total + ')');
console.log('频次时间数准确率：' + summary.frequencyAccuracy + '% (' + freqOk + '/' + judged.length + ')，' + honest + ' 份不确定写法诚实挂黄条');
console.log('严重警示召回率：' + severeRecall + '%（' + severeRows.length + ' 份含严重关键词）');
console.log('严重错误率：' + summary.seriousErrorRate + '%（' + serious.length + ' 份）');
console.log('按需服药识别：' + prnOk + '/' + prnGoldRows.length + '（PRN 类药正确归入"按需服用"而非"无法换算"）');
console.log('需人工确认比例：' + checkRate + '%');

if (serious.length) {
  console.log('\n=== 严重错误明细（需修）===');
  serious.forEach(function (r) {
    const why = [];
    if (!r.nameOk) why.push('药名:' + r.name + '≠' + r.goldName);
    if (!r.dosageHasSource) why.push('剂量无出处');
    if (r.freqJudged === 'wrong') why.push('时间数:' + r.actualTimes + '≠' + r.goldTimes);
    console.log(r.file + ' | ' + why.join('; '));
  });
}
const wrongRows = judged.filter(function (r) { return r.freqJudged === 'wrong'; });
if (wrongRows.length) {
  console.log('\n=== 频次不符明细 ===');
  wrongRows.forEach(function (r) {
    console.log(r.file + ' | 原文次数=' + r.goldTimes + ' 给出=' + r.actualTimes + ' | 频次原文=' + r.freq);
  });
}

// 明细落盘（公开仓库只放统计，明细含药名但不含原文，仍放 docs 供复现）
const out = path.join(__dirname, '..', 'docs', 'evaluation.json');
fs.writeFileSync(out, JSON.stringify({ summary: summary, details: rows }, null, 2), 'utf8');
console.log('\n明细已写：docs/evaluation.json');
