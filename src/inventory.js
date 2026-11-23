/* 用药清单：本地存储 + 时间层面的冲突观察。
   边界：只做「同一时间」「间隔过近」「疑似重复」「时间缺失」四类纯时间与文本观察。
   不做药物相互作用、不做剂量建议、不判断能不能一起吃——那属于医疗建议。 */
(function (root, factory) {
  const R = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.MedRules;
  const api = factory(R);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MedInventory = api;
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const KEY = 'med-reader.inventory.v1';

  function timeToMinutes(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  // 纯时间观察：不判断药物能否同服，只提示"时间被排在一起，请核对"。
  function detectTimeConflicts(items, thresholdMinutes) {
    const gap = thresholdMinutes == null ? 30 : thresholdMinutes;
    const entries = [];
    items.forEach(function (it) {
      ((it.frequency && it.frequency.times) || []).forEach(function (tm) {
        const mins = timeToMinutes(tm);
        if (mins != null) entries.push({ id: it.id, name: (it.drug_name && it.drug_name.value) || '未命名', time: tm, mins: mins });
      });
    });
    entries.sort(function (a, b) { return a.mins - b.mins; });

    const flags = [];
    const seenPairs = Object.create(null);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j];
        const diff = b.mins - a.mins;
        if (diff > gap) break;
        if (a.id === b.id) continue; // 同一药多次服药不算冲突
        const pair = [a.id, b.id].sort().join('|') + '@' + a.time + '-' + b.time;
        if (seenPairs[pair]) continue;
        seenPairs[pair] = true;
        flags.push({
          type: diff === 0 ? 'same_time' : 'close_time',
          ids: [a.id, b.id],
          names: [a.name, b.name],
          times: [a.time, b.time],
          message: diff === 0
            ? a.name + ' 与 ' + b.name + ' 都排在 ' + a.time + '，请核对说明书或咨询药师'
            : a.name + '（' + a.time + '）与 ' + b.name + '（' + b.time + '）相隔不足 ' + gap + ' 分钟，请核对'
        });
      }
    }
    return flags;
  }

  // 文本观察：药名完全相同视为疑似重复录入（不判断是否同类药）。
  function detectDuplicates(items) {
    const byName = Object.create(null);
    items.forEach(function (it) {
      const n = R.normalize((it.drug_name && it.drug_name.value) || '').toLowerCase();
      if (!n) return;
      (byName[n] || (byName[n] = [])).push(it);
    });
    const flags = [];
    Object.keys(byName).forEach(function (n) {
      const group = byName[n];
      if (group.length > 1) {
        flags.push({
          type: 'duplicate_name',
          ids: group.map(function (g) { return g.id; }),
          message: '清单里有 ' + group.length + ' 条同名记录「' + group[0].drug_name.value + '」，请确认是否重复添加'
        });
      }
    });
    return flags;
  }

  // 时间缺失观察
  function detectMissingTimes(items) {
    return items
      .filter(function (it) { return !((it.frequency && it.frequency.times) || []).length; })
      .map(function (it) {
        return {
          type: 'missing_time',
          ids: [it.id],
          message: (it.drug_name && it.drug_name.value) || '未命名' + ' 没有可显示的时间，请看纸质说明书'
        };
      });
  }

  function review(items) {
    return [].concat(
      detectTimeConflicts(items),
      detectDuplicates(items),
      detectMissingTimes(items)
    );
  }

  function load() {
    try {
      const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function save(items) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(items));
      return true;
    } catch (e) { return false; }
  }

  function add(items, record) {
    const next = items.slice();
    next.push(Object.assign({}, record, { id: record.id || ('m' + Date.now() + Math.floor(Math.random() * 1000)), addedAt: Date.now() }));
    save(next);
    return next;
  }

  function remove(items, id) {
    const next = items.filter(function (x) { return x.id !== id; });
    save(next);
    return next;
  }

  function update(items, id, patch) {
    const next = items.map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; });
    save(next);
    return next;
  }

  // 按时间排序用于清单展示；无时间的排最后
  function sorted(items) {
    return items.slice().sort(function (a, b) {
      const at = ((a.frequency && a.frequency.times) || [])[0];
      const bt = ((b.frequency && b.frequency.times) || [])[0];
      const am = timeToMinutes(at), bm = timeToMinutes(bt);
      if (am == null && bm == null) return 0;
      if (am == null) return 1;
      if (bm == null) return -1;
      return am - bm;
    });
  }

  return {
    KEY: KEY,
    timeToMinutes: timeToMinutes,
    detectTimeConflicts: detectTimeConflicts,
    detectDuplicates: detectDuplicates,
    detectMissingTimes: detectMissingTimes,
    review: review,
    load: load,
    save: save,
    add: add,
    remove: remove,
    update: update,
    sorted: sorted
  };
});
