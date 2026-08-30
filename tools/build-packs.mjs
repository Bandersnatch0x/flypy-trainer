#!/usr/bin/env node
// tools/build-packs.mjs — v3 data pack 构建管线（SPEC-0003 §3.5，issue #2）
//
// 构建期联网拉取上游 Rime 字典（开发者侧允许；运行时零外链红线不变），
// 抽取三份版本化紧凑 {字: 码} JSON 到 data/packs/：
//   - wubi86.v1.json      rime/rime-wubi wubi86.dict.yaml，截 GB2312 6,763 常用字
//   - cangjie5.v1.json    rime/rime-cangjie cangjie5.base.dict.yaml，base 全量单字
//   - zhuyin-tones.v1.json rime/rime-terra-pinyin terra_pinyin.dict.yaml，
//                         截取字集 = 内置池 js/data.js 的字词（课程字集定稿 #3/#4 后允许 .v2 重抽）
//
// 决策记录：
//   - 上游原始字典不入部署目录、不入版本控制：缓存于 tools/.cache/（.gitignore），
//     已缓存则复用，--refresh 强制重下；重跑输出字节级幂等（无时间戳，_meta 记上游 sha256）。
//   - JSON 无注释，出处与许可内嵌为 `_meta` 键（下划线开头键即元数据，装载器跳过）。
//   - 一方案一包不共享字表；速成/全拼/自然码无包（速成=仓颉首尾二码运行时派生）。
//   - 五笔截 GB2312：用 TextDecoder('gb2312') 枚举区位 16–87 网格得 6,763 字集合。
//   - 下载优先走 curl（遵从 HTTP_PROXY 环境；node fetch 忽略代理、本环境直连被拒），
//     无 curl 时回落 node fetch。
//   - 零运行时依赖：仅 node 内建（fetch/TextDecoder/crypto/fs）+ 系统 curl，合规零构建红线。
//
// 用法：node tools/build-packs.mjs [--refresh]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'tools', '.cache');
const OUT_DIR = path.join(ROOT, 'data', 'packs');
const REFRESH = process.argv.includes('--refresh');
const LGPL = 'LGPL-3.0';
const LGPL_URL = 'https://www.gnu.org/licenses/lgpl-3.0.html';

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------- 上游取数（缓存优先，幂等） ----------
async function fetchUpstream(repo, file, cacheName) {
  const cached = path.join(CACHE_DIR, cacheName);
  if (!REFRESH && fs.existsSync(cached)) {
    console.log(`[cache] ${cacheName} 已缓存，复用（--refresh 可强制重下）`);
    return fs.readFileSync(cached);
  }
  let lastErr = null;
  for (const branch of ['master', 'main']) {
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
    try {
      const buf = await download(url);
      fs.writeFileSync(cached, buf);
      console.log(`[fetch] ${url} → ${buf.length} bytes`);
      return buf;
    } catch (err) { lastErr = err; }
  }
  throw new Error(`上游拉取失败 ${repo}/${file}: ${lastErr}`);
}

async function download(url) {
  // curl 遵从 HTTP_PROXY 环境（本环境 node fetch 直连被拒）；无 curl 则回落 fetch
  const r = spawnSync('curl', ['-fsSL', '--retry', '2', url], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0 && r.stdout && r.stdout.length) return r.stdout;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Rime dict：头部字段至 `...` 行为止，其后为正文；正文行制表符分列，# 开头为注释
function parseRimeDict(text) {
  const lines = text.split(/\r?\n/);
  let start = lines.findIndex(l => l.trim() === '...');
  if (start < 0) start = lines.findIndex(l => l.trim() === '---'); // 兜底
  if (start < 0) throw new Error('找不到正文起始标记（... 或 ---）');
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('#')) continue;
    rows.push(line.split('\t'));
  }
  return rows;
}

const isCJK = (s) => /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);

// ---------- 1) wubi86.v1.json：GB2312 6,763 常用字 ----------
function gb2312Set() {
  const dec = new TextDecoder('gb2312');
  const set = new Set();
  for (let qu = 16; qu <= 87; qu++) {
    for (let wei = 1; wei <= 94; wei++) {
      const s = dec.decode(new Uint8Array([qu + 0xA0, wei + 0xA0]));
      if (s.length === 1 && /[\u4E00-\u9FFF]/.test(s)) set.add(s);
    }
  }
  return set;
}

function buildWubi(rows, gb) {
  // 一字数码（简码+全码并存，频列不可比：工=a 频 99M vs 工=aaa 频 551M）：
  // 取最短码（最省键的合法输入），同长取词频高者；码限 a–y 五笔键域、≤4 键
  const best = new Map();
  for (const cols of rows) {
    const [word, codeRaw, freqRaw] = cols;
    if (!word || !codeRaw) continue;
    if ([...word].length !== 1 || !gb.has(word)) continue;
    const code = codeRaw.trim().toLowerCase();
    if (!/^[a-y]{1,4}$/.test(code)) continue;
    const freq = parseInt(freqRaw || '0', 10) || 0;
    const prev = best.get(word);
    if (!prev || code.length < prev.code.length || (code.length === prev.code.length && freq > prev.freq)) {
      best.set(word, { code, freq });
    }
  }
  const table = {};
  for (const [ch, { code }] of best) table[ch] = code;
  return table;
}

// ---------- 2) cangjie5.v1.json：base 全量单字 ----------
// base 含同字二码（正码 + x 前缀「難字簡碼」），教学取正码；部首字形/标点非字不入包。
function buildCangjie(rows) {
  const codesOf = new Map();
  let skippedNonCJK = 0;
  for (const cols of rows) {
    const [word, codeRaw] = cols;
    if (!word || !codeRaw) continue;
    if ([...word].length !== 1 || !isCJK(word)) { skippedNonCJK++; continue; }
    const code = codeRaw.trim().toLowerCase();
    if (!/^[a-z]{1,5}$/.test(code)) continue;
    if (!codesOf.has(word)) codesOf.set(word, []);
    codesOf.get(word).push(code);
  }
  const table = {};
  for (const [ch, codes] of codesOf) {
    table[ch] = codes.find(c => !c.startsWith('x')) || codes[0];
  }
  return { table, skippedNonCJK };
}

// ---------- 3) zhuyin-tones.v1.json：terra 截取，字集 = 内置池字词 ----------
const stripTone = (s) => s.replace(/[1-5]$/, '');
// terra 与内置池同用 nv/lv 记法（实测无 ü 形），归一化留作钩子
const normPy = (s) => s;

function buildZhuyin(rows, builtin) {
  // terra 无简体 吗/们（仅收传统形 嗎/們）——同字异形的声调事实不变，桥接取音并记录在案
  const TRAD_BRIDGE = { 吗: '嗎', 们: '們' };
  const wordMap = new Map();      // 词 → {toned, weight}
  const charReads = new Map();    // 字 → [{t: 带调音节, w: 权重}]
  for (const cols of rows) {
    const [word, pyRaw, wRaw] = cols;
    if (!word || !pyRaw) continue;
    const toned = pyRaw.trim().toLowerCase();
    const syls = toned.split(/\s+/);
    if ([...word].length !== syls.length) continue;
    if (!syls.every(s => /^[a-züê]+[1-5]$/.test(s))) continue;
    const weight = parseFloat((wRaw || '').replace('%', '')) || 0;
    const prev = wordMap.get(word);
    if (!prev || weight > prev.weight) wordMap.set(word, { toned, weight });
    if ([...word].length === 1) {
      if (!charReads.has(word)) charReads.set(word, []);
      charReads.get(word).push({ t: toned, w: weight });
    }
  }
  // 同字按权重降序（多音字首选常用读）
  for (const reads of charReads.values()) reads.sort((a, b) => b.w - a.w);

  const table = {};
  const fallbacks = [], missing = [];
  const readsOf = (ch) => charReads.get(ch) || charReads.get(TRAD_BRIDGE[ch]) || [];
  const items = [...builtin.chars, ...builtin.words2, ...builtin.words34];
  for (const { w, p } of items) {
    if (w in table) continue;
    const poolSyls = p.split(/\s+/).map(normPy);
    // 首选：terra 整词命中（音节数与无声调形式须与内置池一致）
    const direct = wordMap.get(w);
    if (direct) {
      const syls = direct.toned.split(' ');
      if (syls.length === poolSyls.length && syls.every((s, i) => stripTone(s) === poolSyls[i])) {
        table[w] = direct.toned;
        continue;
      }
    }
    // 次选：逐字取读，按内置池无声调拼音选多音字读音（同形多读取权重最高者）
    let out = [], ok = true, relaxed = false;
    for (let i = 0; i < [...w].length; i++) {
      const reads = readsOf([...w][i]);
      if (!reads.length) { ok = false; break; }
      const want = poolSyls[i];
      const cands = reads.filter(r => stripTone(r.t) === want);
      if (cands.length) out.push(cands[0].t);
      else { out.push(reads[0].t); relaxed = true; }
    }
    if (ok) {
      table[w] = out.join(' ');
      if (relaxed) fallbacks.push(w);
    } else {
      missing.push(w);
    }
  }
  return { table, fallbacks, missing };
}

// ---------- 主流程 ----------
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const write = (name, obj) => {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, JSON.stringify(obj));
  const size = fs.statSync(file).size;
  console.log(`[out] data/packs/${name}  ${(size / 1024).toFixed(1)} KB`);
};

// ---- wubi86 ----
const wubiBuf = await fetchUpstream('rime/rime-wubi', 'wubi86.dict.yaml', 'wubi86.dict.yaml');
const gb = gb2312Set();
if (gb.size !== 6763) throw new Error(`GB2312 枚举异常：${gb.size} ≠ 6763`);
const wubiTable = buildWubi(parseRimeDict(wubiBuf.toString('utf8')), gb);
if (Object.keys(wubiTable).length !== 6763) throw new Error(`wubi86 截表异常：${Object.keys(wubiTable).length} ≠ 6763`);
write('wubi86.v1.json', {
  _meta: {
    id: 'wubi86', v: 1, name: '五笔 86 · GB2312 常用字',
    source: 'rime/rime-wubi — wubi86.dict.yaml（极点五笔码表源流：JidianWubi table，Wozy 制）',
    upstream: 'https://github.com/rime/rime-wubi',
    upstreamSha256: sha256(wubiBuf),
    license: LGPL, licenseUrl: LGPL_URL,
    notes: '截 GB2312 6,763 常用字；一字数码取词频最高者；站内以「五笔 86」通称，商标性名称避让',
    entries: 6763,
  },
  ...wubiTable,
});

// ---- cangjie5 ----
const cjBuf = await fetchUpstream('rime/rime-cangjie', 'cangjie5.base.dict.yaml', 'cangjie5.base.dict.yaml');
const { table: cjTable, skippedNonCJK } = buildCangjie(parseRimeDict(cjBuf.toString('utf8')));
console.log(`[info] cangjie5 base 单字 ${Object.keys(cjTable).length} 条（原文 23,947 行含正码+x 难码重出与部首字形，去重取正码、剔非字 ${skippedNonCJK} 条）`);
write('cangjie5.v1.json', {
  _meta: {
    id: 'cangjie5', v: 1, name: '仓颉五代 · base 全量单字',
    source: 'rime/rime-cangjie — cangjie5.base.dict.yaml（单字码表源自仓颉之友《五倉世紀》；dict 头部另标 GPL 双重声明，按仓库 LGPL 处理并原样保留头部声明）',
    upstream: 'https://github.com/rime/rime-cangjie',
    upstreamSha256: sha256(cjBuf),
    license: LGPL, licenseUrl: LGPL_URL,
    notes: '仓颉体系公有（朱邦复 1982 年弃权）；同字取正码、舍 x 前缀难字简码；部首字形/标点不入包；速成码 = 本表首尾二码运行时派生，不另出包',
    entries: Object.keys(cjTable).length,
  },
  ...cjTable,
});

// ---- zhuyin-tones ----
const terraBuf = await fetchUpstream('rime/rime-terra-pinyin', 'terra_pinyin.dict.yaml', 'terra_pinyin.dict.yaml');
const { BUILTIN } = await import('../js/data.js');
const { table: zyTable, fallbacks, missing } = buildZhuyin(parseRimeDict(terraBuf.toString('utf8')), BUILTIN);
console.log(`[info] zhuyin-tones 覆盖 ${Object.keys(zyTable).length} 词（内置池 ${new Set([...BUILTIN.chars, ...BUILTIN.words2, ...BUILTIN.words34].map(e => e.w)).size} 词），宽松选音 ${fallbacks.length}，缺字 ${missing.length}${missing.length ? '：' + missing.join('') : ''}`);
if (missing.length) console.warn(`[warn] 有缺字 — terra 未收录：${missing.join(' ')}`);
write('zhuyin-tones.v1.json', {
  _meta: {
    id: 'zhuyin-tones', v: 1, name: '注音带调数据 · 内置池字词截取',
    source: 'rime/rime-terra-pinyin — terra_pinyin.dict.yaml（terra 为大陆普通话审音，与台湾正音有零星差异）',
    upstream: 'https://github.com/rime/rime-terra-pinyin',
    upstreamSha256: sha256(terraBuf),
    license: LGPL, licenseUrl: LGPL_URL,
    notes: 'v1 字集 = 内置池 data.js 字词（声调 1–5，轻声=5）；课程字集定稿（#3/#4）后允许 .v2 重抽；多音字按池内无声调拼音+权重选读，宽松选音条目见 fallbacks；terra 未收简体 吗/们，桥接傳統形 嗎/們 取音',
    entries: Object.keys(zyTable).length,
    fallbacks,
  },
  ...zyTable,
});

console.log('[done] 三份 pack 生成完毕');
