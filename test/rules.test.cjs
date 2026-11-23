const assert = require('node:assert/strict');
const R = require('../src/rules.js');

function t(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; }
}

t('每日三次 -> 08/13/18', () => {
  assert.deepEqual(R.convertFrequency('每日三次').times, ['08:00', '13:00', '18:00']);
});
t('每日二次 -> 08/20', () => {
  assert.deepEqual(R.convertFrequency('每日二次').times, ['08:00', '20:00']);
});
t('每日两次(口语) -> 08/20', () => {
  assert.deepEqual(R.convertFrequency('每日两次').times, ['08:00', '20:00']);
});
t('睡前 -> 21:00', () => {
  assert.deepEqual(R.convertFrequency('睡前').times, ['21:00']);
});
t('数字写法 每日3次', () => {
  assert.deepEqual(R.convertFrequency('每日3次').times, ['08:00', '13:00', '18:00']);
});
t('每12小时1次 -> 08/20', () => {
  assert.deepEqual(R.convertFrequency('每12小时1次').times, ['08:00', '20:00']);
});
t('每8小时1次 -> 三次', () => {
  assert.deepEqual(R.convertFrequency('每8小时1次').times.length, 3);
});
t('每5分钟一次 -> 不换算（急救/静滴写法不猜）', () => {
  assert.deepEqual(R.convertFrequency('每5分钟一次').times, []);
});
t('1日1次（阿拉伯数字日）', () => {
  assert.deepEqual(R.convertFrequency('一般成人1日1次，1次4～8mg').times, ['08:00']);
});
t('早晚各一次 -> 08/20', () => {
  assert.deepEqual(R.convertFrequency('早晚各一次').times, ['08:00', '20:00']);
});
t('分三次服用 -> 08/13/18', () => {
  assert.deepEqual(R.convertFrequency('分三次服用').times, ['08:00', '13:00', '18:00']);
});
t('每日口服1次 / 每晚一次 -> 单次', () => {
  assert.deepEqual(R.convertFrequency('成人每日口服1次10mg').times, ['08:00']);
  assert.deepEqual(R.convertFrequency('晚间一次服用').times, ['21:00']);
});
t('中文一片/一粒同义写法 -> 换算为单次', () => {
  assert.deepEqual(R.convertFrequency('每日早晨口服一片').times, ['08:00']);
  assert.deepEqual(R.convertFrequency('每天1片').times, ['08:00']);
  assert.deepEqual(R.convertFrequency('每日仅需服用一粒').times, ['08:00']);
  assert.equal(R.convertFrequency('每日早晨口服一片').needsCheck, false);
});
t('原文时段词单独保留，不被 08:00 吞掉', () => {
  assert.equal(R.convertFrequency('每日早晨口服一片').timingHint, '早晨');
  assert.equal(R.convertFrequency('每晚一次').timingHint, '晚间');
  assert.equal(R.convertFrequency('每日一次').timingHint, '');
  assert.equal(R.detectTimingHint('每日口服1次，饭前服用'), '饭前');
  assert.equal(R.detectTimingHint('每日1粒，与餐同服'), '随餐');
  assert.equal(R.detectTimingHint('饭前或饭后服用'), '饭前或饭后');
});
t('剂量区间不应被误判为每日一次', () => {
  assert.deepEqual(R.convertFrequency('每日1-2片').times, []);
});
t('顿服 -> 每日一次（规范术语，含义唯一）', () => {
  const c = R.convertFrequency('顿服');
  assert.deepEqual(c.times, ['08:00']);
  assert.equal(c.needsCheck, false);
});
t('早餐时一次服用 -> 每日一次', () => {
  const c = R.convertFrequency('宜在早餐时一次服用');
  assert.deepEqual(c.times, ['08:00']);
  assert.equal(c.needsCheck, false);
});
t('按需服药识别 detectPRN', () => {
  assert.equal(R.detectPRN('必要时每6-8小时一次'), true);
  assert.equal(R.detectPRN('每5分钟可重复0.5mg，直至疼痛缓解'), true);
  assert.equal(R.detectPRN('若持续发热或疼痛,可间隔4-6小时重复用药一次,24小时内不得超过4次'), true);
  assert.equal(R.detectPRN('在活动或大便之前5-10分钟预防性使用'), true);
  assert.equal(R.detectPRN('成人一次0.15g，一日3次，疗程7天'), false);
  assert.equal(R.detectPRN('一次1片，每日二次'), false);
});
t('按需药不因无时间示例挂黄条，固定频次无示例仍挂', () => {
  const base = {
    drug_name: { value: '测试药' }, dosage: { value: '一次一片' },
    source_text: '测试药，一次一片，必要时服用'
  };
  const prn = R.needsHumanCheck(Object.assign({}, base, {
    frequency: { value: '必要时服用', times: [], prn: true }
  }));
  assert.equal(prn.flag, false);
  const unknown = R.needsHumanCheck(Object.assign({}, base, {
    frequency: { value: '某种未识别写法', times: [], prn: false }
  }));
  assert.equal(unknown.flag, true);
});
t('夜间服药与时间示例矛盾 -> 强制挂黄条', () => {
  function rec(freq, times, timingHint) {
    return {
      drug_name: { value: '测试药' }, dosage: { value: '一次一片' },
      frequency: { value: freq, times: times, timingHint: timingHint },
      source_text: '测试药，一次一片，' + freq + '，' + timingHint + '服用'
    };
  }
  const c = R.needsHumanCheck(rec('每日一次', ['08:00'], '睡前'));
  assert.equal(c.flag, true);
  assert.ok(c.reasons.some(x => x.indexOf('矛盾') !== -1));
  const ok = R.needsHumanCheck(rec('每晚一次', ['21:00'], '睡前'));
  assert.equal(ok.flag, false);
});
t('多方案写法 -> 强制挂黄条（原文含多种用法）', () => {
  const E = require('../src/extractor.js');
  const t = '【药品名称】\n通用名称：测试药\n【用法用量】\n成人一日1次。儿童一日3次。\n【不良反应】\n无。';
  const r = E.extractLocal(t);
  assert.equal(r.frequency.multiRegimen, true);
  assert.ok(r.check_reasons.some(x => x.indexOf('多种用法') !== -1));
});
t('区间频次仍不换算', () => {
  assert.deepEqual(R.convertFrequency('一日2-3次').times, []);
});
t('带括号与标点仍能命中', () => {
  assert.deepEqual(R.convertFrequency('口服，一日三次（饭后）').times, ['08:00', '13:00', '18:00']);
});
t('无法识别 -> 空数组并标记需人工确认', () => {
  const r = R.convertFrequency('遵医嘱');
  assert.deepEqual(r.times, []);
  assert.equal(r.needsCheck, true);
});
t('空的频次 -> 需人工确认', () => {
  assert.equal(R.convertFrequency('').needsCheck, true);
});
t('严重关键词定位：命中原句原样返回', () => {
  const text = '常见恶心、呕吐。偶见皮疹。如出现过敏性休克应立即就医。';
  const s = R.locateSevere(text);
  assert.equal(s.length, 1);
  assert.equal(s[0].keyword, '过敏性休克');
  assert.equal(s[0].text, '如出现过敏性休克应立即就医');
});
t('严重关键词：不改写原句', () => {
  const text = '可能出现呼吸困难，需立即停药。';
  assert.equal(R.locateSevere(text)[0].text, '可能出现呼吸困难，需立即停药');
});
t('无严重词 -> 空列表', () => {
  assert.deepEqual(R.locateSevere('常见口干、轻度头晕。'), []);
});
t('常见反应提取', () => {
  const c = R.locateCommon('常见恶心。少见头痛。偶见皮疹。');
  assert.equal(c.length, 3);
});
t('缺字段 -> 需人工确认', () => {
  const r = R.needsHumanCheck({ drug_name: { value: '演示药甲', source: '药品名称：演示药甲' } });
  assert.equal(r.flag, true);
  assert.ok(r.reasons.some(x => x.indexOf('dosage') !== -1));
});
t('字段无出处 -> 需人工确认', () => {
  const r = R.needsHumanCheck({
    drug_name: { value: '演示药甲', source: '无关文本' },
    dosage: { value: '一次1片', source: '用法用量：一次1片' },
    frequency: { value: '每日三次', source: '每日三次', times: ['08:00'] }
  });
  assert.equal(r.flag, true);
  assert.ok(r.reasons.some(x => x.indexOf('出处') !== -1));
});
t('完整记录 -> 通过', () => {
  const r = R.needsHumanCheck({
    drug_name: { value: '演示药甲', source: '药品名称：演示药甲' },
    dosage: { value: '一次1片', source: '用法用量：一次1片' },
    frequency: { value: '每日三次', source: '每日三次', times: ['08:00', '13:00', '18:00'] }
  });
  assert.equal(r.flag, false);
  assert.deepEqual(r.reasons, []);
});
t('外观描述拦截：红白色胶囊', () => {
  assert.equal(R.containsAppearance('阿莫西林是红白色胶囊'), true);
});
t('外观描述拦截：颜色和形状', () => {
  assert.equal(R.containsAppearance('蓝色药片，椭圆形'), true);
  assert.equal(R.containsAppearance('白色小圆片'), true);
});
t('正常药名不误判', () => {
  assert.equal(R.containsAppearance('演示药甲胶囊'), false);
});
