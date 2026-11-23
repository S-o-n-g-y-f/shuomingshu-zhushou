/* 演示样张：全部为虚构药品、虚构文本，仅用于演示信息抽取流程，不构成任何用药信息。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MedSamples = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return [
    {
      id: 'demo-a',
      title: '演示样张 A · 清晰版（虚构）',
      text: [
        '药品名称：演示药甲片',
        '成份：本品主要成份为虚构化合物甲。',
        '性状：本品为薄膜衣片，除去包衣后显白色。',
        '适应症：用于演示 purposes，无实际医疗用途。',
        '规格：20mg',
        '用法用量：口服，一次1片，每日三次，饭后服用。',
        '禁忌：对虚构化合物甲过敏者禁用。',
        '不良反应：常见恶心、轻度头晕。偶见皮疹、口干。如出现过敏性休克、呼吸困难，应立即停药并就医。',
        '注意事项：请遵医嘱。'
      ].join('\n')
    },
    {
      id: 'demo-b',
      title: '演示样张 B · 需人工确认（虚构）',
      text: [
        '药品名称：演示药乙胶囊',
        '规格：见包装',
        '用法用量：遵医嘱服用。',
        '不良反应：少见头晕。',
        '注意事项：请在医师指导下使用。'
      ].join('\n')
    },
    {
      id: 'demo-c',
      title: '演示样张 C · 模糊反光（虚构）',
      text: [
        '药品名称：演示药丙片',
        '规格：10mg',
        '用法用量：一次2片，每日二次。',
        '不良反应：偶见胃部不适。可见黄疸，应立即就医。',
        '禁忌：尚未明确。'
      ].join('\n')
    }
  ];
});
