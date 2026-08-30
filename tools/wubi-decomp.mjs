#!/usr/bin/env node
// tools/wubi-decomp.mjs — 五笔 86 课程拆解推导管线（SPEC-0004 §5.2–5.4/§5.6，issue #13 轨道 A）
//
// 三段式（node 零依赖、幂等；build-packs.mjs 先例，T2 原型 .scratch/wubi-decomp/wubi_exp*.py 移植）：
//   draft  机器草稿 → tools/.cache/wubi-decomp/drafts.json（gitignored，**永不直接发货**）
//   check  R1–R5 校验 + 审校清单 → docs/research/v4-wubi-m1-review.md（人工按清单消项）
//   build  合并 annotations.json 中 src:'human' 定稿 → data/packs/wubi86-course.v1.json
//
// 用法：
//   node tools/wubi-decomp.mjs draft [--all] [--refresh]
//   node tools/wubi-decomp.mjs check [--all]
//   node tools/wubi-decomp.mjs build
//   （--all = 课程池 500 字全量；缺省 = 首批 100 字分层抽样；--refresh = 强制重下上游缓存）
//
// 流程硬规（SPEC-0004 §5.2/§5.6）：
//   a) 出货只含 src:'human' 定稿条目；草稿层入 gitignored tools/.cache，永不发货。
//   b) 自建标注不得转抄 hantang/search-wubi（无 license、无授权链；仅作离线评测参照，不入本管线）。
//   c) R1 全码真值双源 = 源 dict（rime/rime-wubi，LGPL，构建期缓于 tools/.cache）
//      + 跨表参照（KyleBing/rime-wubi86-jidian，Apache-2.0，构建期参照不分发）。
//      **不得以包内最短码当全码基准**（包内是「一字取最短码」口径，一级简码不是全码前缀：
//      实测 我=q 而全码 trnt、这=p 而全码 ypi）。包内短码仅验证「在源 dict 有合法条目」。
//   d) 输出包 _meta 标两层口径与出处（码权威=包内码表；拆解=自写教学口径）。
//
// 校验规则（SPEC-0004 §5.3）：
//   R1 码一致性：根键序列拼接 == 全码（双源真值；简码字另验包内短码在源 dict 有条目）
//   R2 取码数与识别码自洽：≥4 根取 1/2/3/末；2–3 根加识别码（区=末笔类、位=结构码，辶/廴/囗 取内）
//   R3 特型封闭：键名字=键×4；单笔画=键+键+ll；成字字根=键+首笔+次笔+末笔（全自动标注）
//   R4 跨表分歧：与第二码表不一致字入 _meta.disputes，每字人工裁定 + note 留痕
//   R5 字根一致性：标注根形必须在字根字典该键（机查）；一键多根取哪个根形不可机验 → 目检清单

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'tools', '.cache');
const WUBI_CACHE = path.join(CACHE_DIR, 'wubi-decomp');
const OUT_PACK = path.join(ROOT, 'data', 'packs', 'wubi86-course.v1.json');
const ANNOT_FILE = path.join(ROOT, 'tools', 'wubi-course', 'annotations.json');
const ROOTS_FILE = path.join(ROOT, 'tools', 'wubi-course', 'roots.json');
const REVIEW_FILE = path.join(ROOT, 'docs', 'research', 'v4-wubi-m1-review.md');
const REFRESH = process.argv.includes('--refresh');
const ALL = process.argv.includes('--all');

fs.mkdirSync(WUBI_CACHE, { recursive: true });
fs.mkdirSync(path.dirname(REVIEW_FILE), { recursive: true });

// ---------- 常量 ----------
// 识别码：末笔类(1横2竖3撇4捺5折) × 结构码(1左右2上下3杂合) → 键（区位号 11–53 的 15 键）
const IDENT = {
  '11': 'g', '12': 'f', '13': 'd',
  '21': 'h', '22': 'j', '23': 'k',
  '31': 't', '32': 'r', '33': 'e',
  '41': 'y', '42': 'u', '43': 'i',
  '51': 'n', '52': 'b', '53': 'v',
};
const IDENT_INV = Object.fromEntries(Object.entries(IDENT).map(([ls, k]) => [k, { last: ls[0], struct: ls[1] }]));
const STROKEKEY = { 1: 'g', 2: 'h', 3: 't', 4: 'y', 5: 'n' };
// 末笔取内：辶/廴 底以内部末根为准；囗 框以框内末根为准（SPEC-0004 §5.3 R2）
const INNER_TAIL = new Set(['辶', '廴', '辵']);

// 首批 100 字分层抽样（SPEC-0004 §5.1 M1）：
//   K 25 键名字 / C 20 成字字根+单笔画（含 十 一类识别码教学字）
//   H 40 高频常规（2/3/4 根、识别码三结构、包围/辶 末笔取内）
//   D 15 分歧/特殊拆法（T2 抽样失败样例，note/disputes 压力测试）
const SAMPLE = {
  K: [...'王土大木工目日口田山禾白月人金言立水火之已子女又纟'],
  C: [...'一丨丿丶乙', ...'十上五也早手西四车力由用小刀心'],
  H: [...'明好字他认打从双林电家', ...'国因回同', ...'过进远道', ...'花华想意点语请清没学空', ...'感被做题影整谁满德机'],
  D: [...'我成或燕牛身未末节百出非这团风'],
};
const TIER_NAME = { K: '键名字', C: '成字字根/单笔画', H: '高频常规', D: '分歧/特殊拆法' };
const SAMPLE_CHARS = [...new Set([...SAMPLE.K, ...SAMPLE.C, ...SAMPLE.H, ...SAMPLE.D])];
const TIER_OF = {};
for (const [t, cs] of Object.entries(SAMPLE)) for (const c of cs) TIER_OF[c] ??= t;

// ---------- 上游取数（缓存优先，幂等；下载走 curl 遵从 HTTP_PROXY，无则回落 fetch） ----------
async function fetchUpstream(repo, file, cacheName) {
  const cached = path.join(CACHE_DIR, cacheName);
  if (!REFRESH && fs.existsSync(cached)) return fs.readFileSync(cached);
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
  const r = spawnSync('curl', ['-fsSL', '--retry', '2', url], { maxBuffer: 128 * 1024 * 1024 });
  if (r.status === 0 && r.stdout && r.stdout.length) return r.stdout;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Rime dict：头部至 `...` 行为止，其后正文行制表符分列，# 开头注释
function parseRimeDict(text) {
  const lines = text.split(/\r?\n/);
  let start = lines.findIndex(l => l.trim() === '...');
  if (start < 0) start = lines.findIndex(l => l.trim() === '---');
  if (start < 0) throw new Error('找不到正文起始标记（... 或 ---）');
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('#')) continue;
    rows.push(line.split('\t'));
  }
  return rows;
}

// ---------- 载入 ----------
function loadRoots() {
  const j = JSON.parse(fs.readFileSync(ROOTS_FILE, 'utf8'));
  return j;
}

function loadPack() {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'packs', 'wubi86.v1.json'), 'utf8'));
  delete j._meta;
  return j;
}

async function loadBuiltin() {
  const { BUILTIN } = await import(pathToFileURL(path.join(ROOT, 'js', 'data.js')).href);
  return [...new Set(BUILTIN.chars.map(e => e.w))];
}

// 码表索引：字 → 全部单字条目码（升序码长，同长按频次降序）；`copp` 为上游部件占位码，剔除
function codeIndex(rows) {
  const map = new Map();
  for (const cols of rows) {
    const [w, c, f] = cols;
    if (!w || !c || [...w].length !== 1) continue;
    const code = c.trim().toLowerCase();
    if (code === 'copp' || !/^[a-y]{1,4}$/.test(code)) continue;
    if (!map.has(w)) map.set(w, []);
    map.get(w).push({ code, freq: parseInt((f || '0').replace(/[^\d]/g, ''), 10) || 0 });
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.code.length - b.code.length || b.freq - a.freq);
  }
  return map;
}
// 全码 = 最长条目（同长取频次高者）；键名/单笔画/成字字根天然 ≤4 码，长码即全码
const fullOf = (list) => {
  if (!list || !list.length) return null;
  return list[list.length - 1].code;
};

// ---------- 字根字典派生 ----------
function buildDict(rootsJson) {
  const forms = rootsJson.roots;
  const keyNames = Object.fromEntries(Object.entries(rootsJson.keys).map(([k, v]) => [v.name, k]));
  const ROOTS = new Map();
  for (const [form, [key, strokes]] of Object.entries(forms)) ROOTS.set(form, { key, strokes });
  // 键名字闭集（25）、单笔画闭集（5）
  const SINGLE = { '一': 'g', '丨': 'h', '丿': 't', '丶': 'y', '乙': 'n' };
  // 成字字根 = 字典内带笔类序列且非键名非单笔画的形
  const isChengzi = (ch) => ROOTS.has(ch) && ROOTS.get(ch).strokes.length >= 2 && !(ch in keyNames) && !(ch in SINGLE);
  // 笔类串 → 同键根形候选（一键多根下的束搜索用）
  const classToRoots = new Map();
  for (const [form, { key, strokes }] of ROOTS) {
    if (strokes.length >= 2) {
      if (!classToRoots.has(strokes)) classToRoots.set(strokes, []);
      classToRoots.get(strokes).push(form);
    }
  }
  return { ROOTS, keyNames, SINGLE, isChengzi, classToRoots };
}

// 成字字根取码：键 + 首笔 (+次笔) + 末笔（SPEC-0004 §5.3 R3）
function chengziCode(ch, dict) {
  const { key, strokes } = dict.ROOTS.get(ch);
  if (strokes.length === 2) return key + STROKEKEY[strokes[0]] + STROKEKEY[strokes[1]];
  return key + STROKEKEY[strokes[0]] + STROKEKEY[strokes[1]] + STROKEKEY[strokes[strokes.length - 1]];
}

// ---------- chaizi 展开 + 贪心合并（T2 原型移植） ----------
function loadChaizi(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const p = line.split('\t');
    if (p.length >= 2) map.set(p[0], p.slice(1).map(v => v.split(' ')));
  }
  return map;
}

// chaizi 笔形碎片 → 笔类（补并归约；未知记 '?'）
const GLYPH2CLASS = {};
for (const g of '一㇀') GLYPH2CLASS[g] = '1';
for (const g of '丨亅') GLYPH2CLASS[g] = '2';
GLYPH2CLASS['丿'] = '3';
for (const g of '丶㇏') GLYPH2CLASS[g] = '4';
for (const g of '乛乚㇆𠃍㇇乙㇉𠃊㇈㇋𠃌𠃋㇄㇅') GLYPH2CLASS[g] = '5';

// 刀/刂 一类字形歧义束（同字两种根形假设；码表校核裁决，T2 输/型 先例）
const AMBIG = { '刀': ['刀', '刂'] };
// 旧形 → 今形归一（同键同笔类；教学展示取今形）
const DISPLAY_NORM = { '辵': '辶', '艸': '艹' };

// 自写拆解勘误（chaizi 部件拆法与五笔教学拆法不一致处，按全码校核择教学口径；
// 键位归属是编码标准公有事实，本表自写、非转抄无授权源）：
//   青=龴+月（请清情晴…）、首=丷+丿+目（道）、京=亠+小（景影就…，兼顾直观）、
//   束=一+口+小（整速辣…，兼顾直观）
const DECOMP_OVERRIDE = {
  '青': ['龴', '月'],
  '首': ['丷', '丿', '目'],
  '京': ['亠', '小'],
  '束': ['一', '口', '小'],
};

function expandVariants(part, chaizi, ROOTS, depth = 0) {
  if (ROOTS.has(part) || depth > 4) return [[part]];
  if (DECOMP_OVERRIDE[part]) return [DECOMP_OVERRIDE[part]]; // 教学口径勘误优先于 chaizi
  if (!chaizi.has(part)) return [[part]];
  const outs = [];
  for (const variant of chaizi.get(part).slice(0, 3)) {
    let combos = [[]];
    for (const sub of variant) {
      const subOpts = expandVariants(sub, chaizi, ROOTS, depth + 1);
      const nxt = [];
      for (const base of combos) {
        for (const opt of subOpts.slice(0, 2)) nxt.push([...base, ...opt]);
        if (nxt.length > 6) break;
      }
      combos = nxt.slice(0, 6);
    }
    outs.push(...combos);
  }
  return outs.slice(0, 6);
}

function mergePieces(pieces, dict) {
  const { ROOTS, classToRoots } = dict;
  const beams = [{ roots: [], unk: 0, i: 0 }];
  const n = pieces.length;
  const done = [];
  while (beams.length) {
    const cur = beams.shift();
    if (cur.i >= n) { done.push(cur); continue; }
    let matched = false;
    for (let j = Math.min(n, cur.i + 5); j > cur.i; j--) {
      const cand = pieces.slice(cur.i, j).join('');
      let opts = j === cur.i + 1 ? (AMBIG[cand] || [cand]) : [cand];
      let found = opts.filter(o => ROOTS.has(o));
      if (!found.length) {
        // 笔画类串重合并（如 一+丿→𠂇、丿+一+丨→⺧ 一类碎片归并）
        const cs = [...cand].map(g => GLYPH2CLASS[g] || '?').join('');
        if (!cs.includes('?') && cs.length >= 2) {
          const hits = classToRoots.get(cs) || [];
          const byKey = new Map();
          for (const h of hits) byKey.set(ROOTS.get(h).key, h);
          found = [...byKey.values()].slice(0, 2);
        }
      }
      if (found.length) {
        for (const o of found) beams.push({ roots: [...cur.roots, DISPLAY_NORM[o] || o], unk: cur.unk, i: j });
        matched = true;
        break;
      }
    }
    if (!matched) beams.push({ roots: [...cur.roots, '?' + pieces[cur.i]], unk: cur.unk + 1, i: cur.i + 1 });
    // 束宽护栏：按未识别数/根数排序截断，保确定性
    if (beams.length > 64) {
      beams.sort((a, b) => a.unk - b.unk || a.roots.length - b.roots.length || a.roots.join('').localeCompare(b.roots.join('')));
      beams.length = 64;
    }
  }
  done.sort((a, b) => a.unk - b.unk || a.roots.length - b.roots.length || a.roots.join('').localeCompare(b.roots.join('')));
  return done;
}

// 末笔类：辶/廴 底取内、囗 框取内（SPEC-0004 §5.3 R2）
function lastStrokeOf(roots, dict) {
  const clean = roots.filter(r => !r.startsWith('?'));
  if (!clean.length) return null;
  if (INNER_TAIL.has(clean[clean.length - 1]) && clean.length >= 2) {
    return lastOfRoot(clean[clean.length - 2], dict);
  }
  if (clean[0] === '囗' && clean.length >= 2) return lastOfRoot(clean[clean.length - 1], dict);
  return lastOfRoot(clean[clean.length - 1], dict);
}
const lastOfRoot = (form, dict) => {
  const r = dict.ROOTS.get(form);
  return r && r.strokes ? r.strokes[r.strokes.length - 1] : null;
};
const keyOfRoot = (form, dict) => dict.ROOTS.get(form)?.key || null;

// ---------- 全码真值（双源） ----------
function buildTruth(srcIdx, crossIdx) {
  const truth = new Map();
  for (const [ch, list] of srcIdx) {
    truth.set(ch, { src: list.map(e => e.code), full: fullOf(list) });
  }
  for (const [ch, list] of crossIdx) {
    const t = truth.get(ch);
    const crossFull = fullOf(list);
    if (t) { t.cross = list.map(e => e.code); t.crossFull = crossFull; }
    else truth.set(ch, { src: [], full: null, cross: list.map(e => e.code), crossFull });
  }
  return truth;
}

// ---------- 推导（draft 引擎） ----------
function derive(char, dict, chaizi, truth) {
  const t = truth.get(char);
  const full = t?.full || null;
  const notes = [];

  // R3 特型封闭：三类全自动
  if (char in dict.keyNames) {
    const k = dict.keyNames[char];
    return { kind: '键名', roots: [char], keys: k.repeat(4), notes: ['特型：键名字 = 键×4（自动）'] };
  }
  if (char in dict.SINGLE) {
    const k = dict.SINGLE[char];
    return { kind: '单笔画', roots: [char], keys: k + k + 'll', notes: ['特型：单笔画 = 键+键+ll（自动）'] };
  }
  if (dict.isChengzi(char)) {
    const c = chengziCode(char, dict);
    return { kind: '成字字根', roots: [char], keys: c, notes: ['特型：成字字根 = 键+首笔(+次笔)+末笔（自动）'] };
  }

  // 常规字：chaizi 展开 → 贪心合并 → 全码校核（自写勘误表优先于 chaizi 拆法）
  const variants = DECOMP_OVERRIDE[char] ? [DECOMP_OVERRIDE[char]] : (chaizi.get(char) || []).slice(0, 4);
  if (!variants.length) {
    return { failed: true, roots: [], keys: full, notes: [`chaizi 无条目（需人工建拆）`] };
  }
  const hyps = [];
  for (const variant of variants) {
    let combos = [[]];
    for (const sub of variant) {
      const opts = expandVariants(sub, chaizi, dict.ROOTS);
      const nxt = [];
      for (const base of combos) for (const o of opts.slice(0, 3)) nxt.push([...base, ...o]);
      combos = nxt.slice(0, 8);
    }
    for (const pieces of combos.slice(0, 8)) {
      for (const { roots, unk } of mergePieces(pieces, dict)) {
        const clean = roots.filter(r => !r.startsWith('?'));
        if (clean.length < 2) continue;
        hyps.push({ roots, clean, unk });
      }
    }
  }
  if (!hyps.length) return { failed: true, roots: [], keys: full, notes: ['chaizi 展开失败（需人工建拆）'] };

  // 去重（按根序列）
  const seen = new Set();
  const uniq = hyps.filter(h => {
    const k = h.clean.join(' ');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 书写序归一：部件清单顺序 ≠ 书写顺序（如 这=辵文，走之列前而书写最后）
  // 辶/廴 底移尾；≤3 根仍不中时穷举排列兜底（标注「书写序修正」供人工目检）
  const reorderRoots = (roots) => {
    const tail = roots.filter(r => INNER_TAIL.has(r));
    return tail.length ? [...roots.filter(r => !INNER_TAIL.has(r)), ...tail] : roots;
  };
  const permsOf = (arr) => {
    if (arr.length <= 1) return [arr];
    const out = [];
    arr.forEach((x, i) => permsOf([...arr.slice(0, i), ...arr.slice(i + 1)]).forEach(p => out.push([x, ...p])));
    return out;
  };

  // 全码校核：≥4 根取 1/2/3/末；2–3 根 = 根键 + 识别码。识别码键反解 (末笔类, 结构)。
  const tryKeys = (c) => {
    if (c.length >= 4) {
      const keys = keyOfRoot(c[0], dict) + keyOfRoot(c[1], dict) + keyOfRoot(c[2], dict) + keyOfRoot(c[c.length - 1], dict);
      return (full && keys === full) ? { roots: c, keys, id: null } : null;
    }
    const base = c.map(r => keyOfRoot(r, dict)).join('');
    if (!full || !full.startsWith(base)) return null;
    const idKey = full.slice(base.length);
    if (idKey.length !== 1 || !(idKey in IDENT_INV)) return null;
    const { last, struct } = IDENT_INV[idKey];
    return { roots: c, keys: full, id: { last, struct, key: idKey } };
  };
  const hits = [];
  for (const h of uniq) {
    const orders = [h.clean, reorderRoots(h.clean)];
    if (h.clean.length <= 3) orders.push(...permsOf(h.clean));
    const seenOrd = new Set();
    for (const c of orders) {
      const k = c.join(' ');
      if (seenOrd.has(k)) continue;
      seenOrd.add(k);
      const hit = tryKeys(c);
      if (hit) {
        if (c !== h.clean && c.join('') !== h.clean.join('')) {
          notes.push(`${char} 书写序修正：${h.clean.join('+')} → ${c.join('+')}`);
        }
        hits.push(hit);
      }
    }
  }

  if (!hits.length) {
    // 推导与全码不符：保留最优草稿供人工参照，标失败
    const best = uniq[0];
    return {
      failed: true, roots: best.clean, keys: full,
      notes: [`推导与全码不符（取大/直观/连交原则分歧或特殊拆法，需人工定拆）；未识别碎片 ${best.unk}`],
    };
  }
  // 多个根序列都命中全码 = 歧义（一键多根/取根序），首选根数少（取大优先），余入 note
  const seenHit = new Set();
  const uHits = hits.filter(h => {
    const k = h.roots.join(' ');
    if (seenHit.has(k)) return false;
    seenHit.add(k);
    return true;
  });
  uHits.sort((a, b) => a.roots.length - b.roots.length || a.roots.join('').localeCompare(b.roots.join('')));
  const pick = uHits[0];
  if (uHits.length > 1) notes.push(`多解命中全码（${uHits.length}），人工目检择一：` + uHits.map(h => h.roots.join('+')).join(' ｜ '));
  // 末笔类自洽校验（识别码区 = 标注末笔类）
  if (pick.id) {
    const ls = lastStrokeOf(pick.roots, dict);
    if (ls && ls !== pick.id.last) notes.push(`识别码区(${pick.id.last}) ≠ 根序列末笔类(${ls})，人工复核末笔/结构`);
  }
  return { roots: pick.roots, keys: pick.keys, id: pick.id || null, notes: [...new Set(notes)] };
}

// ---------- draft 阶段 ----------
async function cmdDraft() {
  const rootsJson = loadRoots();
  const dict = buildDict(rootsJson);
  const pack = loadPack();
  const pool = await loadBuiltin();
  const scope = ALL ? [...new Set([...pool, ...SAMPLE_CHARS])] : SAMPLE_CHARS;

  const srcBuf = await fetchUpstream('rime/rime-wubi', 'wubi86.dict.yaml', 'wubi86.dict.yaml');
  const crossBuf = await fetchUpstream('KyleBing/rime-wubi86-jidian', 'wubi86_jidian.dict.yaml', 'wubi86_jidian.dict.yaml');
  const chaiziBuf = await fetchUpstream('kfcd/chaizi', 'chaizi-jt.txt', 'chaizi-jt.txt');
  const srcIdx = codeIndex(parseRimeDict(srcBuf.toString('utf8')));
  const crossIdx = codeIndex(parseRimeDict(crossBuf.toString('utf8')));
  const chaizi = loadChaizi(chaiziBuf.toString('utf8'));
  const truth = buildTruth(srcIdx, crossIdx);

  const chars = {};
  let ok = 0, failed = 0;
  for (const ch of scope) {
    const d = derive(ch, dict, chaizi, truth);
    const entry = {
      roots: d.roots || [],
      keys: d.keys || '',
      src: 'draft',
    };
    if (d.kind) entry.kind = d.kind;
    if (d.id) entry.id = d.id;
    if (d.notes && d.notes.length) entry.note = d.notes.join('；');
    if (d.failed) { entry.failed = true; failed++; } else ok++;
    chars[ch] = entry;
  }

  const drafts = {
    _meta: {
      generator: 'tools/wubi-decomp.mjs draft',
      spec: 'SPEC-0004 §5.2–5.4',
      scope: ALL ? '课程池 500 字 ∪ 首批抽样' : '首批 100 字分层抽样',
      tiers: SAMPLE,
      upstreamSha256: {
        srcDict: sha256(srcBuf), crossTable: sha256(crossBuf), chaizi: sha256(chaiziBuf),
      },
      counts: { total: scope.length, derived: ok, failed },
      discipline: '草稿永不发货；出货只含 annotations.json 中 src:"human" 定稿。禁转抄 search-wubi。',
    },
    chars,
  };
  fs.writeFileSync(path.join(WUBI_CACHE, 'drafts.json'), JSON.stringify(drafts, null, 1));
  console.log(`[draft] ${scope.length} 字：推导成功 ${ok}，失败/需人工 ${failed} → tools/.cache/wubi-decomp/drafts.json（gitignored）`);
}

// ---------- check 阶段（R1–R5 + 审校清单） ----------
function ruleCheck(ch, entry, dict, truth, pack, annotations) {
  const errs = [];
  const t = truth.get(ch);
  const roots = entry.roots || [];
  const keys = entry.keys || '';
  const clean = roots.filter(r => !r.startsWith('?'));

  // R1 码一致性：根键序列拼接 == 全码（源 dict 真值，非包内最短码）
  if (!t || !t.full) errs.push('R1: 源 dict 无全码真值');
  else if (keys !== t.full) errs.push(`R1: keys=${keys || '∅'} ≠ 全码 ${t.full}`);
  if (t && t.full && pack[ch] && pack[ch] !== t.full && !(t.src || []).includes(pack[ch])) {
    errs.push(`R1: 包内短码 ${pack[ch]} 不在源 dict 条目`);
  }

  // R2 取码数与识别码自洽
  if (clean.length >= 4) {
    const want = keyOfRoot(clean[0], dict) + keyOfRoot(clean[1], dict) + keyOfRoot(clean[2], dict) + keyOfRoot(clean[clean.length - 1], dict);
    if (keys !== want) errs.push(`R2: ≥4根应取 1/2/3/末=${want}，实得 ${keys}`);
    if (entry.id) errs.push('R2: ≥4根不应有识别码');
  } else if (clean.length === 2 || clean.length === 3) {
    const base = clean.map(r => keyOfRoot(r, dict)).join('');
    if (!entry.id) errs.push('R2: 2–3根缺识别码');
    else {
      if (!IDENT[entry.id.last + entry.id.struct]) errs.push('R2: 识别码区位非法');
      else if (IDENT[entry.id.last + entry.id.struct] !== entry.id.key) errs.push('R2: 识别码键与区位不符');
      if (keys !== base + entry.id.key) errs.push(`R2: keys 应为 ${base}+${entry.id.key}`);
      const ls = lastStrokeOf(clean, dict);
      if (ls && ls !== entry.id.last) errs.push(`R2: 识别码区(${entry.id.last}) ≠ 根末笔类(${ls})（辶/廴/囗 取内）`);
    }
  }

  // R3 特型封闭
  let expected = null, expKeys = null;
  if (ch in dict.keyNames) { expected = '键名'; expKeys = dict.keyNames[ch].repeat(4); }
  else if (ch in dict.SINGLE) { expected = '单笔画'; expKeys = dict.SINGLE[ch] + dict.SINGLE[ch] + 'll'; }
  else if (dict.isChengzi(ch)) { expected = '成字字根'; expKeys = chengziCode(ch, dict); }
  if (expected) {
    if (entry.kind !== expected) errs.push(`R3: 特型应为「${expected}」，标注 ${entry.kind || '∅'}`);
    if (expKeys && keys !== expKeys) errs.push(`R3: 特型码应为 ${expKeys}，实得 ${keys}`);
  } else if (entry.kind) {
    errs.push(`R3: 非特型字却标「${entry.kind}」`);
  }

  // R4 跨表分歧：需人工裁定留痕（disputes）
  let dispute = null;
  if (t && t.crossFull && t.full && t.crossFull !== t.full) {
    dispute = { full: t.full, crossFull: t.crossFull };
    const settled = annotations.disputes && annotations.disputes[ch];
    if (!settled) errs.push(`R4: 跨表分歧 ${t.full} vs ${t.crossFull}，待人工裁定`);
  }

  // R5 字根一致性：根形必须在字典且键位相符
  for (const r of clean) {
    if (!dict.ROOTS.has(r)) errs.push(`R5: 根形「${r}」不在字根字典`);
  }
  const wantKeys = clean.map(r => keyOfRoot(r, dict)).join('');
  if (clean.length >= 4) {
    const want4 = keyOfRoot(clean[0], dict) + keyOfRoot(clean[1], dict) + keyOfRoot(clean[2], dict) + keyOfRoot(clean[clean.length - 1], dict);
    if (keys !== want4) errs.push(`R5: 根键序列(1/2/3/末) ${want4} 与 keys ${keys} 不符`);
  } else if (clean.length >= 2 && !keys.startsWith(wantKeys)) {
    errs.push(`R5: 根键基 ${wantKeys} 与 keys ${keys} 不符`);
  }

  return { errs, dispute };
}

async function cmdCheck() {
  const rootsJson = loadRoots();
  const dict = buildDict(rootsJson);
  const pack = loadPack();
  const pool = await loadBuiltin();
  const scope = ALL ? [...new Set([...pool, ...SAMPLE_CHARS])] : SAMPLE_CHARS;

  const srcBuf = await fetchUpstream('rime/rime-wubi', 'wubi86.dict.yaml', 'wubi86.dict.yaml');
  const crossBuf = await fetchUpstream('KyleBing/rime-wubi86-jidian', 'wubi86_jidian.dict.yaml', 'wubi86_jidian.dict.yaml');
  const srcIdx = codeIndex(parseRimeDict(srcBuf.toString('utf8')));
  const crossIdx = codeIndex(parseRimeDict(crossBuf.toString('utf8')));
  const truth = buildTruth(srcIdx, crossIdx);

  const annotations = JSON.parse(fs.readFileSync(ANNOT_FILE, 'utf8'));
  const draftsFile = path.join(WUBI_CACHE, 'drafts.json');
  const drafts = fs.existsSync(draftsFile) ? JSON.parse(fs.readFileSync(draftsFile, 'utf8')) : { chars: {} };

  const rows = [];
  let green = 0, disputed = 0;
  for (const ch of scope) {
    const human = annotations.chars?.[ch];
    const draft = drafts.chars?.[ch];
    const entry = human || draft;
    const tier = TIER_OF[ch] || (pool.includes(ch) ? '池' : '外');
    const t = truth.get(ch);
    if (!entry) {
      rows.push({ ch, tier, status: '未覆盖', detail: '无草稿无定稿', human: !!human });
      continue;
    }
    const { errs, dispute } = ruleCheck(ch, entry, dict, truth, pack, annotations);
    const src = human ? 'human' : 'draft';
    if (dispute) disputed++;
    if (!errs.length) { green++; }
    rows.push({
      ch, tier, status: errs.length ? '未过' : '过', errs, dispute, src, human: !!human,
      entry, full: t?.full || '', packCode: pack[ch] || '', crossFull: t?.crossFull || '',
    });
  }

  // 审校清单（幂等覆写）
  const lines = [];
  const p = lines.push.bind(lines);
  p('# 五笔 86 课程拆解 · M1 首批审校清单');
  p('');
  p('> 由 `node tools/wubi-decomp.mjs check` 幂等生成（SPEC-0004 §5.1–5.3）。人工定稿=维护者环节：');
  p('> 逐字把草稿核对后写入 `tools/wubi-course/annotations.json`（`src:\'human\'`），分歧字写 `note`；');
  p('> 再跑 `check` 消项，全绿后 `build` 出货。**禁转抄 search-wubi（无 license）。**');
  p('');
  const counts = { 过: 0, 未过: 0, 未覆盖: 0 };
  for (const r of rows) counts[r.status]++;
  p(`范围：${scope.length} 字（键名 ${SAMPLE.K.length} / 成字字根·单笔画 ${SAMPLE.C.length} / 高频 ${SAMPLE.H.length} / 分歧 ${SAMPLE.D.length}${ALL ? '，另含课程池' : ''}）`);
  p(`校验：绿 ${counts['过']}，未过 ${counts['未过']}，未覆盖 ${counts['未覆盖']}；跨表分歧待裁 ${disputed}。`);
  p('');

  p('## 一、草稿推导失败字（需人工建拆：草稿仅有全码、根序列不可信）');
  p('');
  p('| 字 | 层 | 全码（双源真值） | 包内码 | 机器最优参照 | 失败原因 |');
  p('|---|---|---|---|---|---|');
  const failedDrafts = rows.filter(r => r.entry?.failed && r.src === 'draft');
  if (!failedDrafts.length) p('| （无） | | | | | |');
  for (const r of failedDrafts) {
    p(`| ${r.ch} | ${r.tier} | ${r.full} | ${r.packCode} | ${(r.entry.roots || []).join('+') || '∅'} | ${r.entry.note || ''} |`);
  }
  p('');

  p('## 二、校验未过项明细（R1–R5，按字聚合）');
  p('');
  p('| 字 | 层 | 源 | 全码 | 包内码 | 根序列 | keys | 未过项 |');
  p('|---|---|---|---|---|---|---|---|');
  for (const r of rows.filter(r => r.status === '未过')) {
    const roots = (r.entry.roots || []).join(' ');
    p(`| ${r.ch} | ${r.tier} | ${r.src} | ${r.full} | ${r.packCode} | ${roots} | ${r.entry.keys} | ${(r.errs || []).join('<br>')} |`);
  }
  p('');

  p('## 三、字集未覆盖字（无草稿亦无定稿）');
  p('');
  const unc = rows.filter(r => r.status === '未覆盖');
  p(unc.length ? unc.map(r => r.ch).join(' ') : '（无）');
  p('');

  p('## 四、跨表分歧字（R4，人工裁定 + note 留痕，写入 _meta.disputes）');
  p('');
  p('| 字 | 源 dict 全码 | 跨表全码 | 裁定 |');
  p('|---|---|---|---|');
  const disp = rows.filter(r => r.dispute);
  if (!disp.length) p('| （无） | | | |');
  for (const r of disp) p(`| ${r.ch} | ${r.dispute.full} | ${r.dispute.crossFull} | ${annotations.disputes?.[r.ch] || '待裁'} |`);
  p('');

  p('## 五、草稿与标注 diff（定稿 ≠ 草稿处，供复核）');
  p('');
  let diffs = 0;
  for (const ch of scope) {
    const human = annotations.chars?.[ch];
    const draft = drafts.chars?.[ch];
    if (human && draft && JSON.stringify(human) !== JSON.stringify(draft)) {
      p(`- ${ch}：定稿 ${JSON.stringify(human)} ← 草稿 ${JSON.stringify(draft)}`);
      diffs++;
    }
  }
  if (!diffs) p('（无：尚无 src:\'human\' 定稿，或定稿与草稿一致）');
  p('');

  p('## 六、R5 根形目检清单（一键多根「取哪个根形」不可机验，人工全量过目）');
  p('');
  for (const r of rows) {
    if (!r.entry || !(r.entry.roots || []).length || r.entry.failed) continue;
    p(`- [ ] ${r.ch}：${(r.entry.roots).join(' + ')}（键序 ${r.entry.keys}${r.entry.note ? '；' + r.entry.note : ''}）`);
  }
  p('');

  p('## 七、特型清单（R3 自动，人工只验「确属此型」）');
  p('');
  for (const kind of ['键名', '单笔画', '成字字根']) {
    const ks = rows.filter(r => r.entry?.kind === kind).map(r => r.ch);
    p(`- ${kind}（${ks.length}）：${ks.join(' ') || '（无）'}`);
  }
  p('');

  p('---');
  p('');
  p('### 全码真值口径（R1）');
  p('- 源 dict：rime/rime-wubi `wubi86.dict.yaml`（LGPL-3.0，构建期缓存，不随包分发）。');
  p('- 跨表参照：KyleBing/rime-wubi86-jidian `wubi86_jidian.dict.yaml`（Apache-2.0，构建期参照不分发）。');
  p('- **不以包内最短码为全码基准**（包内=「一字取最短码」；一级简码非全码前缀）。包内短码仅验「源 dict 有合法条目」。');
  p('- 拆解口径=自写教学口径（取大优先/兼顾直观/能连不交）；禁转抄 hantang/search-wubi（无 license）。');
  p('');
  fs.writeFileSync(REVIEW_FILE, lines.join('\n'));

  console.log(`[check] ${scope.length} 字：绿 ${counts['过']}，未过 ${counts['未过']}，未覆盖 ${counts['未覆盖']}，跨表分歧 ${disputed}`);
  console.log(`[check] 审校清单 → ${path.relative(ROOT, REVIEW_FILE)}`);
}

// ---------- build 阶段 ----------
async function cmdBuild() {
  const rootsJson = loadRoots();
  const dict = buildDict(rootsJson);
  const pack = loadPack();
  const srcBuf = await fetchUpstream('rime/rime-wubi', 'wubi86.dict.yaml', 'wubi86.dict.yaml');
  const crossBuf = await fetchUpstream('KyleBing/rime-wubi86-jidian', 'wubi86_jidian.dict.yaml', 'wubi86_jidian.dict.yaml');
  const srcIdx = codeIndex(parseRimeDict(srcBuf.toString('utf8')));
  const crossIdx = codeIndex(parseRimeDict(crossBuf.toString('utf8')));
  const truth = buildTruth(srcIdx, crossIdx);

  const annotations = JSON.parse(fs.readFileSync(ANNOT_FILE, 'utf8'));
  const human = Object.entries(annotations.chars || {}).filter(([, e]) => e.src === 'human');
  if (!human.length) {
    console.log('[build] 无 src:\'human\' 定稿条目 — 拒绝出货（草稿永不发货）。先由维护者按审校清单定稿，再跑 build。');
    return;
  }

  // 出货前硬校验：定稿必须 R1–R5 全绿
  const bad = [];
  for (const [ch, e] of human) {
    const { errs } = ruleCheck(ch, e, dict, truth, pack, annotations);
    if (errs.length) bad.push([ch, errs]);
  }
  if (bad.length) {
    for (const [ch, errs] of bad) console.error(`[build] 定稿未过 ${ch}: ${errs.join('；')}`);
    throw new Error(`定稿校验未清零（${bad.length} 字），拒绝出货`);
  }

  const chars = {};
  for (const [ch, e] of human) {
    const item = { roots: e.roots, keys: e.keys, src: 'human' };
    if (e.kind) item.kind = e.kind;
    if (e.id) item.id = e.id;
    if (e.note) item.note = e.note;
    chars[ch] = item;
  }
  const disputes = {};
  for (const ch of Object.keys(chars)) {
    const t = truth.get(ch);
    if (t?.crossFull && t.full && t.crossFull !== t.full) {
      disputes[ch] = { full: t.full, crossFull: t.crossFull, note: annotations.disputes?.[ch] || '' };
    }
  }

  const out = {
    _meta: {
      id: 'wubi86-course', v: 1, name: '五笔 86 · 课程拆解教学数据',
      caliber: {
        code: '码权威 = 包内极点码表（rime/rime-wubi，LGPL-3.0，wubi86.v1.json）：一切 keys 与练习出码一致，不引入第二真值，教学与练习永不分叉。',
        decomp: '拆解 = 本站自写教学口径，遵循「取大优先 / 兼顾直观 / 能连不交」公开原则；键位归属是编码标准公有事实（自写表先例 ADR-0005）。拆字学派无单一开源权威，分歧字逐字裁定见 disputes。',
      },
      attribution: '拆解标注自写（自有版权）；构建期候选参照 kfcd/chaizi（CC BY 3.0）、跨表码参照 KyleBing/rime-wubi86-jidian（Apache-2.0）——二者仅构建期使用，不随包分发其原数据。',
      redline: '禁转抄唯一富拆解源 hantang/search-wubi（无 license、无授权链）：不可内置、不可转抄，其私用区字根字形不入仓不分发；若未来引用其展示思路，须自绘。',
      upstream: {
        srcDict: 'rime/rime-wubi — wubi86.dict.yaml', srcSha256: sha256(srcBuf),
        crossTable: 'KyleBing/rime-wubi86-jidian — wubi86_jidian.dict.yaml', crossSha256: sha256(crossBuf),
      },
      disputes,
      rootNames: rootsJson.names,
      entries: Object.keys(chars).length,
    },
    ...chars,
  };
  fs.writeFileSync(OUT_PACK, JSON.stringify(out));
  const size = fs.statSync(OUT_PACK).size;
  console.log(`[build] ${Object.keys(chars).length} 字定稿 → data/packs/wubi86-course.v1.json（${(size / 1024).toFixed(1)} KB raw；分歧裁定 ${Object.keys(disputes).length}）`);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------- 入口 ----------
const cmd = process.argv[2];
if (cmd === 'draft') await cmdDraft();
else if (cmd === 'check') await cmdCheck();
else if (cmd === 'build') await cmdBuild();
else {
  console.log('用法: node tools/wubi-decomp.mjs <draft|check|build> [--all] [--refresh]');
  process.exit(1);
}
