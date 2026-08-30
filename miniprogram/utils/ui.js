// 页面共享视图逻辑（fix #9 消重）：键盘行构建 / 连练天数 / 热力分桶 / 模式表 / 范式标签。
const { store } = require('./store.js');

// 自绘键盘行数据：主键 + 附标 + 功能键标记（练习/课程/统计三页共用）
function buildRows(scheme) {
  const { ROWS, extraKeys, keyLabel, specialOf } = scheme.layout;
  const rows = [...ROWS];
  if (extraKeys.length) rows.push(extraKeys.join(''));
  return rows.map(row => [...row].map(ch => {
    const lab = keyLabel(ch);
    return { key: ch, main: lab.main, sub: lab.sub || '', special: !!specialOf(ch) };
  }));
}

// 连练天数：今天没练就昨天起算，向前数连续天数
function streakOf(sessions = store.getSessions()) {
  const days = new Set(sessions.map(s => new Date(s.ts).toDateString()));
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

// 错键热力分桶：错误率 ×2.2 封顶 0.9 → 1/2/3 档（与 web 版 rgba 系数一致）
function heatLevel(hit, err) {
  if (!hit || !err) return 0;
  const a = Math.min(0.9, (err / hit) * 2.2);
  return a >= 0.6 ? 3 : a >= 0.35 ? 2 : 1;
}

// 练习模式表：首页带 desc 全量，练习页取 mode+label
const MODES = [
  { mode: 'chars', label: '单字', desc: '高频 500 字' },
  { mode: 'words2', label: '二字词', desc: '词组节奏' },
  { mode: 'words34', label: '多字词', desc: '三四字词' },
  { mode: 'sentences', label: '整句', desc: '二字词连句' },
  { mode: 'sprint', label: '60秒冲刺', desc: '限时循环' },
  { mode: 'mixed', label: '混练', desc: '字词混合' },
  { mode: 'personal', label: '导入词', desc: '你的词库' },
  { mode: 'mistakes', label: '错词本', desc: '错题回炉' },
];

// 方案卡范式标签：形码/音码 + 双拼子标签（全拼、注音、粤拼不挂双拼）
function paradigmTags(scheme) {
  const tags = [scheme.paradigm === 'shape' ? '形码' : '音码'];
  if (scheme.id !== 'quanpin' && scheme.id !== 'zhuyin' && scheme.id !== 'jyutping' && scheme.paradigm === 'phonetic') tags.push('双拼');
  return tags;
}

module.exports = { buildRows, streakOf, heatLevel, MODES, paradigmTags };
