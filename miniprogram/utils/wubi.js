// 五笔 86 基元（SPEC-0004 §5.4–5.5；兼容 §4.2 兜底，issue #13）。
//
// 字根总表为自写表（ADR-0005 先例）：键位归属是编码标准的公有事实，
// 清单、分区与例字按公开资料自写，不内置任何上游文件；全部键名、
// 键上字根与例字经 wubi86.v1 包逐条校验（在包内且首码落在该键）。
// 站内命名一律通称「五笔 86」，商标性名称避让（T1-§4）。
//
// 课程包未接载时：plan 退回扁平淡键序（role='码键'），供失败态继续显示可恢复的基础练习。
// Z 是「学习键」：不参与取码，正码无一含 z，布局上描边单列。

// 五区 25 码键（Z 不参与取码，不入总表）；desc = 键位编号区间
const WB_ZONES = [
  { label: '横区', desc: '11–15', keys: ['g', 'f', 'd', 's', 'a'] },
  { label: '竖区', desc: '21–25', keys: ['h', 'j', 'k', 'l', 'm'] },
  { label: '撇区', desc: '31–35', keys: ['t', 'r', 'e', 'w', 'q'] },
  { label: '捺区', desc: '41–45', keys: ['y', 'u', 'i', 'o', 'p'] },
  { label: '折区', desc: '51–55', keys: ['n', 'b', 'v', 'c', 'x'] },
];

// 25 键字根总表：键 → {name 键名, zone 区, pos 区内位, tag 键帽角标,
// roots 键上字根, note 补充说明, ex 例字}。
// 键名/键上字根/例字皆经 wubi86.v1 包校验：在包内且首码即该键（单测固化该事实）。
const WB_ROOTS = {
  g: { name: '王', zone: '横', pos: 1, tag: '王 一', roots: '王 戋 五 一', note: '「青」字头一类变体形也在此键。', ex: ['王', '玉', '青', '表'] },
  f: { name: '土', zone: '横', pos: 2, tag: '土 士', roots: '土 士 二 干 十 寸 雨', ex: ['土', '地', '城', '南'] },
  d: { name: '大', zone: '横', pos: 3, tag: '大 犬', roots: '大 犬 三 古 石 厂 尢', note: '「羊」字去底的变体形也在此键。', ex: ['大', '犬', '石', '尤'] },
  s: { name: '木', zone: '横', pos: 4, tag: '木 西', roots: '木 丁 西', ex: ['木', '要', '西', '丁'] },
  a: { name: '工', zone: '横', pos: 5, tag: '工 戈', roots: '工 戈 艹 匚 七 弋', note: '草字头（艹）与右向开口框（匚）都归此键。', ex: ['工', '区', '草', '式'] },
  h: { name: '目', zone: '竖', pos: 1, tag: '目 止', roots: '目 上 止 卜 丨 虍', note: '虍 即「虎」字皮。', ex: ['目', '上', '止', '虎'] },
  j: { name: '日', zone: '竖', pos: 2, tag: '日 虫', roots: '日 早 虫 刂', note: '刂 即立刀。', ex: ['日', '早', '虫', '明'] },
  k: { name: '口', zone: '竖', pos: 3, tag: '口 川', roots: '口 川', note: '此键字根少，口是高频部件。', ex: ['口', '中', '品', '顺'] },
  l: { name: '田', zone: '竖', pos: 4, tag: '田 车', roots: '田 甲 囗 罒 车 力', note: '囗 是大口框（国字框），罒 是四字头。', ex: ['田', '男', '国', '车'] },
  m: { name: '山', zone: '竖', pos: 5, tag: '山 贝', roots: '山 由 贝 冂 几', note: '冂 是下开口框。', ex: ['山', '由', '贝', '风'] },
  t: { name: '禾', zone: '撇', pos: 1, tag: '禾 竹', roots: '禾 竹 丿 彳', note: '竹字头（⺮ 形）也在此键。', ex: ['和', '第', '行', '物'] },
  r: { name: '白', zone: '撇', pos: 2, tag: '白 手', roots: '白 手 斤', note: '提手旁（扌）与「看」字头一类形也在此键。', ex: ['白', '手', '看', '打'] },
  e: { name: '月', zone: '撇', pos: 3, tag: '月 用', roots: '月 乃 用 彡 豕', note: '「家」字底即 豕。', ex: ['月', '用', '服', '乃'] },
  w: { name: '人', zone: '撇', pos: 4, tag: '人 八', roots: '人 八 癶', note: '单人旁（亻）同 人。', ex: ['人', '你', '八', '登'] },
  q: { name: '金', zone: '撇', pos: 5, tag: '金 夕', roots: '金 钅 勹 儿 夕 乂', note: '乂 是交叉形；「夕」形带点也在此键。', ex: ['金', '铁', '多', '饭'] },
  y: { name: '言', zone: '捺', pos: 1, tag: '言 文', roots: '言 文 方 广 亠 丶', note: '言字旁（讠）同 言。', ex: ['言', '文', '方', '广'] },
  u: { name: '立', zone: '捺', pos: 2, tag: '立 门', roots: '立 辛 六 门 疒', note: '两点（丷 形）同「六」字头。', ex: ['立', '门', '病', '关'] },
  i: { name: '水', zone: '捺', pos: 3, tag: '水 小', roots: '水 小', note: '三点水（氵）、兴字头与倒「小」形都在此键。', ex: ['水', '小', '学', '当'] },
  o: { name: '火', zone: '捺', pos: 4, tag: '火 米', roots: '火 米 业', note: '四点底（灬）同 火。', ex: ['火', '米', '业', '灯'] },
  p: { name: '之', zone: '捺', pos: 5, tag: '之 宀', roots: '之 宀 冖 辶 廴 礻', note: '衣字旁（衤）也在此键。', ex: ['之', '字', '军', '社'] },
  n: { name: '已', zone: '折', pos: 1, tag: '已 心', roots: '己 已 巳 尸 心 羽', note: '竖心旁（忄）同 心；己 开口、已 半开、巳 全闭；横折钩一类折笔也在此键。', ex: ['心', '情', '羽', '习'] },
  b: { name: '子', zone: '折', pos: 2, tag: '子 也', roots: '子 耳 了 也 凵 阝', note: '阝 是左耳旁；凵 是上开口框。', ex: ['子', '了', '耳', '出'] },
  v: { name: '女', zone: '折', pos: 3, tag: '女 刀', roots: '女 刀 九 臼 彐', note: '彐 是「雪」字中段一类形。', ex: ['女', '好', '刀', '寻'] },
  c: { name: '又', zone: '折', pos: 4, tag: '又 马', roots: '又 巴 马 厶', note: '厶 是「台」字底一类形。', ex: ['又', '马', '驰', '台'] },
  x: { name: '纟', zone: '折', pos: 5, tag: '纟 弓', roots: '纟 弓 匕 幺', note: '「母」字外框一类折形也在此键。', ex: ['经', '张', '比', '幼'] },
};

const WB_LAST_NAMES = { 1: '横', 2: '竖', 3: '撇', 4: '捺', 5: '折' };
const WB_STRUCT_NAMES = { 1: '左右', 2: '上下', 3: '杂合' };
const WB_LEVEL_NAMES = { 1: '一级简码', 2: '二级简码', 3: '三级简码' };
const WB_STROKE_OF_KEY = { g: '横', h: '竖', t: '撇', y: '捺', n: '折' };

function rootNameOf(shape, rootNames) {
  const s = String(shape || '');
  return (rootNames && rootNames[s]) || s;
}
function idNoteOf(id) {
  if (!id) return '';
  const lastN = Number(id.last);
  const structN = Number(id.struct);
  const last = WB_LAST_NAMES[lastN] || String(id.last || '');
  const struct = WB_STRUCT_NAMES[structN] || String(id.struct || '');
  return [last ? `末笔${last}` : '', struct].filter(Boolean).join(' · ');
}
function firstKeyOfWubi(entry, table, code) {
  return (entry && table && table[entry.word] && table[entry.word].keys?.[0]) || String(code || '')[0] || '';
}

function wubiWordCode(word, tableOrPack, courseChars) {
  const chs = [...String(word || '')];
  if (chs.length !== 2 || !tableOrPack) return null;
  const table = tableOrPack._meta ? Object.fromEntries(Object.entries(tableOrPack).filter(([k]) => !k.startsWith('_'))) : tableOrPack;
  const metaChars = tableOrPack._meta && tableOrPack._meta.courseChars;
  const allowed = courseChars || metaChars;
  if (!allowed || !chs.every(ch => allowed instanceof Set ? allowed.has(ch) : allowed.includes(ch))) return null;
  let code = '';
  for (const ch of chs) {
    const keys = table[ch] && table[ch].keys;
    if (!keys || keys.length < 2) return null;
    code += keys.slice(0, 2);
  }
  return code;
}
function fallbackPlanOf(code) {
  return {
    keys: [...String(code || '')].map((ch) => ({ key: ch, label: ch.toUpperCase(), note: '', role: '码键' })),
    groups: [],
  };
}
function fullStepsOf(e, rootNames) {
  const keys = String(e.keys || '');
  const roots = e.roots || [];
  const units = [];
  if (e.kind === '键名') {
    for (const k of keys) units.push({ key: k, label: rootNameOf(roots[0], rootNames), note: `键 ${k.toUpperCase()}`, role: 'root' });
    if (units.length) units[0].note = `键名 · 同键连按 ${keys.length} 下`;
    return units;
  }
  if (e.kind === '单笔画') {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      units.push(i < 2
        ? { key: k, label: rootNameOf(roots[0], rootNames), note: i ? '同键再按' : `单笔画 · 键 ${k.toUpperCase()}`, role: 'root' }
        : { key: k, label: '笔画代码', note: i === 2 ? `键 ${k.toUpperCase()}` : '固定 ll', role: 'root' });
    }
    return units;
  }
  if (e.kind === '成字字根') {
    units.push({ key: keys[0], label: rootNameOf(roots[0], rootNames), note: `成字字根 · 键 ${keys[0].toUpperCase()}`, role: 'root' });
    for (let i = 1; i < keys.length; i++) {
      const k = keys[i];
      const pos = i === keys.length - 1 ? '末笔' : i === 1 ? '首笔' : '次笔';
      units.push({ key: k, label: `${pos}${WB_STROKE_OF_KEY[k] || ''}`, note: `键 ${k.toUpperCase()}`, role: 'root' });
    }
    return units;
  }
  const rootSteps = Math.min(roots.length, keys.length);
  for (let i = 0; i < rootSteps; i++) {
    const key = keys[i];
    const label = roots[i] ? rootNameOf(roots[i], rootNames) : `第 ${i + 1} 键`;
    units.push({ key, label, note: `键 ${key.toUpperCase()}`, role: 'root' });
  }
  if (e.id && keys.length === roots.length + 1) {
    const idKey = String(e.id.key || '');
    if (idKey) units.push({ key: idKey, label: `识别码 ${idKey.toUpperCase()}`, note: idNoteOf(e.id), role: 'root' });
  }
  return units;
}
function planOfWubi(code, entry, table, rootNames) {
  const c = String(code || '');
  const word = entry && entry.word;
  if (word && [...word].length === 2 && table && [...word].every(ch => table[ch])) {
    const keys = [];
    const groups = [];
    for (const ch of word) {
      const units = fullStepsOf(table[ch], rootNames).slice(0, 2);
      groups.push({ word: ch, start: keys.length, len: units.length });
      keys.push(...units);
    }
    return { keys, groups };
  }
  const e = word && table ? table[word] : null;
  if (!e || [...String(word)].length !== 1) return fallbackPlanOf(c);
  if (c === e.keys) return { keys: fullStepsOf(e, rootNames), groups: [] };
  if (c.length < e.keys.length) {
    const level = WB_LEVEL_NAMES[c.length] || `${c.length} 键简码`;
    const units = [...c].map((k, i) => (!e.kind && e.roots && i < e.roots.length && e.keys[i] === k
      ? { key: k, label: rootNameOf(e.roots[i], rootNames), note: `键 ${k.toUpperCase()}`, role: 'root' }
      : { key: k, label: `${level} ${k.toUpperCase()}`, note: '', role: 'root' }));
    const last = units[units.length - 1];
    if (last) {
      const brief = last.label.startsWith(level) ? `全码 ${e.keys.toUpperCase()}` : `${level}，全码 ${e.keys.toUpperCase()}`;
      last.note = last.note ? `${last.note} · ${brief}` : brief;
    }
    return { keys: units, groups: [] };
  }
  return fallbackPlanOf(c);
}
function bindWubiCourse(scheme, pack) {
  const table = {};
  for (const [k, v] of Object.entries(pack || {})) if (!k.startsWith('_')) table[k] = v;
  scheme.courseTable = table;
  scheme.rootNames = (pack && pack._meta && pack._meta.rootNames) || {};
  const courseChars = pack && pack._meta && pack._meta.courseChars;
  const baseCodeOf = scheme.codeOf;
  scheme.codeOf = (entry) => {
    const word = entry && entry.word;
    if (word && [...word].length === 2) return wubiWordCode(word, scheme.courseTable, courseChars);
    return baseCodeOf(entry);
  };
  scheme.planOf = (code, entry) => planOfWubi(code, entry, scheme.courseTable, scheme.rootNames);
  return scheme;
}

module.exports = { WB_ZONES, WB_ROOTS, bindWubiCourse, firstKeyOfWubi, wubiWordCode, planOfWubi, rootNameOf, idNoteOf, fallbackPlanOf };
