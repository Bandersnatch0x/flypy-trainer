#!/usr/bin/env node
// tools/build-packs.mjs — v3 data pack 构建管线（SPEC-0003 §3.5，issue #2）
//
// 构建期联网拉取上游 Rime 字典（开发者侧允许；运行时零外链红线不变），
// 抽取版本化紧凑 {字: 码} JSON 到 data/packs/：
//   - wubi86.v1.json      rime/rime-wubi wubi86.dict.yaml，截 GB2312 6,763 常用字
//   - cangjie5.v1.json    rime/rime-cangjie cangjie5.base.dict.yaml，base 全量单字
//   - zhuyin-tones.v1.json rime/rime-terra-pinyin terra_pinyin.dict.yaml，
//                         截取字集 = 内置池 js/data.js 的字词（课程字集定稿 #3/#4 后允许 .v2 重抽）
//   - jyutping-tones.v1.json CanCLID/rime-cantonese jyut6ping3.chars/words.dict.yaml（CC-BY-4.0），
//                         构建期简繁桥后以简体为键（SPEC-0004 §2，issue #10）：
//                         映射小表 tools/jyutping/s2t.json（自写），一对多择主流字形留审核清单
//                         （buildJyutping 产出 tools/jyutping/bridge-review.md）
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

// ---------- 4) jyutping-tones.v1.json：CanCLID 带调字表 + 构建期简繁桥（包以简体为键，SPEC-0004 §2）----
// 桥（§2.2）：内置池为简体、上游纯繁体——构建期把池字经自建映射小表折到繁体查音，
// 包直接以简体为键，运行时零映射逻辑。恒等字（简体形即表内字）直查；映射表只收需折转字。
const JP_ONE_TO_MANY = {
  // 简→繁一对多的主流字形择定（池内词境）；审核清单见 tools/jyutping/bridge-review.md
  发: ['發', '取「發」（发展/发布义）；「髮」义池内无词境'],
  钟: ['鐘', '取「鐘」（时钟/分钟义）；姓氏「鍾」池内无词境'],
  历: ['歷', '取「歷」（经历/历史义）；「曆」（历书）池内无词境'],
  汇: ['匯', '取「匯」（汇聚/汇款义）；「彙」（汇总旧形）池内无词境'],
  签: ['簽', '取「簽」（签约/标签义）；「籤」（竹签）池内无词境'],
  广: ['廣', '取「廣」（广州/广告义）；「广」（jim2，山崖罕字）与简体形撞车，必须折转'],
  干: ['幹', '取「幹」（干活/干部义，池内词境皆 gàn）；「乾」（干燥）与天干「干」池内无词境'],
  么: ['麼', '取「麼」（什么/怎么义）；「么」（maa1，幺的异体）与简体形撞车，必须折转'],
  惊: ['驚', '取「驚」（geng1，惊惧义）；表内简体形「惊」仅存异读，必须折转'],
};

// 多音字择读（§2.2 风险③）：上游权重列为输入法候选权重、非通用频次，权重序择主流在
// 少数字上失准（或与罕字/异体读音撞车）——此表按池内词境人工择定带调音节
// （值必在表内，构建期断言；惊=驚经字形映射折转，吃取表内最优 gat1 不再另择）。
const JP_READ_PICK = {
  只: 'zi2',   // 「只」义（只是/只有）；误取 zek3（隻的异体）
  合: 'hap6',  // 合作/合法；误取 ho4
  面: 'min6',  // 面孔/面包；误取 min2
  着: 'zoek6', // 随着/意味着；误取 zoek3（衣着）
  了: 'liu5',  // 助词了/了解；误取 liu1
  行: 'hang4', // 进行/行动主流读；行业/银行经词表整词命中（hong4）
  什: 'sam6',  // 什么（什麼 sam6 mo1）；误取 sap6（什錦）
  么: 'mo1',   // 什么/怎么的「麼」；误取 maa1（幺的异体读）
  会: 'wui6',  // 会议/不会；误取 wui5
  中: 'zung1', // 中国/中间（阴平）；误取 zung3（中奖义）
  还: 'waan4', // 还是/还有；误取 syun4（书面异读）
  她: 'taa1',  // 她/他义；误取 ji1（伊的异体）
  日: 'jat6',  // 日子；误取 mik6
  应: 'jing1', // 应该/应当（阴平）；误取 jing3（应声义）
  内: 'noi6',  // 内外/内容；误取 naap6（入内异读）
  许: 'heoi2', // 许多/允许；误取 fu2
  红: 'hung4', // 红色；误取 gung1（红同工的异读）
  失: 'sat1',  // 失去；误取 jat6
  息: 'sik1',  // 信息/休息；误取 sak1
  突: 'dat6',  // 突然；误取 duk1
  石: 'sek6',  // 石头；误取 daam3（石担异读）
  弟: 'dai6',  // 兄弟；误取 tai5
  切: 'cit3',  // 一切/切实；误取 cai3（切合义异读）
  结: 'git3',  // 结果/结合；误取 lit3
  令: 'ling6', // 命令/令到；误取 lim1
  喜: 'hei2',  // 喜欢；误取 ci3
  可: 'ho2',   // 可以；误取 hak1
  谁: 'seoi4', // 谁的；误取 seoi2
  告: 'gou3',  // 告诉/报告；误取 guk1
  度: 'dou6',  // 程度/度量；误取 dok6
  单: 'daan1', // 简单/单独；误取 sim4（单于义）
  数: 'sou3',  // 数字/数据（去声）；误取 sou2
  提: 'tai4',  // 提供/提高；误取 si4（提防义）
  发: 'faat3', // 发展/出发（经桥取發）；误取 but3
  而: 'ji4',   // 而且；误取 nang4
};

function parseJpChars(text) {
  const reads = new Map(); // 繁体字 → [{t: 带调音节, w: 权重}]（原文序保留，权重降序择主流）
  for (const cols of parseRimeDict(text)) {
    const [ch, pyRaw, wRaw] = cols;
    if (!ch || !pyRaw || [...ch].length !== 1) continue;
    const toned = pyRaw.trim().toLowerCase();
    if (!/^[a-z]+[1-6]$/.test(toned)) continue;
    if (!reads.has(ch)) reads.set(ch, []);
    reads.get(ch).push({ t: toned, w: parseFloat((wRaw || '').replace('%', '')) || 0 });
  }
  for (const rs of reads.values()) rs.sort((a, b) => b.w - a.w);
  return reads;
}

function parseJpWords(text) {
  const words = new Map(); // 繁体词 → {toned, w}
  for (const cols of parseRimeDict(text)) {
    const [word, pyRaw, wRaw] = cols;
    if (!word || !pyRaw) continue;
    const toned = pyRaw.trim().toLowerCase();
    const syls = toned.split(/\s+/);
    if ([...word].length !== syls.length || !syls.every(s => /^[a-z]+[1-6]$/.test(s))) continue;
    const w = parseFloat((wRaw || '').replace('%', '')) || 0;
    const prev = words.get(word);
    if (!prev || w > prev.w) words.set(word, { toned, w });
  }
  return words;
}

function buildJyutping(charText, wordText, builtin, s2t) {
  const reads = parseJpChars(charText);
  const words = parseJpWords(wordText);
  const tradOf = (ch) => s2t[ch] || ch;
  // 择读：多音字按池内词境人工择定（JP_READ_PICK）；余取权重序主流读（构建期已断言 pick 在表）
  const pickRead = (ch) => {
    const rs = reads.get(tradOf(ch));
    if (!rs || !rs.length) return null;
    const pick = JP_READ_PICK[ch];
    return (pick && rs.find(r => r.t === pick)?.t) || rs[0].t;
  };
  const table = {};
  const missing = [];       // 桥后仍无读音的字（codeOf null 过滤，§2.2 风险②）
  const relaxedWords = [];  // 词表未收、按逐字择读拼接的词（词级变调未覆盖，在案）
  const seen = new Set();
  const items = [...builtin.chars, ...builtin.words2, ...builtin.words34];
  for (const { w } of items) {
    if (seen.has(w)) continue;
    seen.add(w);
    if ([...w].length === 1) {
      const t = pickRead(w);
      if (t) table[w] = t;
      else missing.push(w);
      continue;
    }
    // 词：首选上游词表整词命中（词级声调含变调事实）；次选逐字择读拼接
    const tradWord = [...w].map(tradOf).join('');
    const direct = words.get(tradWord);
    if (direct) { table[w] = direct.toned; continue; }
    const syls = [];
    let ok = true;
    for (const ch of w) {
      const t = pickRead(ch);
      if (!t) { ok = false; break; }
      syls.push(t);
    }
    if (ok) { table[w] = syls.join(' '); relaxedWords.push(w); }
    else missing.push(w);
  }
  return { table, missing, relaxedWords, charCount: reads.size };
}

function writeBridgeReview({ mapped, identity, mappedWordChars, poolUniq, missing, relaxedWords }) {
  // 审核清单（§2.2 风险①：一对多择主流并留单）：构建期幂等产出，tracked 供人工逐条过目
  const s2t = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'jyutping', 's2t.json'), 'utf8'));
  const entries = Object.entries(s2t).filter(([k]) => !k.startsWith('_')).sort((a, b) => a[0].localeCompare(b[0], 'zh'));
  const lines = [
    '# 简繁桥审核清单（jyutping-tones 构建期产出，幂等）',
    '',
    `字集口径：内置池 js/data.js 去重词 ${poolUniq}（单字 500 + 词 ${poolUniq - 500}）。`,
    `单字简繁桥：恒等直查 ${identity}，映射小表折转 ${mapped - mappedWordChars}；另有词用字 ${mappedWordChars} 条经映射折转。映射小表共 ${mapped} 条（自写，可逐条审）。`,
    `桥后无读音被过滤 ${missing.length} 字${missing.length ? '：' + missing.join('') : ''}。`,
    '',
    '## 一对多字的主流字形择定',
    '',
    ...Object.entries(JP_ONE_TO_MANY).map(([s, [t, why]]) => `- ${s} → ${t}：${why}`),
    '',
    '## 多音字择读（上游权重序失准字，按池内词境人工择定带调音节）',
    '',
    ...Object.entries(JP_READ_PICK).map(([s, t]) => `- ${s} → ${t}`),
    '',
    '## 全量映射（简体 → 繁体查音形）',
    '',
    ...entries.map(([s, t]) => `- ${s} → ${t}${JP_ONE_TO_MANY[s] ? '（一对多，见上）' : ''}`),
    '',
    '## 词级逐字拼接清单（上游词表未收，按各字主流读拼接；词级变调未覆盖）',
    '',
    `共 ${relaxedWords.length} 词：`,
    '',
    ...relaxedWords.map(w => `- ${w}`),
    '',
  ];
  fs.writeFileSync(path.join(ROOT, 'tools', 'jyutping', 'bridge-review.md'), lines.join('\n'));
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

// ---- jyutping-tones ----
const jpCharBuf = await fetchUpstream('rime/rime-cantonese', 'jyut6ping3.chars.dict.yaml', 'jyut6ping3.chars.dict.yaml');
const jpWordBuf = await fetchUpstream('rime/rime-cantonese', 'jyut6ping3.words.dict.yaml', 'jyut6ping3.words.dict.yaml');
const jpS2tFile = path.join(ROOT, 'tools', 'jyutping', 's2t.json');
const jpS2t = JSON.parse(fs.readFileSync(jpS2tFile, 'utf8'));
delete jpS2t._meta;
for (const [s, [t]] of Object.entries(JP_ONE_TO_MANY)) {
  if (jpS2t[s] !== t) throw new Error(`一对多裁定与映射表不一致：${s} → ${jpS2t[s]}（裁定 ${t}）`);
}
{
  // 多音字择读断言：pick 音节必须在该字桥后读音集合内（防失准静默失效）
  const reads = parseJpChars(jpCharBuf.toString('utf8'));
  for (const [s, t] of Object.entries(JP_READ_PICK)) {
    const rs = reads.get(jpS2t[s] || s);
    if (!rs || !rs.some(r => r.t === t)) throw new Error(`多音字择读不在表内：${s} → ${t}`);
  }
}
const jp = buildJyutping(jpCharBuf.toString('utf8'), jpWordBuf.toString('utf8'), BUILTIN, jpS2t);
const jpPoolUniq = new Set([...BUILTIN.chars, ...BUILTIN.words2, ...BUILTIN.words34].map(e => e.w));
const jpTableChars = Object.keys(jp.table).filter(k => [...k].length === 1);
const jpMapped = Object.keys(jpS2t).length;
const jpMappedWordChars = jpMapped - [...jpPoolUniq].filter(w => [...w].length === 1 && jpS2t[w]).length;
const jpIdentity = [...jpPoolUniq].filter(w => [...w].length === 1 && !jpS2t[w]).length;
writeBridgeReview({ mapped: jpMapped, identity: jpIdentity, mappedWordChars: jpMappedWordChars, poolUniq: jpPoolUniq.size, missing: jp.missing, relaxedWords: jp.relaxedWords });
console.log(`[info] jyutping-tones 覆盖 ${Object.keys(jp.table).length} 条（单字 ${jpTableChars.length}/500 池，词级逐字拼接 ${jp.relaxedWords.length}），桥 ${jpMapped} 映射（含词用字 ${jpMappedWordChars}）+${jpIdentity} 恒等，缺 ${jp.missing.length}${jp.missing.length ? '：' + jp.missing.join('') : ''}`);
write('jyutping-tones.v1.json', {
  _meta: {
    id: 'jyutping-tones', v: 1, name: '粤拼带调数据 · 内置池字词（简繁桥后以简体为键）',
    source: 'CanCLID/rime-cantonese — jyut6ping3.chars.dict.yaml（带调单字表）+ jyut6ping3.words.dict.yaml（词级声调参照）',
    upstream: 'https://github.com/rime/rime-cantonese',
    upstreamSha256: sha256(jpCharBuf),
    upstreamWordsSha256: sha256(jpWordBuf),
    license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'CanCLID 粤语计算语言学基础建设组（rime-cantonese）',
    notes: '字集 = 内置池 data.js 字词；构建期简繁桥（自写映射小表 tools/jyutping/s2t.json）后以简体为键，运行时零映射；多音字取权重最高主流读；词首选上游词表整词命中（含变调），未收词按逐字主流读拼接（清单见 tools/jyutping/bridge-review.md）；jyut6ping3.maps（ODbL）不采用；懒音/模糊音容错不启用，教学取正音',
    entries: Object.keys(jp.table).length,
    bridge: { mapped: jpMapped, identity: jpIdentity, missing: jp.missing },
  },
  ...jp.table,
});

console.log('[done] 四份 pack 生成完毕');
