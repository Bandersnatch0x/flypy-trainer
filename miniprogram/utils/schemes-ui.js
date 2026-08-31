// 方案库纯逻辑（分组/次序/卡面元数据/变化面裁定/科普文案），无 DOM 依赖（SPEC-0003 §5）。
// 小程序的卡面渲染在 pages/schemes/（WXML），此处只留数据与裁定；
// web 版 DOM 渲染（方案库页/芯片弹层）仍居 js/schemes-ui.js。
const { courseOf } = require('./courses.js');
const { store } = require('./store.js');

const FLAGSHIP_ID = 'flypy'; // 旗舰·默认：顶层独享全宽大卡（T5-D1）

// 三层分组（§5.1）：旗舰小鹤顶层 + 音码组/形码组各带一行科普。
// 组内次序 = 音码：自然码/微软/搜狗/智能ABC（双拼子标签）→ 全拼 → 注音 → 粤拼（#10 追加末位，一期次序不动）；
// 形码：五笔画（形码入门）→ 仓颉 → 速成 → 五笔 86。
const GROUPS = [
  { id: 'phonetic', title: '音码', blurb: '音码 · 码即读音（全拼、五种双拼、注音、粤拼）',
    ids: ['ziranma', 'mspy', 'sogou', 'abc', 'quanpin', 'zhuyin', 'jyutping'] },
  { id: 'shape', title: '形码', blurb: '形码 · 码即字形（五笔画、仓颉、速成、五笔）',
    ids: ['stroke', 'cangjie', 'quick', 'wubi86'] },
];

// 卡片五层信息之一②：一句话特点（自然码/注音文案出自 T4 简报，§5.1）
const CARD_FEATURES = {
  flypy: '鹤练旗舰：声母一键、韵母一键，任何音节两键到手。',
  ziranma: '与微软双拼仅差 3 处',
  mspy: '微软系输入法内置键位，双拼通行方案',
  sogou: '搜狗系输入法的双拼键位',
  abc: '老牌智能ABC 的双拼键位',
  quanpin: '码即拼音本身，零键位映射，提速为核',
  zhuyin: '41 键大千布局 · 声调成字',
  jyutping: '六声调辨义 · 阴调单键、阳调同键双敲',
  cangjie: '字形拆成字母序列，熟字根即识码；速成取其首尾二码',
  quick: '速成 = 仓颉首尾二码，节奏更快',
  stroke: '五键打字 · 形码第一步',
  wubi86: '五区字根 · 拆字逐步引导 · 词组 2+2',
};

// 卡片五层信息之④：课程形态标签（§5.1 状态行）
function courseFormOf(id) {
  const c = courseOf(id);
  if (c.form === 'rootTable') return '字根总表 + 自由练习';
  if (id === 'quanpin') return '提速课程';
  return '五阶课程';
}

// 五笔 86 兼容视图标签：课程包接载后卡片显示五阶课程
function cardTagOf(id) {
  return '';
}

// 变化面裁定（§5.4）：形码隐藏多字词/整句；五笔 86 放宽课程池二字词
function hiddenModesFor(scheme) {
  if (!scheme || scheme.paradigm !== 'shape') return [];
  if (scheme.id === 'stroke') return ['words2', 'words34', 'sentences'];
  if (scheme.id === 'wubi86') return ['words34', 'sentences'];
  return ['words2', 'words34', 'sentences'];
}

// 切回态卡片摘要（§5.5 三态 1）：课程第 N 阶 · 错词 X 条；皆无则不显
function progressSummary(id) {
  const parts = [];
  const stage = store.getCourse(id).stage || 0;
  const c = courseOf(id);
  if (c.form !== 'rootTable') parts.push(`课程第 ${stage + 1} 阶`);
  const n = store.getMistakes(id).length;
  if (n) parts.push(`错词 ${n} 条`);
  return parts.join(' · ');
}

module.exports = { FLAGSHIP_ID, GROUPS, CARD_FEATURES, courseFormOf, cardTagOf, hiddenModesFor, progressSummary };
