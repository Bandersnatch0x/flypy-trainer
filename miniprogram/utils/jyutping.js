// 粤拼基元：六调键派生（SPEC-0004 §2.3，issue #10；小程序版自 web 版 js/jyutping.js 对齐）。
//
// 键位事实出处：CanCLID/rime-cantonese（CC-BY-4.0）jyut6ping3.schema.yaml 的
// speller/algebra 段——阴调单键、阳调双键：1→v、2→x、3→q、4→vv、5→xx、6→qq；
// 入声音节随韵尾（-p/-t/-k）挂同一调键（官方 README 例：sikv=色、sekq=錫、sikqq=食）。
// 选 q/v/x 之因：标准粤拼拼写字母不含这三字母，无冲突。本文件为自写派生实现
// （ADR-0005 先例），不内置上游文件。
//
// 派生近恒等：字母串即键序，仅尾缀数字 1–6 → 调键映射；声调键为音节收尾键，
// role:'tone'，与注音 TONE_KEYS 机制同构。阳调（4/5/6）为同键双敲——
// plan 呈现为单一单元（span=2 + note「同键连按两下」），引擎按累计键位寻址。

// ---- 六调键与调名 ----
const JP_TONE_KEYS = { 1: 'v', 2: 'x', 3: 'q', 4: 'vv', 5: 'xx', 6: 'qq' };
const JP_TONE_NAME = {
  1: '阴平', 2: '阴上', 3: '阴去', 4: '阳平', 5: '阳上', 6: '阳去',
};

// ---- 声母/韵母字母键（标准粤拼拼写共 22 字母；q/r/v/x 不入拼写，q/v/x 专作调键）----
const JP_SM_KEYS = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'z', 'c', 's', 'j', 'y', 'w'];
const JP_YM_KEYS = ['a', 'i', 'u', 'e', 'o', 'm', 'n', 'g', 'p', 't', 'k'];
const JP_TONE_KEY_LIST = ['v', 'x', 'q'];

// 带调音节 → 按键键序（字母原样 + 尾缀调键）；不可派生 → null
function keysOfToned(toned) {
  const m = String(toned == null ? '' : toned).trim().toLowerCase().match(/^([a-z]+)([1-6])$/);
  return m ? m[1] + JP_TONE_KEYS[+m[2]] : null;
}

// 带调音节 → 扁平键序 plan 片段：字母键逐键 + 调键收尾。
// 阳调双敲 = 单一连击单元：一个 plan 单元 span=2，note「同键连按两下」（§2.3 验收点）
function planOfToned(toned) {
  const m = String(toned == null ? '' : toned).trim().toLowerCase().match(/^([a-z]+)([1-6])$/);
  if (!m) return null;
  const tone = +m[2];
  const keys = [...m[1]].map((ch) => ({ key: ch, label: ch.toUpperCase(), note: '', role: 'ym' }));
  const tk = JP_TONE_KEYS[tone][0];
  keys.push(tone <= 3
    ? { key: tk, label: tk.toUpperCase(), note: `${JP_TONE_NAME[tone]} · 声调 ${tone}`, role: 'tone' }
    : { key: tk, label: tk.toUpperCase().repeat(2), note: `${JP_TONE_NAME[tone]} · 同键连按两下`, role: 'tone', span: 2 });
  return keys;
}

// plan 单元寻址（span 感知）：累计键位 pos → 单元；无 span 字段视作 1（既有方案行为不变）
function planUnitAt(keys, pos) {
  let off = 0;
  for (let i = 0; i < keys.length; i++) {
    const span = keys[i].span || 1;
    if (pos < off + span) return { unit: keys[i], index: i, start: off };
    off += span;
  }
  return null;
}

module.exports = { JP_TONE_KEYS, JP_TONE_NAME, JP_SM_KEYS, JP_YM_KEYS, JP_TONE_KEY_LIST, keysOfToned, planOfToned, planUnitAt };
