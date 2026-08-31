// 方案注册表（v3 引擎骨架）：规范接口 {id, name, paradigm, codeOf, planOf, layout, activate}。
// - codeOf(entry) 派生编码；返回 null = 不可出题，引擎过滤。
// - planOf(code, entry) 返回扁平键序 {keys:[{key,label,note,role}], groups?}，按下标寻址，
//   「每音节两键」只是双拼实现的内部细节，不再是引擎假设（SPEC-0003 §3.1–3.2）。
// - makeScheme 是音码（双拼族）实现工厂；全拼另走恒等派生；形码走 makeShapeScheme（字表查询，issue #5）。
// 键位表译自 iDvel/rime-ice 与 rime-double-pinyin 官方 schema algebra 段（ADR-0005），自写表。
const { normalizeSyllable, splitSyllable, splitPinyin, YM: FLYPY_YM, SM_KEYS: FLYPY_SM, SM_NAME: FLYPY_SMN } = require('./flypy.js');
const { ZY_ROWS, ZY_EXTRA_KEYS, ZM_OF_KEY, TONE_MARKS, toZhuyin, keysOfToned, planOfToned } = require('./zhuyin.js');
const { keysOfToned: jpKeysOfToned, planOfToned: jpPlanOfToned, JP_SM_KEYS, JP_YM_KEYS } = require('./jyutping.js');
const { CJ_LETTERS, quickOf } = require('./cangjie.js');
const { WB_ROOTS, bindWubiCourse } = require('./wubi.js');
const { bindPack, loadPack, packMeta } = require('./packs.js');

const ROWS3 = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const ID = { i: 'i', u: 'u', v: 'v' };

// ---- 拼音派生公共件（双拼族与全拼共用，#9 收口）----
// 拼音串 → 音节列表（去空白后整串切分，退化按空格兜底）；空串 → null
const sylsOf = (py) => {
  const s = String(py || '').trim();
  if (!s) return null;
  return splitPinyin(s.replace(/\s+/g, '')) || s.split(/\s+/).filter(Boolean);
};

// 音节级键序骨架 → 扁平编码：planSyllable(syl) → [{key,...}]，任一音节不可派生则整体 null
const codeOfPyEntry = (entry, planSyllable) => {
  if (!entry) return null;
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

// 键序骨架 → plan：按音节分组 {keys, groups:[{syl,start,len}]}；
// 无拼音可查时退化为逐码键（note 恒空，角标由布局键帽派生）
const planOfPyEntry = (code, entry, planSyllable) => {
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

  const codeOf = (entry) => {
    // srcCode 直用是能力位（当前仅小鹤开）：服务 custom_phrase 类无拼音词目与 Rime 导出
    if (cfg.acceptSrcCode && entry && entry.srcCode && (!entry.srcScheme || entry.srcScheme === cfg.id)) {
      return String(entry.srcCode).toLowerCase();
    }
    return codeOfPyEntry(entry, planSyllable);
  };

  const planOf = (code, entry) => planOfPyEntry(code, entry, planSyllable);

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
// codeOf/planOf 走拼音派生公共件（与双拼族同骨架，#9 收口），仅 planSyllable 为全拼特有
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
  const codeOf = (entry) => codeOfPyEntry(entry, planSyllable);
  const planOf = (code, entry) => planOfPyEntry(code, entry, planSyllable);
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

// ---- 注音：py 派生（声明带调数据依赖，SPEC-0003 §2）----
// 带调拼音来自 zhuyin-tones pack（activate() 懒加载，表落 scheme.table，按词查带调音节）；
// 码 = 拼音→注音派生键序（符号键 + 声调键收尾，第一声键 = 空格 ' '）。大千 41 键布局，
// 键帽主显注音符号、角标物理键（T4-Q5）。
function makeZhuyin() {
  const tonedSylsOf = (entry) => {
    const toned = entry && entry.word && scheme.table ? scheme.table[entry.word] : null;
    return toned ? String(toned).split(' ') : null;
  };
  const codeOf = (entry) => {
    const syls = tonedSylsOf(entry);
    if (!syls) return null; // 表未就绪或缺字 → 不可出题，引擎过滤（§3.1）
    let code = '';
    for (const s of syls) {
      const ks = keysOfToned(s);
      if (!ks) return null;
      code += ks;
    }
    return code || null;
  };
  const planOf = (code, entry) => {
    const keys = [];
    const groups = [];
    const syls = tonedSylsOf(entry);
    if (syls) {
      for (const s of syls) {
        const ks = planOfToned(s);
        if (!ks) return { keys: [], groups: [] };
        groups.push({ syl: s, start: keys.length, len: ks.length });
        keys.push(...ks);
      }
    } else {
      for (const ch of String(code || '')) keys.push({ key: ch, label: keyLabel(ch).main, note: '', role: '码键' });
    }
    return { keys, groups };
  };
  // 提示文案码文本：注音符号串 + 调号（含第一声 ˉ，无声调不出字）
  const displayOf = (entry) => {
    const syls = tonedSylsOf(entry);
    if (!syls) return null;
    const parts = [];
    for (const s of syls) {
      const z = toZhuyin(s);
      if (!z) return null;
      parts.push(z.zm + TONE_MARKS[z.tone]);
    }
    return parts.join(' ');
  };
  const keyLabel = (ch) => {
    if (ch === ' ') return { main: 'ˉ', sub: '空格', title: '声调一（ˉ）· 空格键' };
    const zm = ZM_OF_KEY[ch];
    return zm
      ? { main: zm, sub: ch, title: `${zm} · 键 ${ch.toUpperCase()}` }
      : { main: ch.toUpperCase(), sub: '', title: `键 ${ch.toUpperCase()}` };
  };
  const layout = {
    ROWS: ZY_ROWS, extraKeys: ZY_EXTRA_KEYS,
    keyLabel,
    specialOf: () => '',
  };
  const scheme = {
    id: 'zhuyin', name: '注音', paradigm: 'phonetic',
    codeOf, planOf, displayOf, layout,
    activate: () => Promise.resolve(),
    YM: {}, SM_KEYS: {}, SM_NAME: {},
  };
  return bindPack(scheme, 'zhuyin');
}

// ---- 粤拼：带调字表查询 + 近恒等派生（SPEC-0004 §2，issue #10）----
// 带调粤拼来自 jyutping-tones pack（activate() 懒加载，表落 scheme.table；构建期简繁桥后
// 以简体为键，运行时零映射）。码 = 字母串即键序 + 六调键收尾（1→v 2→x 3→q；阳调 4/5/6
// 同键双敲，plan 为单一连击单元）；displayOf = 带调粤拼串。标准 26 键零布局。
function makeJyutping() {
  const tonedSylsOf = (entry) => {
    const toned = entry && entry.word && scheme.table ? scheme.table[entry.word] : null;
    return toned ? String(toned).split(' ') : null;
  };
  const codeOf = (entry) => {
    const syls = tonedSylsOf(entry);
    if (!syls) return null; // 表未就绪或缺字 → 不可出题，引擎过滤（§3.1）
    let code = '';
    for (const s of syls) {
      const ks = jpKeysOfToned(s);
      if (!ks) return null;
      code += ks;
    }
    return code || null;
  };
  const planOf = (code, entry) => {
    const keys = [];
    const groups = [];
    const syls = tonedSylsOf(entry);
    if (syls) {
      for (const s of syls) {
        const ks = jpPlanOfToned(s);
        if (!ks) return { keys: [], groups: [] };
        groups.push({ syl: s, start: keys.length, len: ks.reduce((n, k) => n + (k.span || 1), 0) });
        keys.push(...ks);
      }
    } else {
      for (const ch of String(code || '')) keys.push({ key: ch, label: ch.toUpperCase(), note: '', role: '码键' });
    }
    return { keys, groups };
  };
  // 提示文案码文本：带调粤拼串（如 nei5 hou2，§2.3）
  const displayOf = (entry) => {
    const syls = tonedSylsOf(entry);
    return syls ? syls.join(' ') : null;
  };
  const toneTitle = {
    v: '声调键 · 阴平调 1 单按 / 阳平调 4 同键连按两下',
    x: '声调键 · 阴上调 2 单按 / 阳上调 5 同键连按两下',
    q: '声调键 · 阴去调 3 单按 / 阳去调 6 同键连按两下',
  };
  const toneSub = { v: '调1/4', x: '调2/5', q: '调3/6' };
  const keyLabel = (ch) => {
    if (toneTitle[ch]) return { main: ch.toUpperCase(), sub: toneSub[ch], title: toneTitle[ch] };
    const sm = JP_SM_KEYS.includes(ch), ym = JP_YM_KEYS.includes(ch);
    const role = sm && ym ? '声母/韵母字母' : sm ? '声母字母' : ym ? '韵母字母' : '';
    return { main: ch.toUpperCase(), sub: '', title: role ? `键 ${ch.toUpperCase()} · ${role}` : `键 ${ch.toUpperCase()}` };
  };
  const layout = {
    ROWS: ROWS3, extraKeys: [],
    keyLabel,
    specialOf: () => '',
  };
  const scheme = {
    id: 'jyutping', name: '粤拼', paradigm: 'phonetic',
    codeOf, planOf, displayOf, layout,
    YM: {}, SM_KEYS: {}, SM_NAME: {},
  };
  return bindPack(scheme, 'jyutping');
}

// ---- 形码（字表查询）：仓颉深教样板 + 速成官方变体（SPEC-0003 §2/§4，issue #5）----
// 码逐字查 cangjie5.base 派生：仓颉=全码；速成=首尾二码运行时派生，零码表（官方规则）。
// 取题仅单字（§3.4）：多字词/非仓颉表字返回 null，引擎过滤。
// plan=拆分步骤序列：label=字根名、note=字母——仓颉码即拆解序列，零额外数据（§4.2、T3-D3）。
function makeShapeScheme({ id, name, derive }) {
  const scheme = { id, name, paradigm: 'shape' };
  const codeOf = (entry) => {
    const word = entry && entry.word;
    if (!word || [...word].length !== 1) return null; // 取题仅单字（§3.4）
    const full = scheme.table ? scheme.table[word] : null;
    return full ? derive(full) : null; // 表未就绪/非仓颉字 → 不可出题
  };
  const labelOf = (ch) => {
    const L = CJ_LETTERS[ch];
    return L ? L.name : ch.toUpperCase();
  };
  const planOf = (code) => ({
    keys: [...String(code || '')].map((ch) => ({ key: ch, label: labelOf(ch), note: `字母 ${ch.toUpperCase()}`, role: 'root' })),
    groups: [],
  });
  const keyLabel = (ch) => {
    const L = CJ_LETTERS[ch];
    if (!L) return { main: ch.toUpperCase(), sub: '', title: `键 ${ch.toUpperCase()}` };
    return { main: ch.toUpperCase(), sub: L.name, title: `仓颉字母 ${ch.toUpperCase()} · 字根${L.name}` };
  };
  scheme.codeOf = codeOf;
  scheme.planOf = planOf;
  scheme.layout = {
    ROWS: ROWS3, extraKeys: [], keyLabel,
    specialOf: (ch) => (CJ_LETTERS[ch] && CJ_LETTERS[ch].special ? CJ_LETTERS[ch].name : ''), // X 难 / Z 重 描边单列
  };
  scheme.activate = () => Promise.resolve(); // bindPack 覆写为 pack 装载
  scheme.YM = {}; scheme.SM_KEYS = {}; scheme.SM_NAME = {};
  return bindPack(scheme, 'cangjie5'); // 速成与仓颉共用同一份字表（零码表，§2）
}

// ---- 五笔 86（全课程：码表包 + 拆解课程包同批懒加载，SPEC-0004 §5.4–5.5，issue #13 M3）----
// 课程包不可用时保留 plan 兼容兜底，课程入口必须显示未就绪并允许重试。
function makeWubi86() {
  const scheme = { id: 'wubi86', name: '五笔 86', paradigm: 'shape' };
  const codeOf = (entry) => {
    const word = entry && entry.word;
    if (!word || [...word].length !== 1) return null; // 取题仅单字（§3.4）
    return (scheme.table && scheme.table[word]) || null; // 表未就绪/缺码字 → 不可出题
  };
  const planOf = (code) => ({
    keys: [...String(code || '')].map((ch) => ({ key: ch, label: ch.toUpperCase(), note: '', role: '码键' })),
    groups: [],
  });
  const keyLabel = (ch) => {
    const R = WB_ROOTS[ch];
    if (R) return { main: ch.toUpperCase(), sub: R.roots, title: `五笔 86 · ${R.zone}区${R.pos}位 · 键上字根：${R.roots}` };
    return ch === 'z'
      ? { main: 'Z', sub: '学习', title: 'Z 学习键 · 不参与取码' }
      : { main: ch.toUpperCase(), sub: '', title: `键 ${ch.toUpperCase()}` };
  };
  scheme.codeOf = codeOf;
  scheme.planOf = planOf;
  scheme.layout = {
    ROWS: ROWS3, extraKeys: [], keyLabel,
    specialOf: (ch) => (ch === 'z' ? '学习' : ''), // Z 学习键描边单列，正码无一含 z
  };
  // full 档字根候选表（§4.2）：与字根总表页共用 WB_ROOTS 一份数据
  scheme.rootHint = (ch) => (WB_ROOTS[ch] ? `此键字根：${WB_ROOTS[ch].roots}` : '');
  scheme.YM = {}; scheme.SM_KEYS = {}; scheme.SM_NAME = {};
  bindPack(scheme, 'wubi86');
  scheme.coursePackId = 'wubi86-course';
  const loadCode = scheme.activate;
  scheme.activate = async () => {
    const table = await loadCode();
    try {
      const course = await loadPack('wubi86-course');
      bindWubiCourse(scheme, { ...course, _meta: packMeta('wubi86-course') });
      scheme.courseReady = true;
    } catch (err) {
      scheme.courseReady = false;
      scheme.courseTable = null;
      throw err;
    }
    return table;
  };
  return scheme;
}

// ---- 五笔画（笔画输入）：标准 shape 单字查表（SPEC-0004 §3.2，issue #11）----
// 五键 = 横竖撇捺折；点归捺、提归横、带转折归折。无词码，逐笔输入。
const SK_KEYS = ['h', 's', 'p', 'n', 'z'];
const SK_STROKE = { h: '横', s: '竖', p: '撇', n: '捺', z: '折' };
const SK_FORM = { h: '⼀', s: '⼁', p: '⼃', n: '⼂', z: '⼄' };
const SK_TITLE = {
  h: '横 · 提归横（提笔在此键）',
  s: '竖 · 竖笔在此键',
  p: '撇 · 撇笔在此键',
  n: '捺 · 点归捺（点笔在此键）',
  z: '折 · 带转折的笔画皆归此键（竖钩/横折钩/斜钩/卧钩一类）',
};

function makeStroke() {
  const scheme = { id: 'stroke', name: '五笔画', paradigm: 'shape' };
  const codeOf = (entry) => {
    const word = entry && entry.word;
    if (!word || [...word].length !== 1) return null;
    return (scheme.table && scheme.table[word]) || null;
  };
  const planOf = (code) => ({
    keys: [...String(code || '')].map((ch) => ({ key: ch, label: SK_STROKE[ch] || ch.toUpperCase(), note: '', role: 'root' })),
    groups: [],
  });
  const keyLabel = (ch) => SK_STROKE[ch]
    ? { main: ch.toUpperCase(), sub: SK_FORM[ch], title: `五笔画 · ${SK_TITLE[ch]} · 键 ${ch.toUpperCase()}` }
    : { main: ch.toUpperCase(), sub: '', title: `键 ${ch.toUpperCase()} · 五笔画不使用` };
  scheme.codeOf = codeOf;
  scheme.planOf = planOf;
  scheme.layout = {
    ROWS: ROWS3, extraKeys: [], keyLabel,
    specialOf: () => '',
  };
  scheme.activate = () => Promise.resolve();
  scheme.YM = {}; scheme.SM_KEYS = {}; scheme.SM_NAME = {};
  return bindPack(scheme, 'stroke');
}

const SCHEMES = {
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
  zhuyin: makeZhuyin(),
  jyutping: makeJyutping(), // 粤拼：带调字表 + 六调键近恒等派生（SPEC-0004 §2，issue #10）
  cangjie: makeShapeScheme({ id: 'cangjie', name: '仓颉', derive: (full) => full }), // 深教样板（T3-D1/D2）
  quick: makeShapeScheme({ id: 'quick', name: '速成', derive: quickOf }), // 官方变体：首尾二码，复用全五阶（T3-D4）
  stroke: makeStroke(), // 五笔画：五键笔顺输入，形码入门（SPEC-0004 §3，issue #11）
  wubi86: makeWubi86(), // 全课程；课程包不可用时仅保留兼容兜底
};

const DEFAULT_SCHEME = 'flypy'; // 小鹤仍是旗舰与默认（map-Q3a）
function getScheme(id) { return SCHEMES[id] || SCHEMES[DEFAULT_SCHEME]; }

module.exports = { SCHEMES, DEFAULT_SCHEME, getScheme, SK_KEYS };
