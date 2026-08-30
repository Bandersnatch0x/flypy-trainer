// 仓颉（五代）基元：24 字母四类 + X难/Z重、码即拆解序列（SPEC-0003 §2/§4.1–4.3，issue #5）。
//
// 字母→字根名是仓颉公有标准小表（朱邦复 1982 年登报弃权，体系公有；
// 单字码表事实经 rime/rime-cangjie《五倉世紀》LGPL pack 内置）。四类划分、
// 辅助字形与例字按公开资料自写（ADR-0005 先例），不内置上游文件；
// 例字皆经 cangjie5.v1 包校验：在包内且首码即该字母。
//
// 速成 = 仓颉首尾二码：官方定义即 rime-quick 的一条 derive/^([^z])\w+(\w)$/$1$2/
// （取倉頡首尾二碼爲速成碼，LGPL-3.0），由仓颉 base 表运行时派生，零码表。

// 四类分区（阶 0 字根认知；分类依公开资料：哲理 7 / 笔画 7 / 人体 4 / 字形 6，
// X「难」Z「重」单列不进四类）
export const CJ_CATS = [
  { label: '哲理', desc: '自然意象：日 月 金 木 水 火 土', keys: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
  { label: '笔画', desc: '基本笔形：竹 戈 十 大 中 一 弓', keys: ['h', 'i', 'j', 'k', 'l', 'm', 'n'] },
  { label: '人体', desc: '人身器官：人 心 手 口', keys: ['o', 'p', 'q', 'r'] },
  { label: '字形', desc: '器物山田与杂形：尸 廿 山 女 田 卜', keys: ['s', 't', 'u', 'v', 'w', 'y'] },
];

// 24 字母 + X难/Z重：键 → {name 字根名, cat 类, forms 辅助字形, ex 例字}；
// special=特殊键（X/Z）不进 SRS 操练单元（§4.3：X 不教、Z 非取码）
export const CJ_LETTERS = {
  a: { name: '日', cat: '哲理', forms: '日 曰', ex: ['日', '早', '明'] },
  b: { name: '月', cat: '哲理', forms: '月 冂', ex: ['月', '用', '朋'] },
  c: { name: '金', cat: '哲理', forms: '金 釒 八', ex: ['金', '公', '分'] },
  d: { name: '木', cat: '哲理', forms: '木 朩', ex: ['木', '林', '村'] },
  e: { name: '水', cat: '哲理', forms: '水 氵 氺', ex: ['水', '江', '沙'] },
  f: { name: '火', cat: '哲理', forms: '火 灬', ex: ['火', '炎', '灯'] },
  g: { name: '土', cat: '哲理', forms: '土 士', ex: ['土', '圭', '地'] },
  h: { name: '竹', cat: '笔画', forms: '竹 ⺮', ex: ['竹', '笔', '笑'] },
  i: { name: '戈', cat: '笔画', forms: '戈 弋', ex: ['戈', '戒', '式'] },
  j: { name: '十', cat: '笔画', forms: '十', ex: ['十', '古', '支'] },
  k: { name: '大', cat: '笔画', forms: '大 乂', ex: ['大', '夸', '奇'] },
  l: { name: '中', cat: '笔画', forms: '中 丨', ex: ['中', '申', '史'] },
  m: { name: '一', cat: '笔画', forms: '一', ex: ['一', '二', '三'] },
  n: { name: '弓', cat: '笔画', forms: '弓', ex: ['弓', '张', '引'] },
  o: { name: '人', cat: '人体', forms: '人 亻', ex: ['人', '今', '会'] },
  p: { name: '心', cat: '人体', forms: '心 忄', ex: ['心', '必', '忙'] },
  q: { name: '手', cat: '人体', forms: '手 扌', ex: ['手', '打', '拍'] },
  r: { name: '口', cat: '人体', forms: '口', ex: ['口', '吃', '唱'] },
  s: { name: '尸', cat: '字形', forms: '尸', ex: ['尸', '尺', '屋'] },
  t: { name: '廿', cat: '字形', forms: '廿 卄', ex: ['廿', '共', '革'] },
  u: { name: '山', cat: '字形', forms: '山', ex: ['山', '岩', '峰'] },
  v: { name: '女', cat: '字形', forms: '女', ex: ['女', '好', '妈'] },
  w: { name: '田', cat: '字形', forms: '田', ex: ['田', '男', '思'] },
  y: { name: '卜', cat: '字形', forms: '卜', ex: ['卜', '占', '卞'] },
  x: { name: '难', cat: '特殊', special: true, forms: '', ex: [], note: '「难」键：复合难拆形。本表正码中 X 不作首码（难字简码不入包），课程不教、不参与取题。' },
  z: { name: '重', cat: '特殊', special: true, forms: '', ex: [], note: '「重」键：重形辅助位，不参与取码；本表全部码串无一含 z。' },
};

// 24 字母键清单（取码位，不含 X/Z）
export const CJ_KEYS = Object.keys(CJ_LETTERS).filter(k => !CJ_LETTERS[k].special).join('');

// 速成码 = 仓颉码首尾二码：≥3 码取首+尾，1–2 码原样（rime-quick derive 语义）；
// 无码（null/空）→ null
export function quickOf(code) {
  const c = String(code == null ? '' : code);
  if (!c) return null;
  if (c.length >= 3 && c[0] !== 'z') return c[0] + c[c.length - 1];
  return c;
}
