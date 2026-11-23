/* 身份卡导出：用 Canvas 直接绘制，零依赖。图片只在本机生成，不上传。 */
(function (root) {
  'use strict';
  const R = root.MedRules;

  const W = 750;
  const MAX_H = 2000; // 2 倍像素密度下 4000px，仍低于 iOS 单画布上限 4096x4096
  const PAD = 40;
  const dpr = 2; // 2 倍像素密度，模块级共享（此前各函数局部定义导致跨函数引用崩溃）

  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    const chars = String(text == null ? '' : text).split('');
    chars.forEach(function (ch) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawParagraph(ctx, text, x, y, maxWidth, fontSize, lineHeight, color, weight) {
    ctx.font = (weight || '400') + ' ' + fontSize + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = color || '#222';
    const lines = wrapText(ctx, text, maxWidth);
    lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lineHeight); });
    return y + lines.length * lineHeight;
  }

  function exportCard(record, photoDataUrl, onReady) {
    const canvas = document.createElement('canvas');
    canvas.width = W * dpr;
    canvas.height = MAX_H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, MAX_H);

    let y = PAD;

    // 顶部标识
    ctx.fillStyle = '#1d6b52';
    ctx.fillRect(0, 0, W, 12);
    ctx.font = '500 24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#1d6b52';
    ctx.fillText('说明书助手 · 用药身份卡', PAD, y + 20);
    y += 60;

    // 药名
    const drug = (record.drug_name && record.drug_name.value) || '药品名称未识别';
    y = drawParagraph(ctx, drug, PAD, y, W - PAD * 2, 46, 58, '#111', '700') + 18;

    const spec = (record.specification && record.specification.value) || '';
    if (spec) {
      y = drawParagraph(ctx, '规格：' + spec, PAD, y, W - PAD * 2, 26, 36, '#444', '400') + 16;
    }

    // 药盒照片（如有）——只放用户拍的原图，不放任何外观文字描述
    if (photoDataUrl) {
      const img = new Image();
      img.onload = function () {
        const size = 190;
        const ratio = Math.min(size / img.width, size / img.height, 1);
        const w = img.width * ratio, h = img.height * ratio;
        ctx.drawImage(img, PAD, y, w, h);
        y += h + 18;
        drawRest(ctx, record, y, onReady, canvas);
      };
      img.onerror = function () { drawRest(ctx, record, y, onReady, canvas); };
      img.src = photoDataUrl;
      return;
    }
    drawRest(ctx, record, y, onReady, canvas);
  }

  function drawRest(ctx, record, y, onReady, canvas) {
    const maxW = W - PAD * 2;

    // 黄条提示
    if (record.needs_human_check) {
      ctx.fillStyle = '#fff6e0';
      const bannerText = '请确认或咨询药师：' + (record.check_reasons || []).join('；');
      ctx.font = '500 24px "PingFang SC","Microsoft YaHei",sans-serif';
      const h = wrapText(ctx, bannerText, maxW - 30).length * 34 + 24;
      ctx.fillRect(PAD, y, maxW, h);
      drawParagraph(ctx, bannerText, PAD + 15, y + 32, maxW - 30, 24, 34, '#7a5310', '500');
      y += h + 24;
    }

    // 用法用量
    ctx.fillStyle = '#1d6b52';
    ctx.fillRect(PAD, y, 6, 30);
    ctx.font = '600 26px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#333';
    ctx.fillText('怎么吃（说明书原文）', PAD + 18, y + 24);
    y += 48;

    const dosage = (record.dosage && record.dosage.value) || '原文未识别';
    y = drawParagraph(ctx, dosage, PAD, y, maxW, 40, 54, '#111', '700') + 8;

    const freq = (record.frequency && record.frequency.value) || '';
    if (freq) {
      y = drawParagraph(ctx, '服用次数：' + freq, PAD, y, maxW, 26, 38, '#333') + 10;
    }

    const times = (record.frequency && record.frequency.times) || [];
    const timingHint = (record.frequency && record.frequency.timingHint) || '';
    const prn = !!(record.frequency && record.frequency.prn);
    const noneText = prn ? '按需服药 · 不是按固定时间吃的' : '未能换算，请查看纸质说明书或咨询药师';
    const boxH = (times.length ? 76 : 52) + (timingHint ? 52 : 0);
    ctx.fillStyle = '#eef5f0';
    ctx.fillRect(PAD, y, maxW, boxH);
    ctx.font = '400 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#456';
    ctx.fillText(times.length ? '常见时间示例（不是医嘱，请自行核对）' : (prn ? '这类药按需要使用' : '常见时间示例（不是医嘱，请自行核对）'), PAD + 14, y + 28);
    if (times.length) {
      ctx.font = '700 32px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#1d6b52';
      ctx.fillText(times.join('   '), PAD + 14, y + 63);
    } else {
      ctx.font = '400 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#7a5310';
      ctx.fillText(noneText, PAD + 14, y + 48);
    }
    if (timingHint) {
      const ty = y + (times.length ? 76 : 52);
      ctx.fillStyle = '#fff7e6';
      ctx.fillRect(PAD, ty, maxW, 52);
      ctx.font = '700 23px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#7a5310';
      ctx.fillText('原文要求「' + timingHint + '」服用', PAD + 14, ty + 34);
    }
    y += boxH + 26;

    // 严重警示
    const severe = (record.adverse && record.adverse.severe) || [];
    if (severe.length) {
      ctx.font = '600 26px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#333';
      ctx.fillText('要特别注意（原文关键词定位）', PAD, y);
      y += 34;
      severe.slice(0, 4).forEach(function (item) {
        const txt = '注意：' + item.text;
        ctx.font = '600 26px "PingFang SC","Microsoft YaHei",sans-serif';
        const lines = wrapText(ctx, txt, maxW - 34);
        const h = lines.length * 36 + 22;
        ctx.fillStyle = '#fdeceb';
        ctx.fillRect(PAD, y, maxW, h);
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(PAD, y, 6, h);
        drawParagraph(ctx, txt, PAD + 18, y + 30, maxW - 34, 26, 36, '#9a2b26', '600');
        y += h + 12;
      });
      y += 12;
    }

    // 常见反应
    const common = (record.adverse && record.adverse.common) || [];
    if (common.length) {
      ctx.font = '600 26px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#333';
      ctx.fillText('可能出现的不适', PAD, y);
      y += 36;
      common.slice(0, 2).forEach(function (s) {
        y = drawParagraph(ctx, '· ' + s, PAD, y, maxW, 24, 34, '#444') + 4;
      });
      y += 12;
    }

    // 固定提示：禁止外观识别
    ctx.fillStyle = '#f4f6f3';
    ctx.fillRect(PAD, y, maxW, 96);
    drawParagraph(ctx, '请凭药盒和药名确认，不要凭颜色形状认药。', PAD + 16, y + 34, maxW - 32, 24, 34, '#333', '600');
    drawParagraph(ctx, '仅帮您看清说明书原文，不提供用药建议，请以纸质说明书和医嘱为准。', PAD + 16, y + 72, maxW - 32, 19, 26, '#666');
    y += 96;

    // 自检：任何外观描述都不得进入图片
    // 注意：drug 必须在这里从 record 重新取——drawRest 是独立函数，
    // 取不到 exportCard 作用域里的局部变量（此前直接引用会导致导出必然崩溃）。
    // dosage/freq 在本函数上方（用法用量段）已有声明，可直接用。
    const drug = (record.drug_name && record.drug_name.value) || '';
    const allText = [drug, dosage, freq].concat(severe.map(function (s) { return s.text; }), common).join(' ');
    if (R && R.containsAppearance(allText)) {
      onReady(null, '检测到外观描述，已阻止导出');
      return;
    }

    // 裁掉空白
    const finalH = Math.min(MAX_H, Math.ceil(y + PAD));
    // 内容超过画布上限时明确告知被截断，绝不静默切掉——老人拿到图要知道去看完整原文
    if (y + PAD > MAX_H) {
      ctx.fillStyle = '#fdeceb';
      ctx.fillRect(PAD, MAX_H - 50, maxW, 40);
      ctx.font = '600 21px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#9a2b26';
      ctx.fillText('内容过长，图片已截断；请以页面里的完整原文为准', PAD + 14, MAX_H - 22);
    }
    const out = document.createElement('canvas');
    out.width = W * dpr;
    out.height = finalH * dpr;
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height, 0, 0, out.width, out.height);
    onReady(out.toDataURL('image/png'));
  }

  // 整张清单导出：按时间排序，逐条大字展示，标注需核对事项。
  function exportList(items, flags, onReady) {
    // 外观自检：与单卡导出同一标准——任何一条的外观描述混进来都整张拦截
    const appearanceText = items.map(function (it) {
      return [(it.drug_name && it.drug_name.value) || '',
        (it.dosage && it.dosage.value) || '',
        (it.frequency && it.frequency.value) || ''].join(' ');
    }).join(' ');
    if (R && R.containsAppearance(appearanceText)) {
      onReady(null, '检测到外观描述，已阻止导出');
      return;
    }
    const sorted = root.MedInventory.sorted(items);
    const rowH = 168;
    const headH = 230;
    const flagH = flags && flags.length ? 70 + flags.length * 46 : 60;
    const footH = 150;
    const h = Math.min(MAX_H, headH + flagH + sorted.length * rowH + footH);
    const canvas = document.createElement('canvas');
    canvas.width = W * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, h);

    ctx.fillStyle = '#1d6b52';
    ctx.fillRect(0, 0, W, 12);
    ctx.font = '500 26px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#1d6b52';
    ctx.fillText('说明书助手 · 我的用药清单', PAD, 62);
    ctx.font = '400 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText('按常见服药时间排序 · 共 ' + sorted.length + ' 种药', PAD, 96);

    let y = 124;
    if (flags && flags.length) {
      ctx.fillStyle = '#fff6e0';
      ctx.fillRect(PAD, y, W - PAD * 2, 44 + flags.length * 44);
      ctx.font = '600 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#7a5310';
      ctx.fillText('请核对以下事项', PAD + 14, y + 32);
      flags.slice(0, 5).forEach(function (f, i) {
        drawParagraph(ctx, '· ' + f.message, PAD + 14, y + 66 + i * 44, W - PAD * 2 - 28, 19, 26, '#7a5310');
      });
      y += 44 + flags.length * 44 + 22;
    } else {
      ctx.fillStyle = '#e8f4ee';
      ctx.fillRect(PAD, y, W - PAD * 2, 44);
      ctx.font = '400 20px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#1d6b52';
      ctx.fillText('时间上未发现需核对的安排（不代表无药物相互作用）', PAD + 14, y + 30);
      y += 66;
    }

    sorted.forEach(function (it, idx) {
      const times = (it.frequency && it.frequency.times) || [];
      const prn = !!(it.frequency && it.frequency.prn);
      ctx.fillStyle = idx % 2 === 0 ? '#f7f9f6' : '#fff';
      ctx.fillRect(PAD, y, W - PAD * 2, rowH - 12);
      ctx.fillStyle = '#1d6b52';
      ctx.fillRect(PAD, y, 6, rowH - 12);
      ctx.font = '700 30px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#111';
      ctx.fillText((it.drug_name && it.drug_name.value) || '未命名', PAD + 20, y + 40);
      ctx.font = '400 20px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#555';
      const spec = (it.specification && it.specification.value) ? '规格：' + it.specification.value + '   ' : '';
      const dosage = (it.dosage && it.dosage.value) ? '用量：' + it.dosage.value : '';
      ctx.fillText(spec + dosage, PAD + 20, y + 76);
      ctx.font = '700 28px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#1d6b52';
      const timeText = times.length ? times.join('   ') : (prn ? '按需服用' : '时间未识别 · 请看纸质说明书');
      ctx.fillText(timeText, PAD + 20, y + 124);
      const hint = (it.frequency && it.frequency.timingHint) || '';
      if (hint) {
        ctx.font = '600 21px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillStyle = '#7a5310';
        ctx.fillText('原文要求「' + hint + '」服用', PAD + 20, y + 146);
      }
      y += rowH;
    });

    ctx.fillStyle = '#f4f6f3';
    ctx.fillRect(PAD, h - footH + 10, W - PAD * 2, footH - 24);
    drawParagraph(ctx, '请凭药盒和药名确认，不要凭颜色形状认药。', PAD + 16, h - footH + 52, W - PAD * 2 - 32, 23, 32, '#333', '600');
    drawParagraph(ctx, '仅帮您看清说明书原文，不提供用药建议，不判断药物能否同服，不提示相互作用。请以纸质说明书和医嘱为准。', PAD + 16, h - footH + 96, W - PAD * 2 - 32, 19, 27, '#666');

    // 内容超过画布上限时明确告知截断（截断的是中间的药品行，必须让人知道）
    if (headH + flagH + sorted.length * rowH + footH > MAX_H) {
      ctx.fillStyle = '#fdeceb';
      ctx.fillRect(PAD, h - footH - 52, W - PAD * 2, 40);
      ctx.font = '600 21px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#9a2b26';
      ctx.fillText('药品太多图片已截断；完整清单请在应用内查看', PAD + 14, h - footH - 24);
    }

    onReady(canvas.toDataURL('image/png'));
  }

  root.MedCard = { exportCard: exportCard, exportList: exportList };
})(typeof self !== 'undefined' ? self : this);
