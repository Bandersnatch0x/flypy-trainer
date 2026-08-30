// 注音（大千布局）基元：41 键 xlit + 拼音→注音派生（SPEC-0003 §2/§3.2，issue #4）。
//
// 键位事实出处：rime/rime-bopomofo（LGPL-3.0）zhuyin.yaml 的 keymap_bopomofo 一行
// xlit 与 pinyin_to_zhuyin 规则段（约 20 条）；本文件为自写转写实现（ADR-0005 先例），
// 不内置原文件。派生规则见 docs/research/v3-data-sources.md §3；例外全枚举
// （空韵 / y-w 头 / ü / er / ê / 呣 / 儿化 / 轻声=调 5）在单测逐一覆盖。
//
// 声调键（大千）：ˉ=空格 ˊ=6 ˇ=3 ˋ=4 ˙=7；注音无声调不出字，声调键是键序的收尾一键。

// ---- 大千键位 xlit（37 符号 → 37 键位）----
// 源串：ㄅㄆㄇㄈ ㄉㄊㄋㄌ ㄍㄎㄏ ㄐㄑㄒ ㄓㄔㄕㄖ ㄗㄘㄙ ㄧㄨㄩ ㄚㄛㄜㄝ ㄞㄟㄠㄡ ㄢㄣㄤㄥㄦ
export const ZM_SYMBOLS = 'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄧㄨㄩㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ';
export const ZM_KEYS = '1qaz2wsxedcrfv5tgbyhnujm8ik,9ol.0p;/-';

export const KEY_OF_ZM = Object.fromEntries([...ZM_SYMBOLS].map((s, i) => [s, ZM_KEYS[i]]));
export const ZM_OF_KEY = Object.fromEntries([...ZM_SYMBOLS].map((s, i) => [ZM_KEYS[i], s]));

// ---- 声调键与调号 ----
export const TONE_KEYS = { 1: ' ', 2: '6', 3: '3', 4: '4', 5: '7' }; // ˉ=空格（〔规格推断〕4）
export const TONE_MARKS = { 1: 'ˉ', 2: 'ˊ', 3: 'ˇ', 4: 'ˋ', 5: '˙' };
export const TONE_NAME = { 1: '第一声（ˉ）', 2: '第二声（ˊ）', 3: '第三声（ˇ）', 4: '第四声（ˋ）', 5: '轻声（˙）' };

// ---- 声母 / 韵母 → 注音符号 ----
const INITIAL_ZM = {
  b: 'ㄅ', p: 'ㄆ', m: 'ㄇ', f: 'ㄈ', d: 'ㄉ', t: 'ㄊ', n: 'ㄋ', l: 'ㄌ',
  g: 'ㄍ', k: 'ㄎ', h: 'ㄏ', j: 'ㄐ', q: 'ㄑ', x: 'ㄒ',
  zh: 'ㄓ', ch: 'ㄔ', sh: 'ㄕ', r: 'ㄖ', z: 'ㄗ', c: 'ㄘ', s: 'ㄙ',
};
const FINAL_ZM = {
  a: 'ㄚ', o: 'ㄛ', e: 'ㄜ', E: 'ㄝ', ai: 'ㄞ', ei: 'ㄟ', ao: 'ㄠ', ou: 'ㄡ',
  an: 'ㄢ', en: 'ㄣ', ang: 'ㄤ', eng: 'ㄥ', er: 'ㄦ',
  i: 'ㄧ', u: 'ㄨ', v: 'ㄩ',
  ia: 'ㄧㄚ', ie: 'ㄧㄝ', iao: 'ㄧㄠ', iou: 'ㄧㄡ', ian: 'ㄧㄢ', in: 'ㄧㄣ', iang: 'ㄧㄤ',
  ing: 'ㄧㄥ', iong: 'ㄩㄥ',
  ua: 'ㄨㄚ', uo: 'ㄨㄛ', uai: 'ㄨㄞ', uei: 'ㄨㄟ', uan: 'ㄨㄢ', uen: 'ㄨㄣ', uang: 'ㄨㄤ',
  ueng: 'ㄨㄥ', ong: 'ㄨㄥ',
  ve: 'ㄩㄝ', van: 'ㄩㄢ', vn: 'ㄩㄣ',
};
// 空韵（ㄭ）声母：后接 i 时不写韵符（知资痴诗日…）
const ZCSR = new Set(['zh', 'ch', 'sh', 'r', 'z', 'c', 's']);

// ---- 拼音→注音 xform 规则（规范化段，按序应用；对照注音音系自写转写）----
// 规则 01 呣（m→mu）｜02 ê（eh→ㄝ 哨兵 E）｜03–05 y 头｜06–07 w 头｜
// 08 jqx 后 u 实为 ü｜09–11 缩写还原 iu/ui/un
/** @type {[RegExp, string][]} */
const PY_XFORM = [
  [/^m$/, 'mu'],
  [/^eh$/, 'E'],
  [/^yi/, 'i'],
  [/^yu/, 'v'],
  [/^y/, 'i'],
  [/^wu/, 'u'],
  [/^w/, 'u'],
  [/^([jqx])u/, '$1v'],
  [/iu/, 'iou'],
  [/ui/, 'uei'],
  [/un/, 'uen'],
];

// 带调音节 → 注音分解。返回 {zm, tone, units:[{ch, role, note}]} 或 null。
// role：sm 声符 / jie 介符 / ym 韵符；声调键由调用方追加（role='tone'）。
export function toZhuyin(toned) {
  const m = String(toned == null ? '' : toned).trim().toLowerCase().match(/^([a-züê]+)([1-5])$/);
  if (!m) return null;
  const tone = +m[2];
  let base = m[1].replace(/ü/g, 'v');
  // 规则 12 儿化缩写：独立 r5 → er5（其余调的裸 r 非法）
  if (base === 'r') {
    if (tone !== 5) return null;
    base = 'er';
  }
  for (const [re, rep] of PY_XFORM) base = base.replace(re, rep);
  // 规则 13 声母切分（先两拼翘舌后单母）
  let sm = null;
  if (INITIAL_ZM[base.slice(0, 2)]) { sm = base.slice(0, 2); base = base.slice(2); }
  else if (INITIAL_ZM[base[0]]) { sm = base[0]; base = base.slice(1); }
  // 规则 14 空韵：ㄓㄔㄕㄖㄗㄘㄙ 后的 i 不写韵符
  if (sm && base === 'i' && ZCSR.has(sm)) base = '';
  const units = [];
  if (sm) units.push({ ch: INITIAL_ZM[sm], role: 'sm', note: `声母 ${INITIAL_ZM[sm]}` });
  if (base === '') {
    if (!sm) return null;
    return { zm: INITIAL_ZM[sm], tone, units };
  }
  // 规则 15 韵母表（含介音分解：ㄧㄨㄩ 开头且多符 → 介符 + 韵符）
  const zmFinal = FINAL_ZM[base];
  if (!zmFinal) return null;
  if (zmFinal.length > 1 && 'ㄧㄨㄩ'.includes(zmFinal[0])) {
    units.push({ ch: zmFinal[0], role: 'jie', note: `介符 ${zmFinal[0]}` });
    units.push({ ch: zmFinal.slice(1), role: 'ym', note: `韵符 ${zmFinal.slice(1)}` });
  } else {
    units.push({ ch: zmFinal, role: 'ym', note: `韵符 ${zmFinal}` });
  }
  return { zm: (sm ? INITIAL_ZM[sm] : '') + zmFinal, tone, units };
}

// 带调音节 → 按键键序（符号键 + 声调键）；不可派生返回 null
export function keysOfToned(toned) {
  const z = toZhuyin(toned);
  if (!z) return null;
  return z.units.map(u => KEY_OF_ZM[u.ch]).join('') + TONE_KEYS[z.tone];
}

// 带调音节 → 扁平键序 plan 片段（§3.2；声调键收尾，第一声键记 ' '）
export function planOfToned(toned) {
  const z = toZhuyin(toned);
  if (!z) return null;
  const keys = z.units.map(u => ({ key: KEY_OF_ZM[u.ch], label: u.ch, note: u.note, role: u.role }));
  keys.push({
    key: TONE_KEYS[z.tone],
    label: z.tone === 1 ? '空格' : TONE_MARKS[z.tone],
    note: TONE_NAME[z.tone],
    role: 'tone',
  });
  return keys;
}

// ---- 大千 41 键布局（ROWS 字符串模型，含数字行；声调 1 键=空格由 extraKeys 承载）----
// 数字行 11 键（含调键 ˊ6 ˇ3 ˋ4 与 ˙7 所在列的 -）+ 字母三行 30 键 = 41 符号/调键位。
export const ZY_ROWS = ['1234567890-', 'qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'];
export const ZY_EXTRA_KEYS = [' '];

// 课程阶 1 操练分组（§4.1 注音列：声符→介符→韵符→声调键收尾；单元=符号键〔规格推断〕5）
const SYM = [...ZM_SYMBOLS];
export const ZY_GROUPS = {
  sm: SYM.slice(0, 21).map(s => KEY_OF_ZM[s]),   // 声符 21
  jie: SYM.slice(21, 24).map(s => KEY_OF_ZM[s]), // 介符 3
  ym: SYM.slice(24).map(s => KEY_OF_ZM[s]),      // 韵符 13
  tone: [TONE_KEYS[1], TONE_KEYS[2], TONE_KEYS[3], TONE_KEYS[4], TONE_KEYS[5]], // 声调键 5
};
