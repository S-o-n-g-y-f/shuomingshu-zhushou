/* 主流程：拍照/粘贴 -> 核对 -> 大字卡片 -> 导出。 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const state = {
    record: null,
    photoDataUrl: null,
    photoFile: null,
    items: MedInventory.load(),
    view: 'single',
    entry: 'family'
  };

  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  }

  // 外观描述被拦截时，弹窗解释原因——只拦不说理，用户会当成 bug。
  function openAppearanceModal() {
    $('appearanceModal').classList.remove('hidden');
  }

  function setStep(n) {
    [1, 2, 3].forEach(function (i) {
      $('panel-' + i).classList.toggle('hidden', i !== n);
      const badge = document.querySelector('.step[data-step="' + i + '"]');
      badge.classList.toggle('active', i === n);
      badge.classList.toggle('done', i < n);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setView(v) {
    state.view = v;
    $('navSingle').classList.toggle('active', v === 'single');
    $('navList').classList.toggle('active', v === 'list');
    document.querySelector('.step-indicator').classList.toggle('hidden', v === 'list');
    if (v === 'list') {
      ['panel-1', 'panel-2', 'panel-3'].forEach(function (id) { $(id).classList.add('hidden'); });
      $('panel-list').classList.remove('hidden');
      renderList();
    } else {
      $('panel-list').classList.add('hidden');
      setStep(state.record ? 3 : 1);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setEntry(mode) {
    state.entry = mode;
    document.querySelectorAll('.entry-card').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-entry') === mode);
    });
    $('familyForm').classList.toggle('hidden', mode !== 'family');
    $('selfForm').classList.toggle('hidden', mode !== 'self');
  }

  // 把目录核对结果显示成一段人话。warn/danger 只改变颜色，不改变"请核对"的口径。
  function renderVerify(box, result) {
    if (!box || !result) return;
    box.className = 'verify-box';
    if (result.status === 'spec_mismatch' || result.status === 'name_hint') box.classList.add('warn');
    if (result.status === 'blocked_appearance') box.classList.add('danger');
    let html = '<strong>' + escapeHtml(result.title) + '</strong>' +
      '<p>' + escapeHtml(result.detail) + '</p>';
    if (result.candidates && result.candidates.length) {
      html += '<p class="verify-candidates">目录里这个药名记录的规格：' +
        result.candidates.map(escapeHtml).join('、') + '</p>';
    }
    html += '<p class="verify-note">目录只是帮您看一眼文字有没有抄错，不是药品库，也不判断药能不能用；查不到不代表药有问题，请以药盒和说明书为准。</p>';
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  function familyVerify() {
    const result = MedCatalog.verify($('familyDrug').value, $('familySpec').value);
    renderVerify($('familyVerify'), result);
    return result;
  }

  function handleFamilyPhoto(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      state.photoDataUrl = e.target.result;
      $('familyPhotoPreview').src = state.photoDataUrl;
      $('familyPhotoPreviewWrap').classList.remove('hidden');
      showToast('药盒照片已就绪，只作为留底');
    };
    reader.readAsDataURL(file);
  }

  // 家人代录：照抄药盒与医生原话，构造与抽取层同结构的记录。
  function familyToCheck() {
    const name = $('familyDrug').value.trim();
    const spec = $('familySpec').value.trim();
    const usage = $('familyUsage').value.trim();
    const freq = $('familyFreq').value.trim();
    if (!name) { showToast('请照药盒填写药名'); return; }
    if (!usage) { showToast('请填写医生说的用法原话'); return; }
    // 外观检查覆盖全部代录文字：用法原话里写"红色胶囊一次一片"同样要拦（外观正则不会误伤"一次一片"这类正常用量）
    if (MedRules.containsAppearance(name + ' ' + spec + ' ' + usage + ' ' + freq)) {
      openAppearanceModal();
      return;
    }
    const conv = MedRules.convertFrequency(freq);
    const timingHint = conv.timingHint || MedRules.detectTimingHint(usage + ' ' + freq);
    const timesRaw = $('familyTimes').value.trim();
    const times = timesRaw ? timesRaw.split(/[\/、,，\s]+/).filter(Boolean) : conv.times;
    const srcLines = [
      '【家人代录】药名原文：' + name,
      '规格原文：' + (spec || '未填写'),
      '医生说的用法原话：' + usage,
      '服用次数原话：' + (freq || '未填写')
    ];
    const record = {
      drug_name: { value: name, source: name },
      specification: { value: spec, source: spec || '未填写' },
      dosage: { value: usage, source: usage },
      frequency: {
        value: freq || '未填写',
        source: freq || '未填写',
        times: times,
        timeExample: times.join(' / '),
        timingHint: timingHint
      },
      adverse: { severe: [], common: [], full: '家人代录未包含不良反应原文' },
      contraindications: [],
      source_text: srcLines.join('\n'),
      entry_mode: 'family',
      needs_human_check: false,
      check_reasons: []
    };
    const check = MedRules.needsHumanCheck(record);
    record.needs_human_check = check.flag;
    record.check_reasons = check.reasons;
    state.record = record;
    fillEditForm(record);
    const v = MedCatalog.verify(name, spec);
    renderVerify($('catalogBanner'), v);
    setStep(2);
  }

  function renderCatalogStatus() {
    const n = MedCatalog.allEntries(MedCatalog.loadCustom()).length;
    $('catalogStatus').textContent = '当前目录共 ' + n + ' 条（含内置演示样本）。导入只在您的浏览器里保存，不上传。';
  }

  function importCatalog(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const out = MedCatalog.parseCsv(e.target.result);
      if (!out.entries.length) { showToast('没读到有效数据，请检查 CSV 格式'); return; }
      MedCatalog.saveCustom(out.entries);
      renderCatalogStatus();
      showToast('已导入 ' + out.entries.length + ' 条到本地目录');
    };
    reader.readAsText(file, 'UTF-8');
  }

  function renderSamples() {
    const box = $('sampleButtons');
    MedSamples.forEach(function (s) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sample-btn';
      b.textContent = s.title;
      b.addEventListener('click', function () {
        $('textInput').value = s.text;
        showToast('已填入演示样张，点「提取文字」继续');
      });
      box.appendChild(b);
    });
  }

  function handlePhoto(file) {
    if (!file) return;
    // 修复：原写法 !file.type.indexOf('image/') === 0 因运算符优先级永远是 false，校验形同虚设
    if (file.type.indexOf('image/') !== 0) { showToast('请选择图片文件'); return; }
    state.photoFile = file;
    state.fromOcr = false;
    $('ocrBlock').classList.add('hidden');
    const reader = new FileReader();
    reader.onload = function (e) {
      state.photoDataUrl = e.target.result;
      $('photoPreview').src = state.photoDataUrl;
      $('photoPreviewWrap').classList.remove('hidden');
      // OCR 是可选步骤：组件可用才展示按钮，不可用整块隐藏，主流程不受影响
      if (typeof MedOCR !== 'undefined' && MedOCR.isAvailable()) {
        $('ocrStatus').textContent = '';
        $('ocrBlock').classList.remove('hidden');
      }
      showToast('照片已就绪，可以手动补填文字');
    };
    reader.readAsDataURL(file);
  }

  async function runOcrFlow() {
    if (!state.photoDataUrl) { showToast('请先选择一张照片'); return; }
    const btn = $('ocrBtn');
    const status = $('ocrStatus');
    btn.disabled = true;
    status.textContent = '正在识别，请稍等十几秒……';
    try {
      const res = await MedOCR.recognize(state.photoDataUrl);
      btn.disabled = false;
      if (res.ok) {
        $('textInput').value = res.text;
        state.lastOcrText = res.text;
        status.textContent = '识别完成，文字已填到下面。请先自己读一遍，改掉认错的字，再点「提取文字」。';
        showToast('识别完成，请核对后再提取');
      } else {
        status.textContent = res.message;
      }
    } catch (e) {
      btn.disabled = false;
      status.textContent = '识别失败，请直接粘贴说明书文字。';
    }
  }

  function doExtract() {
    const text = $('textInput').value.trim();
    if (!text && !state.photoDataUrl) {
      showToast('请先粘贴文字或选择一张照片');
      return;
    }
    if (!text) {
      showToast('照片需要对应文字才能提取；没有 OCR 时请手动粘贴说明书原文');
      return;
    }
    // AI 提示只在"当前文本确实来自识别"时出现；用户改过字就当自己的原文
    state.fromOcr = (state.lastOcrText != null && state.lastOcrText === text);
    const rec = MedExtractor.extractLocal(text);
    rec.entry_mode = 'self';
    state.record = rec;
    fillEditForm(rec);
    renderVerify($('catalogBanner'), MedCatalog.verify(rec.drug_name.value, rec.specification.value));
    setStep(2);
  }

  function fillEditForm(r) {
    $('editDrug').value = r.drug_name.value;
    $('editSpec').value = r.specification.value;
    $('editDosage').value = r.dosage.value;
    $('editFreq').value = r.frequency.value;
    $('editTimes').value = r.frequency.times.join(' / ');
    $('srcDrug').textContent = '原文：' + (r.drug_name.source || '未找到');
    $('srcSpec').textContent = '原文：' + (r.specification.source || '未找到');
    $('srcDosage').textContent = '原文：' + (r.dosage.source || '未找到');
    $('srcFreq').textContent = '原文：' + (r.frequency.source || '未找到');
    $('rawText').textContent = r.source_text;

    const timing = r.frequency.timingHint || '';
    const timingEl = $('timingHint');
    if (timing) {
      timingEl.textContent = '说明书原文写的是「' + timing + '」服用；上面的时间只是示例，请以原文为准。';
      timingEl.classList.remove('hidden');
    } else timingEl.classList.add('hidden');

    const banner = $('checkBanner');
    if (r.needs_human_check) {
      banner.innerHTML = '<strong>请确认后再使用</strong>' + r.check_reasons.join('；');
      banner.classList.remove('hidden');
    } else banner.classList.add('hidden');

    // OCR 来源提示：AI 识别可能认错字（尤其数字与规格），必须逐字对照照片核对
    const ocrNote = $('ocrNote');
    if (state.fromOcr) {
      ocrNote.textContent = '这些文字来自 AI 拍照识别。AI 可能认错字（尤其是剂量里的数字和单位），每个字段都请对照照片或药盒核对。';
      ocrNote.classList.remove('hidden');
    } else ocrNote.classList.add('hidden');
  }

  function syncEdits() {
    const r = state.record;
    if (!r) return;
    r.drug_name.value = $('editDrug').value.trim();
    r.specification.value = $('editSpec').value.trim();
    r.dosage.value = $('editDosage').value.trim();
    r.frequency.value = $('editFreq').value.trim();
    const timesRaw = $('editTimes').value.trim();
    r.frequency.times = timesRaw ? timesRaw.split(/[\/、,，\s]+/).filter(Boolean) : [];
    r.frequency.timeExample = r.frequency.times.join(' / ');
    r.frequency.timingHint = MedRules.detectTimingHint(r.dosage.value + ' ' + r.frequency.value);
    if (r.entry_mode === 'family') {
      r.source_text = [
        '【家人代录】药名原文：' + r.drug_name.value,
        '规格原文：' + r.specification.value,
        '医生说的用法原话：' + r.dosage.value,
        '服用次数原话：' + r.frequency.value
      ].join('\n');
    }
    const check = MedRules.needsHumanCheck(r);
    r.needs_human_check = check.flag;
    r.check_reasons = check.reasons;
    renderVerify($('catalogBanner'), MedCatalog.verify(r.drug_name.value, r.specification.value));
  }

  function renderCard() {
    // 卡片渲染用的是"应用了服药人信息之后"的记录：多方案原文会按年龄选出对应人群段落
    const r = MedPatient.applyPatient(state.record, MedPatient.get());
    state.effective = r;
    $('cardDrug').textContent = r.drug_name.value || '未识别';
    $('cardSpec').textContent = r.specification.value ? '规格：' + r.specification.value : '';
    $('cardDosage').textContent = r.dosage.value || '原文未识别';
    $('cardFreq').textContent = r.frequency.value || '原文未识别';

    const box = $('cardTimes');
    box.innerHTML = '';
    if (r.frequency.times.length) {
      r.frequency.times.forEach(function (t) {
        const chip = document.createElement('span');
        chip.className = 'time-chip';
        chip.textContent = t;
        box.appendChild(chip);
      });
    } else if (r.frequency.prn) {
      const n = document.createElement('span');
      n.className = 'time-none';
      n.textContent = '按需服药：这类药不是按固定时间吃的（如疼了才吃），请按说明书说的情形使用';
      box.appendChild(n);
    } else {
      const n = document.createElement('span');
      n.className = 'time-none';
      n.textContent = '未能换算时间，请查看纸质说明书或咨询药师';
      box.appendChild(n);
    }

    const cardTiming = $('cardTimingHint');
    if (r.frequency.timingHint) {
      cardTiming.textContent = '原文要求「' + r.frequency.timingHint + '」服用，上方时间仅为示例';
      cardTiming.classList.remove('hidden');
    } else cardTiming.classList.add('hidden');

    const warn = $('cardWarn');
    if (r.needs_human_check) {
      warn.textContent = '请确认或咨询药师：' + r.check_reasons.join('；');
      warn.classList.remove('hidden');
    } else warn.classList.add('hidden');

    const pNote = $('patientNote');
    if (r.patientApplied) {
      const p = MedPatient.get();
      pNote.textContent = (p && p.nickname ? p.nickname + '（' + r.patientApplied.age + '岁）：' : '') + r.patientApplied.note;
      pNote.classList.remove('hidden');
    } else pNote.classList.add('hidden');

    const severe = $('cardSevere');
    severe.innerHTML = '';
    const severeList = (r.adverse && r.adverse.severe) || [];
    severeList.forEach(function (s) {
      const li = document.createElement('li');
      li.textContent = s.text;
      severe.appendChild(li);
    });
    if (!severeList.length) {
      const li = document.createElement('li');
      li.textContent = '原文未识别到需特别关注的描述，请查看完整原文';
      severe.appendChild(li);
    }

    $('cardCommon').textContent = ((r.adverse && r.adverse.common) || []).join('；') || '原文未识别';
    $('cardAdverseFull').textContent = (r.adverse && r.adverse.full) || '原文未识别';

    const contra = $('contraSection');
    if (r.contraindications && r.contraindications.length) {
      $('cardContra').textContent = r.contraindications.join('；');
      contra.classList.remove('hidden');
    } else contra.classList.add('hidden');

    if (state.photoDataUrl) {
      $('cardPhoto').src = state.photoDataUrl;
      $('cardPhoto').classList.remove('hidden');
    } else $('cardPhoto').classList.add('hidden');

    setStep(3);
  }

  function speak() {
    // 与卡片同一口径：多方案原文按服药人年龄选段后朗读，避免读出不适用的方案
    const r = state.effective || MedPatient.applyPatient(state.record, MedPatient.get());
    if (!r) return;
    if (!('speechSynthesis' in window)) { showToast('当前浏览器不支持朗读'); return; }
    window.speechSynthesis.cancel();
    const parts = [
      (r.drug_name.value || '') + '，规格' + (r.specification.value || '未识别'),
      '怎么吃：' + (r.dosage.value || '原文未识别'),
      r.frequency.value ? '服用次数：' + r.frequency.value : '',
      r.frequency.times.length ? '常见时间示例：' + r.frequency.times.join('，') : ''
    ].concat((r.adverse.severe || []).map(function (s) { return '注意，' + s.text; }));
    parts.push('请凭药盒和药名确认，不要凭颜色形状认药。仅帮您看清说明书原文，不提供用药建议，请以纸质说明书和医嘱为准。');
    const u = new SpeechSynthesisUtterance(parts.filter(Boolean).join('。'));
    u.lang = 'zh-CN';
    u.rate = 0.85;
    window.speechSynthesis.speak(u);
    showToast('正在朗读，再点一次可停止');
  }

  function stopSpeak() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function exportCard() {
    if (!state.record) return;
    // 导出的卡片图片同样按服药人应用人群方案，与界面所见一致
    MedCard.exportCard(MedPatient.applyPatient(state.record, MedPatient.get()), state.photoDataUrl, function (dataUrl, err) {
      if (err) {
        if (err.indexOf('外观') !== -1) { openAppearanceModal(); } else { showToast(err); }
        return;
      }
      $('cardImage').src = dataUrl;
      $('imageModal').classList.remove('hidden');
    });
  }

  function addCurrentToList() {
    if (!state.record) return;
    const rec = state.record;
    if (!rec.drug_name.value) { showToast('请先填写药品名称'); return; }
    // 存快照，避免后续修改影响已加入的记录
    state.items = MedInventory.add(state.items, JSON.parse(JSON.stringify(rec)));
    renderList();
    updateCount();
    showToast('已加入清单，可在「我的用药清单」查看');
    $('addHint').textContent = '已加入清单。想加下一种药，点下方「再添一种药」。';
  }

  function updateCount() {
    $('navCount').textContent = String(state.items.length);
  }

  /* ---------- 服药人信息（可跳过） ---------- */

  const PATIENT_SEEN_KEY = 'med_patient_seen_v1';

  function describePatient(p) {
    if (!p) return '';
    const parts = [];
    if (p.nickname) parts.push(p.nickname);
    if (p.gender) parts.push(p.gender);
    if (p.age) parts.push(p.age + '岁');
    if (p.weight) parts.push(p.weight + 'kg');
    return parts.join(' · ');
  }

  function renderPatientChip() {
    const p = MedPatient.get();
    const chip = $('patientChip');
    if (p && (p.age || p.nickname || p.gender || p.weight)) {
      chip.textContent = '👤 服药人：' + describePatient(p) + '（点按修改）';
    } else {
      chip.textContent = '👤 设置服药人信息（可不填，用于区分大人/孩子的用法）';
    }
  }

  function openPatientOnboard() {
    const p = MedPatient.get() || {};
    $('ptNickname').value = p.nickname || '';
    $('ptGender').value = p.gender || '';
    $('ptAge').value = p.age != null ? p.age : '';
    $('ptWeight').value = p.weight != null ? p.weight : '';
    patientErr('');
    $('patientOnboard').classList.remove('hidden');
  }

  function closePatientOnboard() {
    $('patientOnboard').classList.add('hidden');
    try { localStorage.setItem(PATIENT_SEEN_KEY, '1'); } catch (e) { /* 忽略 */ }
    renderPatientChip();
    // 服药人变了，当前卡片和清单都要按新人重新渲染
    if (state.record && state.view === 'single' && !$('panel-3').classList.contains('hidden')) {
      renderCard();
    }
    if (state.view === 'list') renderList();
  }

  function renderList() {
    const items = state.items;
    updateCount();
    renderPatientChip();
    const empty = $('emptyList');
    const body = $('listBody');
    const reviewBox = $('reviewBox');
    const exportBlock = $('listExportBlock');

    if (!items.length) {
      empty.classList.remove('hidden');
      body.classList.add('hidden');
      reviewBox.classList.add('hidden');
      exportBlock.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');
    body.classList.remove('hidden');
    exportBlock.classList.remove('hidden');

    // 冲突检测同样基于"应用服药人之后"的时间安排
    const flags = MedInventory.review(items.map(function (it) {
      return MedPatient.applyPatient(it, MedPatient.get());
    }));
    if (flags.length) {
      reviewBox.classList.remove('hidden');
      reviewBox.classList.remove('ok');
      reviewBox.innerHTML = '<h3>请核对以下事项（共 ' + flags.length + ' 条）</h3><ul>' +
        flags.map(function (f) { return '<li>' + escapeHtml(f.message) + '</li>'; }).join('') +
        '</ul><p class="review-note">这些只是时间和名称上的观察，不代表药物不能同服。请核对纸质说明书，或咨询医生、药师。</p>';
    } else {
      reviewBox.classList.remove('hidden');
      reviewBox.classList.add('ok');
      reviewBox.innerHTML = '<h3>时间上没有发现需要核对的安排</h3><p class="review-note">这不代表药物之间没有问题。清单不做药物相互作用判断，请以纸质说明书和医嘱为准。</p>';
    }

    body.innerHTML = '';
    MedInventory.sorted(items).forEach(function (raw) {
      // 每条按当前服药人重新应用人群选择：服药人改了，清单自动跟着变
      const it = MedPatient.applyPatient(raw, MedPatient.get());
      const div = document.createElement('div');
      div.className = 'med-item';
      const times = (it.frequency && it.frequency.times) || [];
      const severe = (it.adverse && it.adverse.severe) || [];
      const timesHtml = times.length
        ? times.map(function (x) { return '<span class="med-time">' + escapeHtml(x) + '</span>'; }).join('')
        : (it.frequency && it.frequency.prn
          ? '<span class="med-time prn">按需服药 · 无固定时间</span>'
          : '<span class="med-time missing">未识别到时间，请看纸质说明书</span>');
      const severeHtml = severe.length
        ? '<div class="med-severe"><span>' + severe.slice(0, 3).map(function (s) { return escapeHtml(s.text); }).join('</span><span>') + '</span></div>'
        : '';
      div.innerHTML =
        '<div class="med-item-head"><div>' +
        '<p class="med-item-name">' + escapeHtml((it.drug_name && it.drug_name.value) || '未命名') + '</p>' +
        (it.specification && it.specification.value ? '<p class="med-item-spec">规格：' + escapeHtml(it.specification.value) + '</p>' : '') +
        '</div><button type="button" class="del-btn" data-id="' + escapeHtml(it.id) + '">删除</button></div>' +
        '<div class="med-item-row"><span class="lbl">用量</span><span class="val">' + escapeHtml((it.dosage && it.dosage.value) || '原文未识别') + '</span></div>' +
        '<div class="med-item-row"><span class="lbl">服用次数</span><span class="val small">' + escapeHtml((it.frequency && it.frequency.value) || '原文未识别') + '</span></div>' +
        '<div class="med-times">' + timesHtml + '</div>' +
        severeHtml +
        '<details class="med-item-fold"><summary>原文与提示</summary>' +
        '<p class="safety-note">用法用量原文：' + escapeHtml((it.dosage && it.dosage.source) || '未找到') + '</p>' +
        '<p class="safety-note">请凭药盒和药名确认，不要凭颜色形状认药。</p>' +
        '<p class="safety-note">仅帮您看清说明书原文，不提供用药建议，请以纸质说明书和医嘱为准。</p>' +
        '</details>';
      body.appendChild(div);
    });

    body.querySelectorAll('.del-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-id');
        if (!window.confirm('确定从清单中删除这条记录吗？')) return;
        state.items = MedInventory.remove(state.items, id);
        renderList();
        showToast('已删除');
      });
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function exportList() {
    if (!state.items.length) return;
    // 导出的图片给老人贴在药箱上，必须和界面一样按服药人应用人群方案
    const applied = state.items.map(function (it) {
      return MedPatient.applyPatient(it, MedPatient.get());
    });
    MedCard.exportList(applied, MedInventory.review(applied), function (dataUrl, err) {
      if (err) {
        if (err.indexOf('外观') !== -1) { openAppearanceModal(); } else { showToast(err); }
        return;
      }
      $('cardImage').src = dataUrl;
      $('imageModal').classList.remove('hidden');
    });
  }

  // 绑定
  renderSamples();
  renderCatalogStatus();
  document.querySelectorAll('.entry-card').forEach(function (b) {
    b.addEventListener('click', function () { setEntry(b.getAttribute('data-entry')); });
  });
  ['familyDrug', 'familySpec'].forEach(function (id) {
    $(id).addEventListener('input', familyVerify);
  });
  $('familyPhotoInput').addEventListener('change', function (e) { handleFamilyPhoto(e.target.files[0]); });
  $('familyClearPhoto').addEventListener('click', function () {
    state.photoDataUrl = null;
    $('familyPhotoPreviewWrap').classList.add('hidden');
    $('familyPhotoInput').value = '';
  });
  $('familyToCheck').addEventListener('click', familyToCheck);
  $('catalogFile').addEventListener('change', function (e) { importCatalog(e.target.files[0]); });
  $('resetCatalog').addEventListener('click', function () {
    MedCatalog.saveCustom([]);
    renderCatalogStatus();
    showToast('已恢复内置演示目录');
  });
  $('photoInput').addEventListener('change', function (e) { handlePhoto(e.target.files[0]); });
  $('ocrBtn') && $('ocrBtn').addEventListener('click', runOcrFlow);
  $('clearPhoto').addEventListener('click', function () {
    state.photoDataUrl = null; state.photoFile = null; state.lastOcrText = null;
    $('photoPreviewWrap').classList.add('hidden');
    $('ocrBlock').classList.add('hidden');
    $('ocrStatus').textContent = '';
    $('photoInput').value = '';
  });
  $('toExtract').addEventListener('click', doExtract);
  $('backTo1').addEventListener('click', function () { setStep(1); });
  $('toCard').addEventListener('click', function () {
    syncEdits();
    // 编辑表单与代录入口同一标准：外观描述不能进卡片（导出层还有第二道拦截）
    const r = state.record;
    if (r && MedRules.containsAppearance(
      (r.drug_name.value || '') + ' ' + (r.specification.value || '') + ' ' +
      (r.dosage.value || '') + ' ' + (r.frequency.value || '')
    )) { openAppearanceModal(); return; }
    renderCard();
  });
  $('backTo2').addEventListener('click', function () { setStep(2); });
  $('speakBtn').addEventListener('click', function () {
    if ('speechSynthesis' in window && window.speechSynthesis.speaking) stopSpeak();
    else speak();
  });
  $('exportCard').addEventListener('click', exportCard);
  $('addToList').addEventListener('click', addCurrentToList);
  $('navSingle').addEventListener('click', function () { setView('single'); });
  $('navList').addEventListener('click', function () { setView('list'); });
  $('addAnother').addEventListener('click', function () {
    setView('single');
    setStep(1);
    $('textInput').value = '';
    $('photoInput').value = '';
    $('familyDrug').value = '';
    $('familySpec').value = '';
    $('familyUsage').value = '';
    $('familyFreq').value = '';
    $('familyTimes').value = '';
    $('familyPhotoInput').value = '';
    $('familyVerify').classList.add('hidden');
    $('familyPhotoPreviewWrap').classList.add('hidden');
    $('catalogBanner').classList.add('hidden');
    state.photoDataUrl = null;
    state.record = null;
    $('photoPreviewWrap').classList.add('hidden');
  });
  $('exportList').addEventListener('click', exportList);
  $('closeModal').addEventListener('click', function () { $('imageModal').classList.add('hidden'); });
  $('closeAppearanceModal').addEventListener('click', function () { $('appearanceModal').classList.add('hidden'); });
  $('appearanceModal').addEventListener('click', function (e) {
    if (e.target === $('appearanceModal')) $('appearanceModal').classList.add('hidden');
  });
  $('imageModal').addEventListener('click', function (e) {
    if (e.target === $('imageModal')) $('imageModal').classList.add('hidden');
  });

  // 服药人信息：首次打开弹出（可跳过），清单页随时可改
  // 范围校验与 patient.set 内部一致：年龄 1~129 岁，体重 1~299 kg。
  // 超范围的值会被数据层静默丢弃，所以保存前必须在这里拦下来并说明，
  // 否则用户填了怪值点保存，界面还提示"已保存"，是误导。
  function patientErr(msg) {
    const el = $('patientErr');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }
  $('patientSave').addEventListener('click', function () {
    patientErr('');
    const ageRaw = $('ptAge').value.trim();
    const weightRaw = $('ptWeight').value.trim();
    const problems = [];
    if (ageRaw && !(Number(ageRaw) >= 1 && Number(ageRaw) < 130)) {
      problems.push('年龄请填 1~129 之间的数字');
    }
    if (weightRaw && !(Number(weightRaw) >= 1 && Number(weightRaw) < 300)) {
      problems.push('体重请填 1~299 之间的数字');
    }
    if (problems.length) {
      patientErr(problems.join('；') + '，如不想填可留空或点「跳过，直接用」');
      return;
    }
    MedPatient.set({
      nickname: $('ptNickname').value.trim(),
      gender: $('ptGender').value,
      age: ageRaw,
      weight: weightRaw
    });
    const p = MedPatient.get();
    closePatientOnboard();
    showToast(p && (p.age || p.nickname) ? '已保存服药人信息' : '未填写任何信息');
  });
  $('patientSkip').addEventListener('click', closePatientOnboard);
  $('patientChip').addEventListener('click', openPatientOnboard);

  (function initPatient() {
    let seen = false;
    try { seen = localStorage.getItem(PATIENT_SEEN_KEY) === '1'; } catch (e) { /* 忽略 */ }
    if (!seen) openPatientOnboard();
    else renderPatientChip();
  })();

  window.addEventListener('beforeunload', stopSpeak);
})();
