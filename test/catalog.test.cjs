/* 防错目录单测：重点验证不误报、不吓人、不越界。 */
const assert = require('assert');
const C = require('../src/catalog.js');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('ok - ' + name); }
function text(r) { return [r.title, r.detail].join(' '); }
function noScare(r) {
  const s = text(r).replace(/这不代表(这个)?药有问题/g, '');
  ['不存在', '错误药', '假药', '不能吃', '有问题', '禁止使用'].forEach(function (w) {
    assert.ok(s.indexOf(w) === -1, '文案不应出现「' + w + '」: ' + s);
  });
}

t('规格归一：0.25g 与 250mg 视为同一规格文字', function () {
  assert.ok(C.specEqual('0.25g', '250mg'));
  assert.ok(C.specEqual('100μg', '0.1mg'));
  assert.ok(!C.specEqual('0.25g', '0.5g'));
  assert.ok(!C.specEqual('20mg', '20ml'));
});

t('药名+规格都对：状态 ok', function () {
  const r = C.verify('阿莫西林胶囊', '0.25g', []);
  assert.strictEqual(r.status, 'ok');
  noScare(r);
});

t('规格单位不同但等价：仍判 ok，不误报', function () {
  const r = C.verify('二甲双胍片', '500mg', []);
  assert.strictEqual(r.status, 'ok');
});

t('药名对、规格不符：提示核对药盒，不吓人', function () {
  const r = C.verify('阿莫西林胶囊', '5g', []);
  assert.strictEqual(r.status, 'spec_mismatch');
  assert.ok(r.candidates.indexOf('0.25g') !== -1);
  assert.ok(r.candidates.indexOf('0.5g') !== -1);
  assert.ok(text(r).indexOf('请核对') !== -1);
  noScare(r);
});

t('药名没填：提示先填药名', function () {
  assert.strictEqual(C.verify('', '0.25g', []).status, 'no_input');
});

t('目录未收录：明确说不代表药有问题', function () {
  const r = C.verify('某种很少见的药', '10mg', []);
  assert.strictEqual(r.status, 'name_not_found');
  assert.ok(text(r).indexOf('这不代表这个药有问题') !== -1);
  noScare(r);
});

t('未填规格：提示补规格，不判错', function () {
  const r = C.verify('阿莫西林胶囊', '', []);
  assert.strictEqual(r.status, 'need_spec');
  assert.ok(r.candidates.length > 0);
});

t('药名简写：给出相近药名提示，不替用户拍板', function () {
  const r = C.verify('阿莫西林', '0.25g', []);
  assert.strictEqual(r.status, 'name_hint');
  assert.ok(text(r).indexOf('请确认') !== -1);
});

t('外观描述被拦截，且说明原因与替代做法', function () {
  ['红白色胶囊', '蓝色椭圆形药片', '白色小圆片'].forEach(function (d) {
    const r = C.verify(d, '0.25g', []);
    assert.strictEqual(r.status, 'blocked_appearance');
    assert.ok(text(r).indexOf('误食') !== -1, '应说明拦截原因');
    assert.ok(text(r).indexOf('请改用') !== -1, '应说明该填什么');
  });
});

t('CSV 导入只取身份字段，跳过表头与空行', function () {
  const csv = '药名,规格,厂家,批准文号\n测试药甲片,10mg,某厂家,国药准字H0001\n\n测试药乙片,20mg';
  const out = C.parseCsv(csv);
  assert.strictEqual(out.entries.length, 2);
  assert.strictEqual(out.entries[0].name, '测试药甲片');
  assert.strictEqual(out.entries[0].approval, '国药准字H0001');
  assert.strictEqual(out.entries[1].maker, '');
});

t('导入的目录参与核对', function () {
  const custom = [{ name: '测试药甲片', spec: '10mg', maker: '', approval: '' }];
  assert.strictEqual(C.verify('测试药甲片', '10mg', custom).status, 'ok');
  assert.strictEqual(C.verify('测试药甲片', '99mg', custom).status, 'spec_mismatch');
});

t('内置目录不含用法用量字段', function () {
  C.BUILTIN.forEach(function (e) {
    assert.deepStrictEqual(Object.keys(e).sort(), ['approval', 'builtin', 'maker', 'name', 'spec']);
  });
});

console.log('\n' + pass + ' 项全部通过');
