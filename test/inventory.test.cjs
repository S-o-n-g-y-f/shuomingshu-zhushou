const assert = require('node:assert/strict');
const I = require('../src/inventory.js');

function t(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; }
}
function item(id, name, times) {
  return { id: id, drug_name: { value: name }, frequency: { times: times || [] } };
}

t('同一时间 -> 报同一时间观察', () => {
  const f = I.detectTimeConflicts([item('a', '药甲', ['08:00']), item('b', '药乙', ['08:00'])]);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, 'same_time');
  assert.ok(f[0].message.indexOf('请核对') !== -1);
});
t('相隔20分钟 -> 报过近观察', () => {
  const f = I.detectTimeConflicts([item('a', '药甲', ['08:00']), item('b', '药乙', ['08:20'])]);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, 'close_time');
});
t('相隔60分钟 -> 不报', () => {
  const f = I.detectTimeConflicts([item('a', '药甲', ['08:00']), item('b', '药乙', ['09:00'])]);
  assert.equal(f.length, 0);
});
t('同一药自身两个时间点 -> 不报冲突', () => {
  const f = I.detectTimeConflicts([item('a', '药甲', ['08:00', '08:15'])]);
  assert.equal(f.length, 0);
});
t('同一药多时间点与其他药同时间 -> 只报一次', () => {
  const f = I.detectTimeConflicts([item('a', '药甲', ['08:00', '13:00']), item('b', '药乙', ['08:00'])]);
  assert.equal(f.length, 1);
});
t('跨天边界 23:50 与 00:10 不误报为过近', () => {
  const f = I.detectTimeConflicts([item('a', '药甲', ['00:10']), item('b', '药乙', ['23:50'])]);
  assert.equal(f.length, 0);
});
t('非法时间 -> 忽略不报错', () => {
  const f = I.detectTimeConflicts([item('a', '药甲', ['25:99']), item('b', '药乙', ['08:00'])]);
  assert.equal(f.length, 0);
});
t('无时间 -> 报缺失观察', () => {
  const f = I.detectMissingTimes([item('a', '药甲', [])]);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, 'missing_time');
});
t('同名 -> 报疑似重复', () => {
  const f = I.detectDuplicates([item('a', '演示药甲', ['08:00']), item('b', '演示药甲', ['20:00'])]);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, 'duplicate_name');
});
t('不同名 -> 不报重复', () => {
  const f = I.detectDuplicates([item('a', '药甲', []), item('b', '药乙', [])]);
  assert.equal(f.length, 0);
});
t('提示文案不含相互作用判断', () => {
  const all = I.review([item('a', '药甲', ['08:00']), item('b', '药乙', ['08:00'])]).map(x => x.message).join('');
  assert.ok(all.indexOf('相互作用') === -1);
  assert.ok(all.indexOf('不能一起吃') === -1);
  assert.ok(all.indexOf('禁忌') === -1);
});
t('排序：有时间在前，按时间升序', () => {
  const s = I.sorted([item('c', '无时间', []), item('b', '晚', ['20:00']), item('a', '早', ['08:00'])]);
  assert.deepEqual(s.map(x => x.id), ['a', 'b', 'c']);
});
t('时间解析：非法值返回 null', () => {
  assert.equal(I.timeToMinutes('25:00'), null);
  assert.equal(I.timeToMinutes('abc'), null);
  assert.equal(I.timeToMinutes('08:00'), 480);
});
