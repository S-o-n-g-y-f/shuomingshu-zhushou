/* 抽取层测试：用真实说明书格式（【标题】分段）验证字段定位。 */
const assert = require('assert');
const E = require('../src/extractor.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}

const STANDARD = `
【药品名称】
通用名称：布洛芬缓释胶囊
英文名称：Ibuprofen Sustained-release Capsules

【成份】
本品主要成分布洛芬。

【适应症】
适用于缓解下列症状：牙痛、头痛。

【规格】
0.3g

【用法用量】
口服。成人，一次1粒，一日2次（早晚各一次）。

【不良反应】
1.少数病人可出现恶心、呕吐、胃烧灼感。
2.罕见皮疹、过敏性肾炎。

【禁忌】
1.对其他非甾体抗炎药过敏者禁用。
2.孕妇及哺乳期妇女禁用。

【批准文号】
国药准字H22026099
`;

t('标准格式：药名取自"通用名称："行，不再抓到"】"', function () {
  const r = E.extractLocal(STANDARD);
  assert.strictEqual(r.drug_name.value, '布洛芬缓释胶囊');
});

t('标准格式：规格取"【规格】"段落', function () {
  const r = E.extractLocal(STANDARD);
  assert.strictEqual(r.specification.value, '0.3g');
});

t('标准格式：用量取"一次1粒"，频次取"一日2次"', function () {
  const r = E.extractLocal(STANDARD);
  assert.ok(r.dosage.value.indexOf('1粒') !== -1, '用量应含1粒，实际:' + r.dosage.value);
  assert.strictEqual(r.frequency.value, '一日2次');
});

t('频次支持"每日2-3次"这种区间写法', function () {
  const r = E.extractLocal('【用法用量】\n局部外用，用时摇匀，取适量涂于患处，每日2-3次。\n【禁忌】\n尚不明确。');
  assert.ok(r.frequency.value.indexOf('每日2-3次') !== -1, '实际:' + r.frequency.value);
});

t('无"一次"句式时用量退回首句，不空缺', function () {
  const r = E.extractLocal('【用法用量】\n治疗时应尽可能按个体情况用药。一次30mg，一日1次。\n【禁忌】\n尚不明确。');
  assert.ok(r.dosage.value.length > 0);
});

t('段落缺失时仍诚实挂"需人工确认"，不编造', function () {
  const r = E.extractLocal('【药品名称】\n通用名称：某药片\n【用法用量】\n一次1片。\n');
  assert.strictEqual(r.adverse.full, '');
  assert.ok(r.needs_human_check === true);
});

t('非标准格式（无【】分段）走旧逻辑不崩', function () {
  const r = E.extractLocal('药品名称：测试药片\n规格：10mg\n用法用量：一次1片，每日三次。\n');
  assert.strictEqual(r.drug_name.value, '测试药片');
  assert.ok(r.frequency.value.indexOf('三次') !== -1);
});

console.log('\n抽取层: ' + passed + ' 通过, ' + failed + ' 失败');
if (failed > 0) process.exit(1);
