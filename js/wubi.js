// 五笔 86 基元（SPEC-0003 §2/§4.1–4.2 降级形态；SPEC-0004 §5.4–5.5 课程升级接缝，issue #6/#13）。
//
// 字根总表为自写表（ADR-0005 先例）：键位归属是编码标准的公有事实，
// 清单、分区与例字按公开资料自写，不内置任何上游文件；全部键名、
// 键上字根与例字经 wubi86.v1 包逐条校验（在包内且首码落在该键）。
// 站内命名一律通称「五笔 86」，商标性名称避让（T1-§4）。
//
// plan 双形态（SPEC-0004 §5.4，按有无拆解分流并存）：
// - 未注入课程表：降级形态 —— plan 只是扁平淡键序（role='码键'），
//   提示 full 档兜底 = 全码键序 + 高亮当前键 + 展开该键字根候选表（§4.2）；
// - 注入课程表（bindWubiCourse 注入口，收尾轨接真包、单测注夹具）：课程字
//   plan = 拆解步骤序列 {key, label:字根名, role:'root'}（与仓颉 plan 同形；
//   变体形经 rootNames 映射），识别码步带「末笔 · 结构」注记、简码字附注
//   简码级与全码（§5.5）；未入课程字保持 §4.2 兜底。
// Z 是「学习键」：不参与取码，正码无一含 z，布局上描边单列。

// 五区 25 码键（Z 不参与取码，不入总表）；desc = 键位编号区间
export const WB_ZONES = [
  { label: '横区', desc: '11–15', keys: ['g', 'f', 'd', 's', 'a'] },
  { label: '竖区', desc: '21–25', keys: ['h', 'j', 'k', 'l', 'm'] },
  { label: '撇区', desc: '31–35', keys: ['t', 'r', 'e', 'w', 'q'] },
  { label: '捺区', desc: '41–45', keys: ['y', 'u', 'i', 'o', 'p'] },
  { label: '折区', desc: '51–55', keys: ['n', 'b', 'v', 'c', 'x'] },
];

// 25 键字根总表：键 → {name 键名, zone 区, pos 区内位, tag 键帽角标,
// roots 键上字根, note 补充说明, ex 例字}。
// 键名/键上字根/例字皆经 wubi86.v1 包校验：在包内且首码即该键（单测固化该事实）。
export const WB_ROOTS = {
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

// ---- 课程表接缝（SPEC-0004 §5.4–5.5，issue #13）----

// 末笔类（识别码区号）：1 横 / 2 竖 / 3 撇 / 4 捺（点归捺）/ 5 折
export const WB_LAST_NAMES = { 1: '横', 2: '竖', 3: '撇', 4: '捺', 5: '折' };
// 结构码（识别码位号）：1 左右 / 2 上下 / 3 杂合
export const WB_STRUCT_NAMES = { 1: '左右', 2: '上下', 3: '杂合' };
// 简码级（包内短码键数）：一级简码不是全码前缀（我=q 而全码 trnt，§5.2 实测）
const WB_LEVEL_NAMES = { 1: '一级简码', 2: '二级简码', 3: '三级简码' };
// 区首键 ↔ 笔类（成字字根的首/次/末笔键皆落区首键）
const WB_STROKE_OF_KEY = { g: '横', h: '竖', t: '撇', y: '捺', n: '折' };

// 字根形 → 字根名：变体形经 _meta.rootNames 小表映射（扌→手 一类），余为根形本身（§5.4）
export function rootNameOf(shape, rootNames) {
  const s = String(shape || '');
  return (rootNames && rootNames[s]) || s;
}

// 识别码步注记料：末笔 · 结构（如「末笔横 · 左右」，§5.5）
export function idNoteOf(id) {
  if (!id) return '';
  const last = typeof id.last === 'number' ? WB_LAST_NAMES[id.last] || '' : String(id.last || '');
  const struct = typeof id.struct === 'number' ? WB_STRUCT_NAMES[id.struct] || '' : String(id.struct || '');
  return [last ? `末笔${last}` : '', struct].filter(Boolean).join(' · ');
}

// 词码 2+2 派生（§5.5 阶 3，~10 行运行时派生，quickOf 先例）：
// 二字词双字皆 ∈ 课程池（拆解表在案），词码 = 各字全码前两键连打；
// 任一条件不满足 → null（三字及以上取码规则缓议，§1）
export function wubiWordCode(word, table) {
  const chs = [...String(word || '')];
  if (chs.length !== 2 || !table) return null;
  let code = '';
  for (const ch of chs) {
    const keys = table[ch] && table[ch].keys;
    if (!keys || keys.length < 2) return null;
    code += keys.slice(0, 2);
  }
  return code;
}

// §4.2 兜底形态：扁平淡键序（role='码键'）——无课程表 / 未入课程字皆走此形
export function fallbackPlanOf(code) {
  return {
    keys: [...String(code || '')].map((ch) => ({ key: ch, label: ch.toUpperCase(), note: '', role: '码键' })),
    groups: [],
  };
}

// 全码 → 拆解步骤序列（课程字真值读课程表；键名/单笔画/成字字根为特型，§5.3 R3）
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
    // 键 + 键 + 笔画代码（固定 ll）
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      units.push(i < 2
        ? { key: k, label: rootNameOf(roots[0], rootNames), note: i ? '同键再按' : `单笔画 · 键 ${k.toUpperCase()}`, role: 'root' }
        : { key: k, label: '笔画代码', note: i === 2 ? `键 ${k.toUpperCase()}` : '固定 ll', role: 'root' });
    }
    return units;
  }
  if (e.kind === '成字字根') {
    // 键 + 首笔(+次笔) + 末笔
    units.push({ key: keys[0], label: rootNameOf(roots[0], rootNames), note: `成字字根 · 键 ${keys[0].toUpperCase()}`, role: 'root' });
    for (let i = 1; i < keys.length; i++) {
      const k = keys[i];
      const pos = i === keys.length - 1 ? '末笔' : i === 1 ? '首笔' : '次笔';
      units.push({ key: k, label: `${pos}${WB_STROKE_OF_KEY[k] || ''}`, note: `键 ${k.toUpperCase()}`, role: 'root' });
    }
    return units;
  }
  // 常规字：字根步 +（2–3 根）识别码步
  for (let i = 0; i < roots.length; i++) {
    units.push({ key: keys[i], label: rootNameOf(roots[i], rootNames), note: `键 ${keys[i].toUpperCase()}`, role: 'root' });
  }
  if (e.id && keys.length === roots.length + 1) {
    units.push({ key: e.id.key, label: `识别码 ${e.id.key.toUpperCase()}`, note: idNoteOf(e.id), role: 'root' });
  }
  return units;
}

// plan 双形态（§5.4）：课程表在且条目入课程池 → 拆解步骤；否则 §4.2 兜底
export function planOfWubi(code, entry, table, rootNames) {
  const c = String(code || '');
  const word = entry && entry.word;
  // 二字词：2+2 词码 —— plan = 各字全码前两步骤连打（阶 3 真词出题）
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
  if (c === e.keys) return { keys: fullStepsOf(e, rootNames), groups: [] }; // 全码档：逐步引导
  if (c.length < e.keys.length) {
    // 简码档：打的是包内短码 —— 附注简码级与全码（「我：一级简码 Q，全码 TRNT」，§5.5）
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
  return fallbackPlanOf(c); // 防御：包内最短码 ≤ 全码，此路不应发生
}

// 课程表注入口（§5.4）：把拆解包挂到 wubi86 方案 —— planOf 升级双形态、
// codeOf 放宽课程池二字词（2+2 词码；§3.4 对 wubi86 的放宽，仓颉/速成维持仅单字）。
// 不注册进 schemes.js / PACKS：收尾轨以真包 wubi86-course.v1 调用，单测注入夹具。
export function bindWubiCourse(scheme, pack) {
  const table = {};
  for (const [k, v] of Object.entries(pack || {})) if (!k.startsWith('_')) table[k] = v;
  scheme.courseTable = table;
  scheme.rootNames = (pack && pack._meta && pack._meta.rootNames) || {};
  const baseCodeOf = scheme.codeOf;
  scheme.codeOf = (entry) => {
    const word = entry && entry.word;
    if (word && [...word].length === 2) return wubiWordCode(word, scheme.courseTable); // 2+2 词码
    return baseCodeOf(entry); // 单字仍查码表包（码权威不动）；三字及以上维持仅单字纪律
  };
  scheme.planOf = (code, entry) => planOfWubi(code, entry, scheme.courseTable, scheme.rootNames);
  return scheme;
}
