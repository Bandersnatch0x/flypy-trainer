// data pack 装载（小程序版）：包随主包分发，懒 require 即就绪，无网络/无 SW 通道。
// 对外接口与 web 版 js/packs.js 对齐：PACKS / packState / loadPack / bindPack / lookupChars，
// packCached / prefetchPacks 保留签名（随包即缓存，恒就绪）。
// `_` 前缀键为内嵌出处/许可元数据，装载即跳过。

const PACKS = {
  wubi86:   { path: '../data/packs/wubi86.v1.json',       name: '五笔 86 字码表',  kb: 82 },
  cangjie5: { path: '../data/packs/cangjie5.v1.json',     name: '仓颉单字码表',    kb: 269 },
  zhuyin:   { path: '../data/packs/zhuyin-tones.v1.json', name: '注音带调数据',    kb: 33 },
  jyutping: { path: '../data/packs/jyutping-tones.v1.json', name: '粤拼带调数据',  kb: 34 },
};

const mem = new Map();   // id → 表（就绪后内存常驻）
const state = new Map(); // id → 'idle'|'loading'|'ready'|'error'

const packState = (id) => state.get(id) || 'idle';

async function loadPack(id) {
  const pack = PACKS[id];
  if (!pack) throw new Error(`未知数据包: ${id}`);
  if (mem.has(id)) return mem.get(id);
  state.set(id, 'loading');
  try {
    const raw = require(pack.path);
    const table = {};
    for (const k of Object.keys(raw)) if (!k.startsWith('_')) table[k] = raw[k];
    mem.set(id, table);
    state.set(id, 'ready');
    return table;
  } catch (err) {
    state.set(id, 'error');
    throw err;
  }
}

// 方案接口接载：把 pack 装载挂进 activate()，表落在 scheme.table（§3.1/§3.5）
function bindPack(scheme, packId) {
  scheme.packId = packId;
  scheme.activate = () => loadPack(packId).then((table) => { scheme.table = table; return table; });
  return scheme;
}

// 形码查表：逐字查、缺一即 null（多字词取题过滤在方案 codeOf 层，§3.4）
function lookupChars(table, word) {
  if (!table || !word) return null;
  let code = '';
  for (const ch of word) {
    const c = table[ch];
    if (!c) return null;
    code += c;
  }
  return code || null;
}

// 随包分发即已缓存，恒就绪（签名对齐，方案库「已缓存 ✓」直接用）
async function packCached(id) {
  return !!PACKS[id];
}

async function prefetchPacks(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  try {
    for (const id of list) if (PACKS[id]) await loadPack(id);
    return { ok: true, urls: [] };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// 测试用：清空装载状态
function __resetForTest() {
  mem.clear();
  state.clear();
}

module.exports = { PACKS, packState, loadPack, bindPack, lookupChars, packCached, prefetchPacks, __resetForTest };
