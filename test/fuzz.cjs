/* 变异测试场：验证抽取层在"脏输入"下的三条硬不变量。
   1) 永不崩溃（任何异常都算失败）
   2) 不编造：提取出的每个非空字段（药名/规格/用量/频次）必须能在原文中找到出处
   3) 严重警示引用的句子必须在原文中存在（不虚构警示）

   数据两层：
   - AI 手写对抗样本 test/fixtures/ai-mutants/*.txt（从虚构演示样张变异，随仓库提交）
   - 程序化确定性变异（mulberry32 种子随机数）：samples/*.txt 每份 8 个变体（样张不入仓库时自动跳过）

   用法：node test/fuzz.cjs
*/
const fs = require('fs');
const path = require('path');
const E = require('../src/extractor.js');

// 样张目录在应用目录之外（见 evaluate.cjs 同款说明），不入公开站点与仓库
const SAMPLES = path.join(__dirname, '..', '..', 'eval-data', 'samples');
const FIXTURES = path.join(__dirname, 'fixtures', 'ai-mutants');

/* ---------- 确定性伪随机（可复现） ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

/* ---------- 变异算子（模拟拍照 OCR / 手抄的常见脏输入） ---------- */
const NOISE_CHARS = ['·', ' ', '　', '。'];

function opDigitSwap(text, rnd) {
  const idxs = [];
  const re = /[0-9]{2,}/g;
  let m;
  while ((m = re.exec(text)) !== null) idxs.push(m.index);
  if (!idxs.length) return text;
  const at = pick(rnd, idxs);
  const head = text.slice(0, at);
  const num = text.slice(at).match(/^[0-9]{2,}/)[0];
  const swapped = num[1] + num[0] + num.slice(2);
  return head + swapped + text.slice(at + num.length);
}

function opTypo(text, rnd) {
  const idxs = [];
  for (let i = 0; i < text.length; i++) if (/[\u4e00-\u9fa5]/.test(text[i])) idxs.push(i);
  if (!idxs.length) return text;
  const at = pick(rnd, idxs);
  const wrong = pick(rnd, ['曰', '日', '大', '太', '干', '士', '土', '末', '未']);
  return text.slice(0, at) + wrong + text.slice(at + 1);
}

function opLineSwap(text, rnd) {
  const lines = text.split('\n');
  if (lines.length < 2) return text;
  const i = Math.floor(rnd() * lines.length);
  let j = Math.floor(rnd() * lines.length);
  if (i === j) j = (j + 1) % lines.length;
  const t = lines[i]; lines[i] = lines[j]; lines[j] = t;
  return lines.join('\n');
}

function opJoinLines(text, rnd) {
  const lines = text.split('\n');
  if (lines.length < 2) return text;
  const i = Math.floor(rnd() * (lines.length - 1));
  return lines.slice(0, i).concat([lines[i] + lines[i + 1]]).concat(lines.slice(i + 2)).join('\n');
}

function opDupLine(text, rnd) {
  const lines = text.split('\n');
  if (lines.length < 1) return text;
  const i = Math.floor(rnd() * lines.length);
  return lines.slice(0, i + 1).concat([lines[i]]).concat(lines.slice(i + 1)).join('\n');
}

function opDropChar(text, rnd) {
  if (text.length < 2) return text;
  const at = Math.floor(rnd() * (text.length - 1));
  return text.slice(0, at) + text.slice(at + 1);
}

function opInsertNoise(text, rnd) {
  const at = Math.floor(rnd() * text.length);
  const n = text.slice(0, at) + pick(rnd, NOISE_CHARS) + text.slice(at);
  return n;
}

const OPS = [
  ['数字错位', opDigitSwap],
  ['错别字', opTypo],
  ['行乱序', opLineSwap],
  ['行粘连', opJoinLines],
  ['重复行', opDupLine],
  ['丢字符', opDropChar],
  ['插噪声', opInsertNoise]
];

/* ---------- 不变量检查 ---------- */
function hasSource(text, value, source) {
  if (!value) return true; // 空字段无所谓出处
  return text.indexOf(value) !== -1 || !!(source && String(source).indexOf(value) !== -1);
}

function checkInvariants(text, r) {
  const fails = [];
  try {
    if (r && !hasSource(text, r.drug_name.value, r.drug_name.source)) fails.push('药名无出处: ' + r.drug_name.value);
    if (r && !hasSource(text, r.specification.value, r.specification.source)) fails.push('规格无出处: ' + r.specification.value);
    if (r && !hasSource(text, r.dosage.value, r.dosage.source)) fails.push('用量无出处: ' + r.dosage.value);
    if (r && !hasSource(text, r.frequency.value, r.frequency.source)) fails.push('频次无出处: ' + r.frequency.value);
    if (r && r.adverse && Array.isArray(r.adverse.severe)) {
      r.adverse.severe.forEach(function (s) {
        if (!hasSource(text, s.text, null)) fails.push('警示句无出处: ' + s.text);
      });
    }
  } catch (e) {
    fails.push('检查器自身异常: ' + e.message);
  }
  return fails;
}

/* ---------- 主流程 ---------- */
let total = 0, failed = 0;
const failures = [];

function runOne(label, text) {
  total++;
  let r = null;
  try {
    r = E.extractLocal(text);
  } catch (e) {
    failed++;
    failures.push(label + ' | 崩溃: ' + e.message);
    return;
  }
  const fails = checkInvariants(text, r);
  if (fails.length) {
    failed++;
    failures.push(label + ' | ' + fails.join('; '));
  }
}

// 第一层：AI 手写对抗样本（永远跑，随仓库提交）
const aiDir = FIXTURES;
if (fs.existsSync(aiDir)) {
  fs.readdirSync(aiDir).filter(function (f) { return f.endsWith('.txt'); }).sort().forEach(function (f) {
    runOne('AI样本 ' + f, fs.readFileSync(path.join(aiDir, f), 'utf8'));
  });
}

// 第二层：程序化变异（samples 在本地才跑；公开仓库无样张时自动跳过）
if (fs.existsSync(SAMPLES)) {
  const files = fs.readdirSync(SAMPLES).filter(function (f) { return f.endsWith('.txt'); }).sort();
  const MUT_PER_SAMPLE = 8;
  files.forEach(function (f, fi) {
    const raw = fs.readFileSync(path.join(SAMPLES, f), 'utf8').replace(/^<!--[\s\S]*?-->/, '').trim();
    for (let k = 0; k < MUT_PER_SAMPLE; k++) {
      // 固定种子：(文件序号, 变体序号) -> 结果可复现
      const rnd = mulberry32(fi * 1000 + k * 7 + 13);
      let text = raw;
      const used = [];
      // 每个变体叠加 2~4 个算子，顺序由种子决定
      const nOps = 2 + Math.floor(rnd() * 3);
      for (let q = 0; q < nOps; q++) {
        const op = pick(rnd, OPS);
        used.push(op[0]);
        try { text = op[1](text, rnd); } catch (e) { /* 算子本身不因文本形态崩 */ }
      }
      runOne('程序变异 ' + f + ' #' + k + '(' + used.join('+') + ')', text);
    }
  });
}

console.log('=== 变异测试场 ===');
console.log('变体总数: ' + total + '，失败: ' + failed);
if (failed) {
  console.log('\n=== 失败明细（前 20 条）===');
  failures.slice(0, 20).forEach(function (l) { console.log(l); });
  process.exitCode = 1;
} else {
  console.log('三条不变量全部成立：不崩溃 / 不编造 / 警示句可追溯');
}
