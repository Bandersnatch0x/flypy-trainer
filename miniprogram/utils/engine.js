// 练习引擎（平台无关状态机，自 web 版 js/app.js §练习引擎 抽取）：
// 出题/判定/计速/自适应只依赖 store 与 scheme 接口，渲染层（页面）只读快照 + 接住 press 结果。
// 与 web 版行为逐条对齐：SESSION_LEN=20 / SPRINT_SECS=60 / 判定 ch===expected[pos] /
// finaldrill SRS 记账 / sprint 连击 / 错词本 {word,py,errPos} / adapt 升降档（ADR-0006）。
const { BUILTIN } = require('./data.js');
const { courseOf, confusKeys, confusEndsMatch, syllablesOf } = require('./courses.js');
const { firstKeyOfWubi } = require('./wubi.js');
const { mergeEntries, weightedSample } = require('./parsers.js');
const { store } = require('./store.js');
const { sound } = require('./sound.js');
const { planUnitAt } = require('./jyutping.js');

const SESSION_LEN = 20;
const SPRINT_SECS = 60;

let scheme = null;
let toastFn = () => {};

let queue = [], idx = 0, planKeys = [], expected = '', pos = 0, doneWords = 0;
let startTime = 0, correctKeys = 0, wrongKeys = 0;
let mode = 'chars', drillKey = '', drillSeq = [], drillUnit = 'ymKey', combo = 0, wrongInWord = false;
let finished = false;
let wrongWordsThisSession = new Set();

const SENTENCES = (() => { // 二字词连句（2-3 词）
  const out = [];
  const w = BUILTIN.words2;
  for (let i = 0; i + 1 < w.length; i += 2) {
    out.push({ word: w[i].w + w[i + 1].w, py: `${w[i].p} ${w[i + 1].p}`, weight: 1 });
  }
  for (let i = 0; i + 2 < w.length; i += 3) {
    out.push({ word: w[i].w + w[i + 1].w + w[i + 2].w, py: `${w[i].p} ${w[i + 1].p} ${w[i + 2].p}`, weight: 1 });
  }
  return out;
})();

function setScheme(s) { scheme = s; }
function setToast(fn) { toastFn = fn || (() => {}); }

// 词条 plan 是否触达给定物理键（可限定 role）——方案无关
function entryTouchesKey(e, keys, role) {
  const code = scheme.codeOf(e);
  if (!code) return false;
  const plan = scheme.planOf(code, e);
  return (plan?.keys || []).some(k => keys.includes(k.key) && (!role || k.role === role));
}

function poolFor(mIn) {
  const m = mIn.split('@')[0]; // 课程练习阶 '@seq' 后缀只影响轮内排序，不影响取题池
  const imported = store.getPool();
  const mk = store.getMistakes(scheme.id);
  const bi = (arr) => arr.map(({ w, p }) => ({ word: w, py: p, weight: 1 }));
  if (m.startsWith('weak:')) {
    const k = m.slice(5);
    return [...bi(BUILTIN.chars), ...imported].filter(e => entryTouchesKey(e, [k]));
  }
  if (m.startsWith('confus:')) {
    const pair = courseOf(scheme.id).confus[Number(m.slice(7)) || 0];
    if (!pair) return [];
    const base = [...bi(BUILTIN.chars), ...bi(BUILTIN.words2)];
    if (pair.ends) return base.filter(e => confusEndsMatch(e.py, pair));
    const role = ['sm', 'ym', 'root'].includes(pair.role) ? pair.role : undefined;
    return base.filter(e => entryTouchesKey(e, confusKeys(pair, scheme), role));
  }
  if (m.includes('+') && !m.includes(':')) { // 课程练习阶多池合并（如 words34+sentences）
    const seen = new Map();
    for (const part of m.split('+')) for (const e of poolFor(part)) if (!seen.has(e.word)) seen.set(e.word, e);
    return [...seen.values()];
  }
  switch (m) {
    case 'chars': return bi(BUILTIN.chars);
    case 'words2': return bi(BUILTIN.words2);
    case 'words34': return bi(BUILTIN.words34);
    case 'sentences': return SENTENCES;
    case 'sprint': case 'mixed':
      return mergeEntries([[...bi(BUILTIN.chars).slice(0, 200), ...bi(BUILTIN.words2).slice(0, 300)], imported]).entries;
    case 'personal': return imported;
    case 'mistakes': return mk.map(({ word, py }) => ({ word, py: py || '', weight: 1 }));
  }
  return [];
}

// 出题：码由当前方案 codeOf 派生；plan 为扁平键序。不可派生 → null 被过滤
function prepareEntry(e) {
  const code = scheme.codeOf(e);
  if (!code) return null;
  const plan = scheme.planOf(code, e);
  const display = scheme.displayOf ? scheme.displayOf(e) : null; // 注音：码文本显注音符号（§4.2）
  return { word: e.word, py: e.py || '', code, display: display || code, plan };
}

// 返回 {status:'ok'|'empty'|'filtered'}：empty=池空；filtered=池有条目但全被 codeOf 过滤
function startSession(sourceMode, opts = {}) {
  mode = sourceMode || mode;
  drillKey = opts.drillKey || '';
  drillSeq = opts.drillSeq || [];
  drillUnit = opts.drillUnit || 'ymKey';
  wrongWordsThisSession = new Set();
  finished = false;
  const pool = poolFor(mode);
  if (!pool.length) { resetBoard(); return { status: 'empty' }; }
  const n = mode === 'sprint' ? Math.min(300, pool.length) : Math.min(SESSION_LEN, pool.length);
  const raw = weightedSample(pool, n);
  queue = raw.map(prepareEntry).filter(Boolean);
  if (!queue.length) { resetBoard(); return { status: 'filtered' }; }
  if (mode.endsWith('@len')) queue.sort((a, b) => a.code.length - b.code.length); // 先简字后满码（#5 阶 2）
  idx = 0; doneWords = 0; startTime = 0; correctKeys = 0; wrongKeys = 0; combo = 0;
  advance();
  return { status: 'ok', queueLength: queue.length };
}

function resetBoard() {
  queue = []; idx = 0; expected = ''; planKeys = []; pos = 0;
}

// 间隔重复操练开局（=web 版 startDrill）：单元池按操练维度过滤内置单字池
function startDrill(st, first, seq) {
  mode = 'finaldrill';
  drillUnit = st.unit;
  drillKey = first;
  drillSeq = seq || [first];
  finished = false;
  wrongWordsThisSession = new Set();
  const chars = BUILTIN.chars.map(({ w, p }) => ({ word: w, py: p, weight: 1 }));
  let hit;
  if (drillUnit === 'syllable') {
    hit = chars.filter(e => syllablesOf(e.py).some(s => drillSeq.includes(s)));
  } else if (drillUnit === 'letter' || drillUnit === 'wbkey') {
    // 形码拆字操练：字根形反查题 + 课程字首码题
    const rootWords = new Set(drillSeq.map(k => st.roots && Object.entries(st.roots).find(([, key]) => key === k)?.[0]).filter(Boolean));
    const roots = [...rootWords].map(w => ({ word: w, py: '', weight: 3 }));
    hit = [...roots, ...chars.filter(e => {
      if (rootWords.has(e.word)) return false;
      const c = scheme.codeOf(e);
      const first = scheme.courseTable && scheme.courseTable[e.word]
        ? firstKeyOfWubi(e, scheme.courseTable, c) : c && c[0];
      return first && drillSeq.includes(first);
    })];
  } else {
    hit = chars.filter(e => entryTouchesKey(e, drillSeq, drillUnit === 'ymKey' ? 'ym' : undefined));
  }
  const raw = weightedSample(hit, Math.min(SESSION_LEN, hit.length));
  queue = raw.map(prepareEntry).filter(Boolean);
  if (!queue.length) { resetBoard(); return { status: 'empty' }; }
  idx = 0; doneWords = 0; startTime = 0; correctKeys = 0; wrongKeys = 0; combo = 0;
  advance();
  return { status: 'ok', queueLength: queue.length };
}

function current() { return queue[idx]; }

// 词间推进（=web 版 next() 的状态部分；高亮/提示渲染在页面层）
function advance() {
  if (mode === 'sprint' && idx >= queue.length) idx = 0; // 冲刺循环取题
  const it = current();
  expected = it.code;
  planKeys = (it.plan && it.plan.keys) || [];
  pos = 0; wrongInWord = false;
}

function trackWrongWord() {
  const it = current();
  if (it && !wrongWordsThisSession.has(it.word)) {
    wrongWordsThisSession.add(it.word);
    // 错词本弃码快照：存 {word, py, errPos}，回灌时按当前方案重派（§3.6）
    store.addMistake(scheme.id, { word: it.word, py: it.py, errPos: pos });
  }
}

// 击键判定（=web 版 onInput 的状态部分）：一次一字符，页面把软键盘/系统键盘输入拆字符送入
function press(chIn) {
  if (!queue.length || idx >= queue.length || finished) return null;
  if (!startTime) startTime = Date.now();
  const ch = String(chIn).toLowerCase();
  if (!ch) return null;
  const ok = ch === expected[pos];
  store.addKey(scheme.id, ch, ok);
  const settings = store.getSettings();
  if (settings.sound) (ok ? sound.key : sound.miss)();
  if (ok) {
    correctKeys++;
    pos++;
    const res = { ok: true, ch, feedback: '', wordDone: false, sessionDone: false, combo };
    if (pos >= expected.length) {
      doneWords++;
      if (mode === 'finaldrill' && drillSeq.length) {
        // SRS 命中按操练单元维度：双拼=韵母键、全拼=音节（plan groups）、注音=符号键（含声调键）
        if (drillUnit === 'syllable') {
          for (const g of (current().plan && current().plan.groups) || []) if (drillSeq.includes(g.syl)) store.srsTouch(scheme.id, g.syl, !wrongInWord);
        } else {
          const touched = [...new Set(planKeys.filter(k => k.role !== 'lead').map(k => k.key))];
          for (const u of touched) if (drillSeq.includes(u)) store.srsTouch(scheme.id, u, !wrongInWord);
        }
      }
      if (mode === 'sprint') { combo++; res.combo = combo; }
      if (settings.sound) sound.hit();
      idx++;
      res.wordDone = true;
      if (mode !== 'sprint' && idx >= queue.length) { res.sessionDone = true; res.result = finish(); }
      else advance();
    }
    return res;
  }
  wrongKeys++;
  combo = 0;
  wrongInWord = true;
  trackWrongWord();
  // plan 单元寻址（span 感知）：粤拼阳调双敲为单一连击单元，既有方案 span=1 行为不变
  const want = planUnitAt(planKeys, pos);
  const note = want && want.unit.note ? `（${want.unit.note}）` : '';
  // 错键惩罚开关（§设置）：开=整段清空回到词首，关=标红续打（默认）
  const cleared = !!settings.wrongPunish && pos > 0;
  if (cleared) pos = 0;
  const feedback = cleared
    ? `整段清空 · 从第 1 步 ${planKeys[0] ? planKeys[0].label : ''}重来`
    : (want ? `第 ${want.index + 1} 步应是 ${want.unit.label}${note}` : '');
  return { ok: false, ch, cleared, feedback, wordDone: false, sessionDone: false, combo: 0 };
}

function accLive() {
  const total = correctKeys + wrongKeys;
  return total ? Math.round((correctKeys / total) * 100) : 100;
}

// 冲刺倒计时：页面每秒调用，返回剩余秒；归零即结束并返回结算
function sprintLeft(now = Date.now()) {
  if (!startTime) return SPRINT_SECS;
  return Math.max(0, SPRINT_SECS - Math.floor((now - startTime) / 1000));
}
function timeUp() {
  if (mode !== 'sprint' || finished) return null;
  return finish();
}

// 自适应难度（ADR-0006）：会话边界自动调提示档
function adapt(acc) {
  const s = store.getSettings();
  const hintLevel = s.hintLevel || 'full';
  s.adaptHigh = acc >= 95 ? (s.adaptHigh || 0) + 1 : 0;
  const order = ['none', 'keys', 'full'];
  if (acc >= 95 && s.adaptHigh >= 2 && hintLevel !== 'none') {
    s.hintLevel = order[Math.max(0, order.indexOf(hintLevel) - 1)];
    s.adaptHigh = 0;
    toastFn('准确率持续 ≥95%，提示自动降一档');
  } else if (acc < 70 && hintLevel !== 'full') {
    s.hintLevel = order[Math.min(2, order.indexOf(hintLevel) + 1)];
    s.adaptHigh = 0;
    toastFn('准确率偏低，提示自动升一档');
  }
  store.setSettings(s);
}

function finish() {
  finished = true;
  store.flushKeys();
  const secs = Math.max(1, Math.round((Date.now() - startTime) / 1000));
  const total = correctKeys + wrongKeys;
  const acc = total ? Math.round((correctKeys / total) * 100) : 100;
  const kpm = Math.round((total / secs) * 60);
  store.addSession({ ts: Date.now(), mode, secs, acc, kpm, total, scheme: scheme.id, words: doneWords });
  adapt(acc);
  return { mode, secs, acc, kpm, total, words: doneWords, scheme: scheme.id };
}

// 页面渲染所需快照
function snapshot() {
  return {
    mode, idx, queueLength: queue.length, current: queue[idx] || null,
    pos, expected, planKeys, combo, doneWords,
    correctKeys, wrongKeys, acc: accLive(), startTime,
    sprintSecs: SPRINT_SECS, active: !!queue.length && idx < queue.length && !finished,
  };
}

module.exports = {
  SESSION_LEN, SPRINT_SECS,
  setScheme, setToast,
  startSession, startDrill, press, sprintLeft, timeUp, finish, snapshot, accLive,
  poolFor, prepareEntry,
  __resetForTest() {
    queue = []; idx = 0; expected = ''; planKeys = []; pos = 0; doneWords = 0;
    startTime = 0; correctKeys = 0; wrongKeys = 0; combo = 0; finished = false;
    mode = 'chars'; drillSeq = []; wrongWordsThisSession = new Set();
  },
};
