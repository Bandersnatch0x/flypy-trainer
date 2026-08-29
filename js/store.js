// localStorage 封装：所有键 `flypy.v1.*` 前缀，值带 v:1（ADR-0002）
import { mergeEntries } from './parsers.js';

const P = 'flypy.v1.';
export const POOL_CAP = 20000;
export const SESSION_CAP = 100;
export const MISTAKE_CAP = 200;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(P + key);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    return obj && obj.v === 1 ? obj.data : fallback;
  } catch { return fallback; }
}
function save(key, data) {
  try { localStorage.setItem(P + key, JSON.stringify({ v: 1, data })); return true; }
  catch { return false; }
}

let keyBuf = {};
function flushKeys() {
  if (!Object.keys(keyBuf).length) return;
  const m = load('keystats', {});
  for (const [k, [hit, err]] of Object.entries(keyBuf)) {
    const c = m[k] || [0, 0];
    c[0] += hit; c[1] += err;
    m[k] = c;
  }
  save('keystats', m);
  keyBuf = {};
}

// Leitner 三盒：盒 1 每天 / 盒 2 每 3 天 / 盒 3 每 7 天（ADR-0006）
const SRS_INTERVAL = { 1: 1, 2: 3, 3: 7 };
const DAY = 86400000;

export const store = {
  getSettings: () => load('settings', { hintLevel: 'full', showPy: true, showCode: true, hlKeys: true, sound: false, scheme: 'flypy' }),
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

  addKey(k, ok) {
    const c = keyBuf[k] || [0, 0];
    c[0]++; if (!ok) c[1]++;
    keyBuf[k] = c;
  },
  flushKeys,
  getKeyStats: () => { flushKeys(); return load('keystats', {}); },

  getMistakes: () => load('mistakes', []),
  addMistake(entry) {
    const m = load('mistakes', []);
    const hit = m.find(x => x.word === entry.word);
    if (hit) { hit.n++; hit.last = Date.now(); }
    else {
      m.push({ ...entry, n: 1, last: Date.now() });
      m.sort((a, b) => b.last - a.last);
      if (m.length > MISTAKE_CAP) m.length = MISTAKE_CAP;
    }
    save('mistakes', m);
  },
  clearMistakes: () => save('mistakes', []),

  getCourse: () => load('course', { stage: 0 }),
  setCourse: (c) => save('course', c),

  // ---- SRS（韵母键间隔重复）----
  getSRS: () => load('srs', {}),
  srsTouch(key, ok) {
    const m = load('srs', {});
    const cur = m[key] || { box: 1, due: 0 };
    cur.box = ok ? Math.min(3, cur.box + 1) : 1;
    cur.due = Date.now() + SRS_INTERVAL[cur.box] * DAY;
    m[key] = cur;
    save('srs', m);
  },
  srsDueKeys() {
    const m = load('srs', {});
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
    for (const k of Object.keys(localStorage)) if (k.startsWith(P)) localStorage.removeItem(k);
  },
};
