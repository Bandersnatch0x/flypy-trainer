// 四种词库格式的行级解析器 + 自动嗅探。
// v3 词目规范形 {word, py, weight} + 可选 {srcCode, srcScheme}（SPEC-0003 §3.3）：
// code 绝不持久化，出题时由当前方案 codeOf 派生；py 是方案无关通货。
const { splitPinyin } = require('./flypy.js');

const CJK = /[\u4e00-\u9fff]/;

function weightOf(s) {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Rime 同步快照：`code word \x01 c=N d=N t=N`（code 为无分隔全拼）
function parseUserdb(text) {
  const entries = [], bad = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [head, meta] = line.split('\x01');
    if (!meta || !head) { bad.push(line); continue; }
    const parts = head.trim().split(/\s+/);
    if (parts.length < 2) { bad.push(line); continue; }
    const py = parts[0], word = parts.slice(1).join('');
    if (!CJK.test(word)) { bad.push(line); continue; }
    const m = meta.match(/c=(\d+)/);
    // 优先按全拼切分；切不出且码长=2×字数，则视为双拼方案导出的码（归入 srcCode，srcScheme 待小鹤直用）
    const syls = splitPinyin(py);
    if (syls && syls.length === word.length) {
      entries.push({ word, py: syls.join(' '), weight: m ? Number(m[1]) : 1 });
    } else if (/^[a-z]+$/.test(py) && py.length === 2 * word.length) {
      entries.push({ word, py: '', srcCode: py, srcScheme: 'flypy', weight: m ? Number(m[1]) : 1 });
    } else {
      entries.push({ word, py, weight: m ? Number(m[1]) : 1 });
    }
  }
  return { entries, bad, format: 'userdb.txt 同步快照' };
}

// Rime 字典：`---` 头 + `...` 之后 `词 拼音 权重`，拼音空格分音节
function parseDictYaml(text) {
  const entries = [], bad = [];
  let body = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!body) { if (t === '...') body = true; continue; }
    if (!t || t.startsWith('#')) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 2 || !CJK.test(parts[0])) { bad.push(line); continue; }
    const word = parts[0];
    const pyParts = [];
    for (let i = 1; i < parts.length && /^[a-zü]+$/i.test(parts[i]); i++) pyParts.push(parts[i]);
    if (!pyParts.length) { bad.push(line); continue; }
    const syls = pyParts;
    if (syls.length !== word.length || !syls.every(s => splitPinyin(s))) { bad.push(line); continue; }
    entries.push({ word, py: syls.join(' '), weight: parts[1 + pyParts.length] ? weightOf(parts[1 + pyParts.length]) : 1 });
  }
  return { entries, bad, format: 'dict.yaml 字典' };
}

// custom_phrase：`词 码 权重`，码为小鹤双拼码（无拼音 → 归 srcCode，准入靠 srcCode 通道）
function parseCustomPhrase(text) {
  const entries = [], bad = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    let m = t.match(/^([^=\s]+)=(.+)$/); // 兼容 `码=词` 形式
    if (m) {
      const code = m[1], word = m[2].split(/\s+/)[0];
      if (/^[a-z]+$/i.test(code) && CJK.test(word)) {
        entries.push({ word, py: '', srcCode: code.toLowerCase(), srcScheme: 'flypy', weight: 1 });
        continue;
      }
      bad.push(line); continue;
    }
    const parts = t.split(/\s+/);
    if (parts.length < 2 || !CJK.test(parts[0]) || !/^[a-z]+$/i.test(parts[1])) { bad.push(line); continue; }
    entries.push({ word: parts[0], py: '', srcCode: parts[1].toLowerCase(), srcScheme: 'flypy', weight: parts[2] ? weightOf(parts[2]) : 1 });
  }
  return { entries, bad, format: 'custom_phrase 短语' };
}

// 纯文本：`词 拼音 权重`（拼音可空格分音节或连写）
function parsePlain(text) {
  const entries = [], bad = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const parts = t.split(/\s+/);
    const word = parts[0];
    if (!CJK.test(word)) { bad.push(line); continue; }
    if (parts.length >= 2 && /^[a-zü]+$/i.test(parts[1])) {
      const pyParts = [];
      for (let i = 1; i < parts.length && /^[a-zü]+$/i.test(parts[i]); i++) pyParts.push(parts[i]);
      const joined = pyParts.join('');
      const syls = splitPinyin(joined);
      const wIdx = 1 + pyParts.length;
      entries.push({ word, py: syls ? syls.join(' ') : pyParts.join(' '), weight: parts[wIdx] ? weightOf(parts[wIdx]) : 1 });
    } else {
      bad.push(line); // 无拼音：音码方案无法派生码
    }
  }
  return { entries, bad, format: '纯文本词表' };
}

function sniffAndParse(filename, text) {
  const name = (filename || '').toLowerCase();
  if (text.includes('\x01')) return parseUserdb(text);
  if (name.endsWith('.yaml') || name.endsWith('.yml') || /^---\s*$/m.test(text.slice(0, 400))) return parseDictYaml(text);
  if (name.includes('custom_phrase') || /^\S+=\S+/m.test(text.slice(0, 400))) return parseCustomPhrase(text);
  return parsePlain(text);
}

// 按 word 聚合（权重求和）。不烘焙码（§3.3）：产出规范形 {word, py, weight}(+srcCode/srcScheme)。
// 准入：word 为 CJK 且（py 可切分 或 有 srcCode）；不满足者计入 dropped。
function mergeEntries(lists) {
  const map = new Map();
  let dropped = 0;
  for (const entries of lists) {
    for (const e of entries) {
      const word = e && e.word;
      if (!word || !CJK.test(word)) { dropped++; continue; }
      const rawPy = String(e.py || '').trim();
      const syls = rawPy ? splitPinyin(rawPy.replace(/\s+/g, '')) : null;
      const srcCode = e.srcCode || (!syls && e.code ? String(e.code).toLowerCase() : '');
      if (!syls && !srcCode) { dropped++; continue; }
      const hit = map.get(word);
      if (hit) { hit.weight += (e.weight || 1); continue; }
      const entry = { word, py: syls ? syls.join(' ') : '', weight: e.weight || 1 };
      if (!syls && srcCode) { entry.srcCode = srcCode; entry.srcScheme = e.srcScheme || 'flypy'; }
      map.set(word, entry);
    }
  }
  return { entries: [...map.values()], dropped };
}

// 加权随机抽题（不放回）：每轮重建前缀和 + 二分定位
function weightedSample(entries, n, rng = Math.random) {
  const pool = entries.slice();
  const out = [];
  while (pool.length && out.length < n) {
    const prefix = new Array(pool.length);
    let acc = 0;
    for (let i = 0; i < pool.length; i++) { acc += pool[i].weight; prefix[i] = acc; }
    const r = rng() * acc;
    let lo = 0, hi = prefix.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (prefix[mid] < r) lo = mid + 1; else hi = mid;
    }
    out.push(pool[lo]);
    pool.splice(lo, 1);
  }
  return out;
}

module.exports = { CJK, parseUserdb, parseDictYaml, parseCustomPhrase, parsePlain, sniffAndParse, mergeEntries, weightedSample };
