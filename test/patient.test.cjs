/* patient.js 单测：人群段落选择与患者应用 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../src/patient.js');
const R = require('../src/rules.js');
const E = require('../src/extractor.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}

/* ---------- set/get：字段白名单与清洗 ---------- */
t('set 只保留白名单字段并清洗', () => {
  const saved = P.set({ nickname: '老王', gender: '男', age: 42, weight: 65.4, hack: 'x' });
  assert.deepEqual(Object.keys(saved).sort(), ['age', 'gender', 'nickname', 'weight']);
  assert.equal(saved.weight, 65.4);
});
t('set 全空 -> 清除记录', () => {
  P.set({});
  assert.equal(P.get(), null);
  assert.equal(P.hasProfile(), false);
});
t('set 非法值被丢弃', () => {
  const saved = P.set({ age: 999, weight: -5, gender: '其他' });
  assert.deepEqual(saved, {});
});
// localStorage 在 node 环境不存在，set 内部静默降级——上面的断言验证清洗逻辑本身

/* ---------- sentenceMatchesAge ---------- */
t('范围句 6~12岁：6-11 匹配，12 不匹配', () => {
  assert.equal(P.sentenceMatchesAge('6~12岁儿童:每次5毫升', 7).ok, true);
  assert.equal(P.sentenceMatchesAge('6~12岁儿童:每次5毫升', 12).ok, false);
  assert.equal(P.sentenceMatchesAge('6~12岁儿童:每次5毫升', 3).ok, false);
});
t('门槛句 12岁以上：12 匹配，11 不匹配', () => {
  assert.equal(P.sentenceMatchesAge('12岁以上儿童及成人一次1片', 12).ok, true);
  assert.equal(P.sentenceMatchesAge('12岁以上儿童及成人一次1片', 11).ok, false);
});
t('无门槛成人句：>=18 匹配，儿童不匹配', () => {
  assert.equal(P.sentenceMatchesAge('成人一次0.15g，一日3次', 42).ok, true);
  assert.equal(P.sentenceMatchesAge('成人一次0.15g，一日3次', 8).ok, false);
  assert.equal(P.sentenceMatchesAge('成人一次0.15g，一日3次', 14).ok, false); // 保守：12-17 需显式门槛
});
t('无门槛儿童句：<12 匹配', () => {
  assert.equal(P.sentenceMatchesAge('小儿每日按体重10mg/kg，分4次服用', 5).ok, true);
  assert.equal(P.sentenceMatchesAge('小儿每日按体重10mg/kg，分4次服用', 13).ok, false);
});
t('婴幼儿句：大年龄不匹配', () => {
  assert.equal(P.sentenceMatchesAge('婴幼儿一次1袋', 30).ok, false);
  assert.equal(P.sentenceMatchesAge('婴幼儿一次1袋', 1).ok, true);
});
t('普通句子（无人群词）不匹配', () => {
  assert.equal(P.sentenceMatchesAge('口服，饭后服用', 42).ok, false);
});

/* ---------- selectRegimen + applyPatient（用真实样张） ---------- */
// 样张语料不随公开仓库发布（见 README）：先找仓库外 eval-data/samples，再退回仓库内 samples/
const SAMPLE_DIRS = [
  path.join(__dirname, '..', '..', 'eval-data', 'samples'),
  path.join(__dirname, '..', 'samples')
];
function loadSample(file) {
  for (const dir of SAMPLE_DIRS) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').replace(/^<!--[\s\S]*?-->/, '');
  }
  return null;
}
const hasFixtures = loadSample('利巴韦林片_0.1g.txt') !== null;
if (!hasFixtures) {
  console.log('SKIP 6 项样张测试：评测样张不随公开仓库发布。将样张放入仓库旁 eval-data/samples/（或本仓库 samples/）后自动恢复。');
}
function usageOf(file) {
  const t = loadSample(file);
  if (t === null) throw new Error('样张缺失：' + file);
  return E.parseSections(t)['用法用量'] || '';
}

if (hasFixtures) {
t('利巴韦林：42岁成人 -> 选出成人段（一日3次），儿童按体重段不入选', () => {
  const sel = P.selectRegimen(usageOf('利巴韦林片_0.1g.txt'), { age: 42 });
  assert.equal(sel.matched, true);
  assert.equal(sel.sentences.length, 2); // 两个成人病种句
  assert.ok(sel.sentences.every(s => /成人/.test(s) && !/小儿/.test(s)));
});

t('利巴韦林：5岁儿童 -> 选出小儿按体重段', () => {
  const sel = P.selectRegimen(usageOf('利巴韦林片_0.1g.txt'), { age: 5 });
  assert.equal(sel.matched, true);
  assert.ok(/小儿|体重/.test(sel.sentences.join('')), sel.sentences.join('|'));
});

t('阿莫西林：42岁成人 -> 选成人段（每12小时1次）', () => {
  const sel = P.selectRegimen(usageOf('阿莫西林胶囊_0.25g.txt'), { age: 42 });
  assert.equal(sel.matched, true);
  assert.ok(/成人|40kg/.test(sel.sentences.join('')));
});

t('西替利嗪：4岁儿童 -> 2~6岁段', () => {
  const sel = P.selectRegimen(usageOf('盐酸西替利嗪片_10mg.txt'), { age: 4 });
  assert.equal(sel.matched, true);
  assert.ok(/2~6岁儿童/.test(sel.sentences.join('')));
});

t('applyPatient：多方案记录按成人选择后黄条解除并带 patientApplied', () => {
  const t = loadSample('利巴韦林片_0.1g.txt');
  if (t === null) throw new Error('样张缺失');
  const rec = E.extractLocal(t);
  assert.equal(rec.frequency.multiRegimen, true);
  const applied = P.applyPatient(rec, { age: 42 });
  assert.ok(applied.patientApplied);
  assert.equal(applied.frequency.times.length, 3); // 一日3次
  const check = R.needsHumanCheck(applied);
  assert.equal(check.flag, false);
  assert.ok(!check.reasons.some(x => x.indexOf('多种用法') !== -1));
});

t('applyPatient：不匹配的人群原样返回，黄条不解除', () => {
  const t = loadSample('利巴韦林片_0.1g.txt');
  if (t === null) throw new Error('样张缺失');
  const rec = E.extractLocal(t);
  const applied = P.applyPatient(rec, { age: 13 }); // 13岁：成人段(>=18)不匹配，儿童句"小儿"不匹配
  assert.equal(applied.patientApplied, undefined);
  const check = R.needsHumanCheck(applied);
  assert.equal(check.flag, true);
});
}

t('applyPatient：单一方案记录不需要选择，原样返回', () => {
  const rec = {
    drug_name: { value: '测试' }, dosage: { value: '一次一片' },
    frequency: { value: '每日一次', times: ['08:00'], multiRegimen: false },
    source_text: '测试 一次一片 每日一次'
  };
  assert.equal(P.applyPatient(rec, { age: 42 }), rec);
});

t('applyPatient：无年龄不处理', () => {
  const rec = { frequency: { multiRegimen: true }, source_text: '' };
  assert.equal(P.applyPatient(rec, { weight: 60 }), rec);
  assert.equal(P.applyPatient(rec, null), rec);
});

t('applyPatient：选中段落无频次表达 -> 不应用', () => {
  const rec = {
    drug_name: { value: '测试' }, dosage: { value: '遵医嘱' },
    frequency: { value: '遵医嘱', times: [], multiRegimen: true },
    source_text: '【用法用量】\n成人：遵医嘱使用。儿童：遵医嘱使用。\n'
  };
  const applied = P.applyPatient(rec, { age: 42 });
  assert.equal(applied.patientApplied, undefined);
});

/* ---------- 超范围输入防护（用户实测填了 20 个 9 的年龄） ---------- */
t('set 超大年龄被静默丢弃，不会存入', () => {
  const saved = P.set({ age: '99999999999999999999' });
  assert.equal(saved.age, undefined);
});
t('set 负数/0 年龄不保存', () => {
  assert.equal(P.set({ age: -3 }).age, undefined);
  assert.equal(P.set({ age: 0 }).age, undefined);
});
t('set 超大体重被丢弃', () => {
  assert.equal(P.set({ weight: '5000' }).weight, undefined);
});
t('set 正常边界值可保存（129 岁 / 299kg / 1 岁 / 1kg）', () => {
  assert.equal(P.set({ age: 129 }).age, 129);
  assert.equal(P.set({ age: 1 }).age, 1);
  assert.equal(P.set({ weight: 299 }).weight, 299);
  assert.equal(P.set({ weight: 1 }).weight, 1);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
