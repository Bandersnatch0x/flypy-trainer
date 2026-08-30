// 方案注册表（v3 引擎骨架）：规范接口 {id, name, paradigm, codeOf, planOf, layout, activate}。
// - codeOf(entry) 派生编码；返回 null = 不可出题，引擎过滤。
// - planOf(code, entry) 返回扁平键序 {keys:[{key,label,note,role}], groups?}，按下标寻址，
//   「每音节两键」只是双拼实现的内部细节，不再是引擎假设（SPEC-0003 §3.1–3.2）。
// - makeScheme 是音码（双拼族）实现工厂；全拼另走恒等派生。形码（字表查询）后续票接入。
// 键位表译自 iDvel/rime-ice 与 rime-double-pinyin 官方 schema algebra 段（ADR-0005），自写表。
import { normalizeSyllable, splitSyllable, splitPinyin, YM as FLYPY_YM, SM_KEYS as FLYPY_SM, SM_NAME as FLYPY_SMN } from './flypy.js';

const ROWS3 = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const ID = { i: 'i', u: 'u', v: 'v' };

// ---- 音码（双拼族）工厂 ----
function makeScheme(cfg) {
  // 单音节 → 扁平键序（双拼 = 两键，仅本实现内部成立）
  const planSyllable = (sylIn) => {
    const syl = normalizeSyllable(sylIn);
    if (!syl) return null;
    const [sm, ym] = splitSyllable(syl);
    if (!sm) {
      if (/^[aoe]$/.test(syl)) {
        if (cfg.zeroDouble) { // 小鹤/自然码：单韵母按两下
          return [
            { key: syl, label: syl.toUpperCase(), note: `单韵母 ${syl}`, role: 'lead' },
            { key: syl, label: syl.toUpperCase(), note: '按两下', role: 'lead' },
          ];
        }
        // 微软族：o 引导（啊=oa）
        const ymKey = cfg.YM[syl] || syl;
        return [
          { key: 'o', label: 'O', note: '零声母引导', role: 'lead' },
          { key: ymKey, label: ymKey.toUpperCase(), note: `韵母 ${syl}`, role: 'ym' },
        ];
      }
      const lead = cfg.zero === 'o' ? 'o' : syl[0];
      const ymKey = cfg.YM[ym] || ym[0];
      return [
        { key: lead, label: lead.toUpperCase(), note: '零声母引导', role: 'lead' },
        { key: ymKey, label: ymKey.toUpperCase(), note: `韵母 ${ym}`, role: 'ym' },
      ];
    }
    const smKey = cfg.SM_KEYS[sm] || sm;
    // jqxy 后的 u 实为 ü（剧=ju→jv，jqxy 双收规范式）
    const ym2 = cfg.jqxyV && 'jqxy'.includes(sm) && ym === 'u' ? 'v' : ym;
    const ymKey = cfg.YM[ym2] || ym2;
    return [
      { key: smKey, label: smKey.toUpperCase(), note: `声母 ${sm}`, role: 'sm' },
      { key: ymKey, label: ymKey.toUpperCase(), note: `韵母 ${ym2}`, role: 'ym' },
    ];
  };

  const sylsOf = (py) => {
    const s = String(py || '').trim();
    if (!s) return null;
    return splitPinyin(s.replace(/\s+/g, '')) || s.split(/\s+/).filter(Boolean);
  };

  const codeOf = (entry) => {
    if (!entry) return null;
    // srcCode 直用是能力位（当前仅小鹤开）：服务 custom_phrase 类无拼音词目与 Rime 导出
    if (cfg.acceptSrcCode && entry.srcCode && (!entry.srcScheme || entry.srcScheme === cfg.id)) {
      return String(entry.srcCode).toLowerCase();
    }
    const syls = sylsOf(entry.py);
    if (!syls || !syls.length) return null;
    let code = '';
    for (const s of syls) {
      const ks = planSyllable(s);
      if (!ks) return null;
      code += ks.map(k => k.key).join('');
    }
    return code || null;
  };

  const planOf = (code, entry) => {
    const keys = [];
    const groups = [];
    const syls = entry && entry.py ? sylsOf(entry.py) : null;
    if (syls && syls.length) {
      for (const s of syls) {
        const ks = planSyllable(s);
        if (!ks) return { keys: [], groups: [] };
        groups.push({ syl: s, start: keys.length, len: ks.length });
        keys.push(...ks);
      }
    } else {
      for (const ch of String(code || '')) keys.push({ key: ch, label: ch.toUpperCase(), note: '', role: '码键' });
    }
    return { keys, groups };
  };

  // 键帽小字：韵母反查（派生自表，不再有全局硬编码）
  const ymAt = {};
  for (const [ym, k] of Object.entries(cfg.YM || {})) (ymAt[k] ||= []).push(ym);

  const layout = {
    ROWS: cfg.ROWS || ROWS3,
    extraKeys: cfg.extraKeys || [],
    keyLabel: (ch) => ({ main: ch === ';' ? ';' : ch.toUpperCase(), sub: (ymAt[ch] || []).join('/') }),
    specialOf: (ch) => (cfg.SM_NAME && cfg.SM_NAME[ch]) || '',
  };

  return {
    id: cfg.id, name: cfg.name, paradigm: 'phonetic',
    codeOf, planOf, layout,
    activate: () => Promise.resolve(), // 音码无数据包，立即就绪（§3.1）
    YM: cfg.YM, SM_KEYS: cfg.SM_KEYS || {}, SM_NAME: cfg.SM_NAME || {},
    toFly: (syl) => codeOf({ word: '', py: syl }) || '', // 音节级便捷式（单测/文案用）
  };
}

// ---- 全拼：码即拼音本身，变长键序（2–6 键/音节），无新码表 ----
function makeQuanpin() {
  const planSyllable = (sylIn) => {
    const syl = normalizeSyllable(sylIn);
    if (!syl) return null;
    const [sm] = splitSyllable(syl);
    const smLen = sm ? sm.length : 0;
    return [...syl].map((ch, i) => ({
      key: ch, label: ch.toUpperCase(), note: '', role: i < smLen ? 'sm' : 'ym',
    }));
  };
  const codeOf = (entry) => {
    if (!entry || !entry.py) return null;
    const syls = splitPinyin(String(entry.py).replace(/\s+/g, '')) || String(entry.py).trim().split(/\s+/).filter(Boolean);
    let code = '';
    for (const s of syls) {
      const ks = planSyllable(s);
      if (!ks) return null;
      code += ks.map(k => k.key).join('');
    }
    return code || null;
  };
  const planOf = (code, entry) => {
    const keys = [];
    const groups = [];
    const syls = entry && entry.py
      ? (splitPinyin(String(entry.py).replace(/\s+/g, '')) || String(entry.py).trim().split(/\s+/).filter(Boolean))
      : null;
    if (syls && syls.length) {
      for (const s of syls) {
        const ks = planSyllable(s);
        if (!ks) return { keys: [], groups: [] };
        groups.push({ syl: s, start: keys.length, len: ks.length });
        keys.push(...ks);
      }
    } else {
      for (const ch of String(code || '')) keys.push({ key: ch, label: ch.toUpperCase(), note: '', role: '码键' });
    }
    return { keys, groups };
  };
  return {
    id: 'quanpin', name: '全拼', paradigm: 'phonetic',
    codeOf, planOf,
    layout: {
      ROWS: ROWS3, extraKeys: [],
      keyLabel: (ch) => ({ main: ch.toUpperCase(), sub: '' }),
      specialOf: () => '',
    },
    activate: () => Promise.resolve(),
    YM: {}, SM_KEYS: {}, SM_NAME: {},
    toFly: (syl) => codeOf({ word: '', py: syl }) || '',
  };
}

export const SCHEMES = {
  flypy: makeScheme({
    id: 'flypy', name: '小鹤双拼', zero: 'first', zeroDouble: true, jqxyV: true,
    acceptSrcCode: true, ROWS: ROWS3,
    SM_KEYS: FLYPY_SM, SM_NAME: FLYPY_SMN, YM: FLYPY_YM,
  }),
  mspy: makeScheme({
    id: 'mspy', name: '微软双拼', zero: 'o', zeroDouble: false, jqxyV: true, ROWS: ROWS3, extraKeys: [';'],
    SM_KEYS: { zh: 'v', ch: 'i', sh: 'u' }, SM_NAME: { v: 'zh', i: 'ch', u: 'sh' },
    YM: { ...ID, iu: 'q', ia: 'w', ua: 'w', uan: 'r', er: 'r', ue: 't', ve: 't', uo: 'o',
      uai: 'y', v: 'y', ong: 's', iong: 's', iang: 'd', uang: 'd', en: 'f', eng: 'g',
      ang: 'h', ian: 'm', an: 'j', iao: 'c', ao: 'k', ai: 'l', ei: 'z', ie: 'x', ui: 'v',
      ou: 'b', in: 'n', ing: ';', un: 'p' },
  }),
  sogou: makeScheme({
    id: 'sogou', name: '搜狗双拼', zero: 'o', zeroDouble: false, jqxyV: true, ROWS: ROWS3, extraKeys: [';'],
    SM_KEYS: { zh: 'v', ch: 'i', sh: 'u' }, SM_NAME: { v: 'zh', i: 'ch', u: 'sh' },
    YM: { ...ID, iu: 'q', ia: 'w', ua: 'w', uan: 'r', er: 'r', ue: 't', ve: 't', uo: 'o',
      uai: 'y', v: 'y', ong: 's', iong: 's', iang: 'd', uang: 'd', en: 'f', eng: 'g',
      ang: 'h', ian: 'm', an: 'j', iao: 'c', ao: 'k', ai: 'l', ei: 'z', ie: 'x', ui: 'v',
      ou: 'b', in: 'n', ing: ';', un: 'p' },
  }),
  abc: makeScheme({
    id: 'abc', name: '智能ABC', zero: 'o', zeroDouble: false, jqxyV: false, ROWS: ROWS3,
    SM_KEYS: { zh: 'a', ch: 'e', sh: 'v' }, SM_NAME: { a: 'zh', e: 'ch', v: 'sh' },
    YM: { ...ID, ei: 'q', ian: 'w', er: 'r', iu: 'r', iang: 't', uang: 't', ing: 'y', uo: 'o',
      uan: 'p', ong: 's', iong: 's', ia: 'd', ua: 'd', en: 'f', eng: 'g', ang: 'h',
      an: 'j', iao: 'z', ao: 'k', in: 'c', uai: 'c', ai: 'l', ie: 'x', ou: 'b', un: 'n',
      ve: 'm', ue: 'm', ui: 'm' },
  }),
  // 自然码：零特例复用双拼骨架 —— zero:'first' 首字母引导 + 单韵母按两下、jqxy 规范式取 v、
  // er 挂 R 键（儿=er 原样）、ing 挂 Y 键故无分号附键。与微软双拼仅差 3 处（Y 承载/分号键/ü 归属）。
  ziranma: makeScheme({
    id: 'ziranma', name: '自然码', zero: 'first', zeroDouble: true, jqxyV: true, ROWS: ROWS3,
    SM_KEYS: { zh: 'v', ch: 'i', sh: 'u' }, SM_NAME: { v: 'zh', i: 'ch', u: 'sh' },
    YM: { i: 'i', u: 'u', v: 'v',
      iu: 'q', ia: 'w', ua: 'w', uan: 'r', er: 'r', ue: 't', ve: 't', uo: 'o',
      uai: 'y', ing: 'y', ong: 's', iong: 's', iang: 'd', uang: 'd', en: 'f',
      eng: 'g', ang: 'h', ian: 'm', an: 'j', iao: 'c', ao: 'k', ai: 'l',
      ei: 'z', ie: 'x', ui: 'v', ou: 'b', in: 'n', un: 'p' },
  }),
  quanpin: makeQuanpin(),
};

export const DEFAULT_SCHEME = 'flypy'; // 小鹤仍是旗舰与默认（map-Q3a）
export function getScheme(id) { return SCHEMES[id] || SCHEMES[DEFAULT_SCHEME]; }
export const SCHEME_LIST = Object.values(SCHEMES).map(s => ({ id: s.id, name: s.name }));
