// data pack 装载（SPEC-0003 §3.5，issue #2）：
// - 一方案一包不共享字表；首次激活懒加载（经方案接口 activate() 接载）
// - 内存缓存 + 在途去重 + 失败重试（3 次）；失败标 error「未就绪」，不阻塞其它方案，再激活即重试
// - 持久层唯一 = 版本化文件名 + SW cache-first；不进 localStorage/IndexedDB，大包不进 SHELL
// - `_` 前缀键为内嵌出处/许可元数据，装载即跳过
// - 预下载通道：SW message（#7 票接按钮）；开发/无 SW 环境回落直连 fetch

export const PACKS = {
  wubi86:   { url: '/data/packs/wubi86.v1.json',       name: '五笔 86 字码表',  kb: 82 },
  'wubi86-course': { url: '/data/packs/wubi86-course.v1.json', name: '五笔 86 课程拆解', kb: 62 },
  cangjie5: { url: '/data/packs/cangjie5.v1.json',     name: '仓颉单字码表',    kb: 269 },
  zhuyin:   { url: '/data/packs/zhuyin-tones.v1.json', name: '注音带调数据',    kb: 33 },
  jyutping: { url: '/data/packs/jyutping-tones.v1.json', name: '粤拼带调数据',  kb: 383 },
  stroke:   { url: '/data/packs/stroke.v1.json',       name: '五笔画笔顺码表',  kb: 132 },
};

const mem = new Map();      // id → 表（就绪后内存常驻）
const metas = new Map();    // id → _meta（课程包 rootNames 等，不进查表键）
const inflight = new Map(); // id → Promise（并发去重）
const state = new Map();    // id → 'idle'|'loading'|'ready'|'error'

export const packState = (id) => state.get(id) || 'idle';
export const packMeta = (id) => metas.get(id) || null;

export async function loadPack(id) {
  const pack = PACKS[id];
  if (!pack) throw new Error(`未知数据包: ${id}`);
  if (mem.has(id)) return mem.get(id);
  if (inflight.has(id)) return inflight.get(id);
  state.set(id, 'loading');
  const run = (async () => {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(pack.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const table = {};
        for (const k of Object.keys(raw)) if (!k.startsWith('_')) table[k] = raw[k];
        if (raw._meta) metas.set(id, raw._meta);
        mem.set(id, table);
        state.set(id, 'ready');
        return table;
      } catch (err) { lastErr = err; }
    }
    state.set(id, 'error');
    throw lastErr;
  })();
  inflight.set(id, run);
  try { return await run; } finally { inflight.delete(id); }
}

// 方案接口接载：把 pack 装载挂进 activate()，表落在 scheme.table（§3.1/§3.5）
export function bindPack(scheme, packId) {
  scheme.packId = packId;
  scheme.activate = () => loadPack(packId).then((table) => { scheme.table = table; return table; });
  return scheme;
}

// 形码查表：逐字查、缺一即 null（多字词取题过滤在方案 codeOf 层，§3.4）
export function lookupChars(table, word) {
  if (!table || !word) return null;
  let code = '';
  for (const ch of word) {
    const c = table[ch];
    if (!c) return null;
    code += c;
  }
  return code || null;
}

// SW 已在 cache-first 分支缓存过的 pack（方案库「已缓存 ✓」状态用，#7 票接显）
export async function packCached(id) {
  const pack = PACKS[id];
  if (!pack || typeof caches === 'undefined') return false;
  try { return !!(await caches.match(pack.url)); } catch { return false; }
}

// 预下载通道（#7 票接按钮）：向 SW 发 message 主动 cache.put；无 SW 时直连 fetch 兜底
export async function prefetchPacks(ids) {
  const urls = (Array.isArray(ids) ? ids : [ids]).map((id) => PACKS[id] && PACKS[id].url).filter(Boolean);
  if (!urls.length) return { ok: false, error: '无可下载的数据包' };
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null;
  if (sw && sw.controller) {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 30000);
      ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data || { ok: false, error: '无应答' }); };
      sw.controller.postMessage({ type: 'prefetch-pack', urls }, [ch.port2]);
    });
  }
  try {
    for (const url of urls) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    return { ok: true, urls };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// 测试用：清空装载状态
export function __resetForTest() {
  mem.clear();
  metas.clear();
  inflight.clear();
  state.clear();
}
