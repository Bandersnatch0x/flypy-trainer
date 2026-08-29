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

// 键统计缓冲：避免每键全量写
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

export const store = {
  getSettings: () => load('settings', { hintLevel: 'full', showPy: true, showCode: true, hlKeys: true, keyImpact: true }),
  setSettings: (s) => save('settings', s),

  // 按库存储，支持逐库删除；练习池 = 全部库合并
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
    if (!save('libs', libs)) {
      libs.pop();
      return { ok: false, kept: this.getPool().length };
    }
    return { ok: true, kept: this.getPool().length };
  },
  removeLib(name) {
    save('libs', load('libs', []).filter(l => l.name !== name));
  },
  clearPool() { save('libs', []); },

  getSessions: () => load('sessions', []),
  addSession(rec) {
    const s = load('sessions', []);
    s.push(rec);
    save('sessions', s.slice(-SESSION_CAP));
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

  resetAll() {
    flushKeys();
    for (const k of Object.keys(localStorage)) if (k.startsWith(P)) localStorage.removeItem(k);
  },
};
