// 存储层（小程序版）：接口与 web 版 js/store.js 完全一致，持久层换成 wx.*StorageSync。
// 键名、信封 {v:1,data}、上限、SRS 间隔、迁移逻辑均不变（ADR-0002 / SPEC-0003 §3.6）。
const { mergeEntries, CJK } = require('./parsers.js');

const P = 'flypy.v1.';
const POOL_CAP = 20000;
const SESSION_CAP = 100;
const MISTAKE_CAP = 200;

function load(key, fallback) {
  try {
    const raw = wx.getStorageSync(P + key);
    if (!raw) return fallback;
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return obj && obj.v === 1 ? obj.data : fallback;
  } catch { return fallback; }
}
function save(key, data) {
  try { wx.setStorageSync(P + key, JSON.stringify({ v: 1, data })); return true; }
  catch { return false; }
}

let keyBuf = {}; // {schemeId: {物理键: [命中, 错按]}}
function flushKeys() {
  if (!Object.keys(keyBuf).length) return;
  for (const [sid, buf] of Object.entries(keyBuf)) {
    const m = load(`keystats.${sid}`, {});
    for (const [k, [hit, err]] of Object.entries(buf)) {
      const c = m[k] || [0, 0];
      c[0] += hit; c[1] += err;
      m[k] = c;
    }
    save(`keystats.${sid}`, m);
  }
  keyBuf = {};
}

// Leitner 三盒：盒 1 每天 / 盒 2 每 3 天 / 盒 3 每 7 天（ADR-0006）
const SRS_INTERVAL = { 1: 1, 2: 3, 3: 7 };
const DAY = 86400000;

const store = {
  getSettings: () => load('settings', { hintLevel: 'full', showPy: true, showCode: true, hlKeys: true, sound: false, scheme: 'flypy', keyboardMode: 'vkb' }),
  setSettings: (s) => save('settings', s),

  getLibs: () => load('libs', []),
  getPool() {
    const libs = load('libs', []);
    if (!libs.length) return [];
    const { entries } = mergeEntries(libs.map(l => l.entries));
    return entries.sort((a, b) => b.weight - a.weight).slice(0, POOL_CAP);
  },
  addLib(name, entries) {
    const libs = load('libs', []);
    libs.push({ name, addedAt: Date.now(), entries });
    if (!save('libs', libs)) { libs.pop(); return { ok: false, kept: this.getPool().length }; }
    return { ok: true, kept: this.getPool().length };
  },
  removeLib(name) { save('libs', load('libs', []).filter(l => l.name !== name)); },
  clearPool() { save('libs', []); },

  getSessions: () => load('sessions', []),
  addSession(rec) {
    const s = load('sessions', []);
    s.push(rec);
    save('sessions', s.slice(-SESSION_CAP));
    const d = new Date(rec.ts).toDateString();
    const days = load('days', {});
    const cur = days[d] || { keys: 0, errs: 0, sessions: 0 };
    cur.keys += rec.total; cur.sessions += 1;
    cur.errs += Math.round(rec.total * (1 - rec.acc / 100));
    days[d] = cur;
    save('days', days);
  },
  getDays: () => load('days', {}),
  markCourseSeen() {
    const d = new Date().toDateString();
    const days = load('days', {});
    days[d] = Object.assign({ keys: 0, errs: 0, sessions: 0 }, days[d], { course: 1 });
    save('days', days);
  },

  // ---- 键位统计（按方案隔离记账）----
  addKey(schemeId, k, ok) {
    const buf = (keyBuf[schemeId] ||= {});
    const c = buf[k] || [0, 0];
    c[0]++; if (!ok) c[1]++;
    buf[k] = c;
  },
  flushKeys,
  getKeyStats: (schemeId) => { flushKeys(); return load(`keystats.${schemeId}`, {}); },

  // ---- 错词本（按方案拆键；存 {word, py, errPos?, n, last}，不存码快照）----
  getMistakes: (schemeId) => load(`mistakes.${schemeId}`, []),
  addMistake(schemeId, entry) {
    const m = load(`mistakes.${schemeId}`, []);
    const hit = m.find(x => x.word === entry.word);
    if (hit) { hit.n++; hit.last = Date.now(); if (entry.errPos >= 0) hit.errPos = entry.errPos; }
    else {
      m.push({ ...entry, n: 1, last: Date.now() });
      m.sort((a, b) => b.last - a.last);
      if (m.length > MISTAKE_CAP) m.length = MISTAKE_CAP;
    }
    save(`mistakes.${schemeId}`, m);
  },
  clearMistakes: (schemeId) => save(`mistakes.${schemeId}`, []),

  // ---- 课程进度（per-scheme）----
  getCourse: (schemeId) => load(`course.${schemeId}`, { stage: 0 }),
  setCourse: (schemeId, c) => save(`course.${schemeId}`, c),

  // ---- SRS（单元随方案：双拼=韵母键；全拼=音节；形码后续票）----
  getSRS: (schemeId) => load(`srs.${schemeId}`, {}),
  srsTouch(schemeId, key, ok) {
    const m = load(`srs.${schemeId}`, {});
    const cur = m[key] || { box: 1, due: 0 };
    cur.box = ok ? Math.min(3, cur.box + 1) : 1;
    cur.due = Date.now() + SRS_INTERVAL[cur.box] * DAY;
    m[key] = cur;
    save(`srs.${schemeId}`, m);
  },
  srsDueKeys(schemeId) {
    const m = load(`srs.${schemeId}`, {});
    const now = Date.now();
    return Object.entries(m).filter(([, v]) => v.due <= now).map(([k]) => k);
  },

  // ---- 七日挑战 ----
  getChallenge: () => load('challenge', null),
  startChallenge: () => save('challenge', { start: Date.now() }),

  getSubs: () => load('subs', []),
  setSubs: (s) => save('subs', s),

  resetAll() {
    flushKeys();
    const keys = wx.getStorageInfoSync().keys;
    for (const k of keys) if (k.startsWith(P)) wx.removeStorageSync(k);
  },

  // 数据备份（§D3）：统一 JSON 打包全部信封；导入校验 v:1 后整键回写
  exportBackup() {
    flushKeys();
    const data = {};
    for (const k of wx.getStorageInfoSync().keys) {
      if (!k.startsWith(P)) continue;
      const raw = wx.getStorageSync(k);
      const env = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (env && env.v === 1) data[k.slice(P.length)] = env;
    }
    return { v: 1, app: 'helian', exportedAt: Date.now(), data };
  },

  applyBackup(bk) {
    if (!bk || bk.v !== 1 || !bk.data || typeof bk.data !== 'object') return { ok: false };
    let n = 0;
    for (const [k, env] of Object.entries(bk.data)) {
      if (!env || env.v !== 1 || !/^[A-Za-z0-9._-]+$/.test(k)) continue;
      wx.setStorageSync(P + k, JSON.stringify(env));
      n++;
    }
    keyBuf = {};
    return { ok: true, count: n };
  },
};

// ---- v3 一次性幂等迁移（§3.6 / T2-D10）：与 web 版同逻辑 ----
// 返回 'data'=迁移了存量数据；'fresh'=无存量仅打标；null=已迁移过。
function migrate() {
  if (load('migrated', null)) return null;
  let hadData = false;

  const sessions = load('sessions', null);
  if (sessions && sessions.length) {
    for (const s of sessions) if (s && !s.scheme) s.scheme = 'flypy';
    save('sessions', sessions);
    hadData = true;
  }

  const mk = load('mistakes', null);
  if (mk && mk.length) {
    const cur = load('mistakes.flypy', []);
    const seen = new Set(cur.map(x => x.word));
    for (const m of mk) {
      if (!m || !m.word || seen.has(m.word)) continue;
      cur.push({ word: m.word, py: m.py || '', n: m.n || 1, last: m.last || Date.now() });
      seen.add(m.word);
    }
    save('mistakes.flypy', cur);
    hadData = true;
  }

  const ks = load('keystats', null);
  if (ks && Object.keys(ks).length) {
    save('keystats.flypy', Object.assign({}, load('keystats.flypy', {}), ks));
    hadData = true;
  }

  const srs = load('srs', null);
  if (srs && Object.keys(srs).length) {
    save('srs.flypy', Object.assign({}, load('srs.flypy', {}), srs));
    hadData = true;
  }

  const course = load('course', null);
  if (course && typeof course === 'object') {
    save('course.flypy', course);
    hadData = true;
  }

  const libs = load('libs', null);
  if (libs && libs.length) {
    for (const lib of libs) {
      lib.entries = (lib.entries || []).filter(e => e && CJK.test(e.word || '')).map(e => {
        const out = { word: e.word, py: e.py || '', weight: e.weight || 1 };
        if (!out.py && e.code) { out.srcCode = String(e.code).toLowerCase(); out.srcScheme = 'flypy'; }
        return out;
      });
    }
    save('libs', libs);
    hadData = true;
  }

  save('migrated', { at: Date.now(), to: 'v3' });
  return hadData ? 'data' : 'fresh';
}

module.exports = { POOL_CAP, SESSION_CAP, MISTAKE_CAP, store, migrate };
