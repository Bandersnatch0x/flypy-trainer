import { BUILTIN } from './data.js';
import { getScheme, SCHEMES } from './schemes.js';
import { courseOf, confusKeys, confusEndsMatch, syllablesOf, challengeMatch } from './courses.js';
import { firstKeyOfWubi } from './wubi.js';
import { sniffAndParse, mergeEntries, weightedSample, parsePlain } from './parsers.js';
import { store, migrate } from './store.js';
import { PACKS as DATA_PACKS, packState } from './packs.js';
import { planUnitAt } from './jyutping.js';
import { sound } from './sound.js';
import { downloadShareCard } from './share.js';
import { renderSchemeLibrary, initSchemeChip, hiddenModesFor, schemeHelpOf } from './schemes-ui.js';

// v3 一次性幂等迁移：存量数据归 flypy 名下（§3.6），必须早于任何读取
const MIGRATED = migrate();

let scheme = getScheme(store.getSettings().scheme);

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const qsa = (sel) => /** @type {NodeListOf<any>} */ (document.querySelectorAll(sel));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
if (MIGRATED === 'data') toast('历史本地数据已归入小鹤双拼名下');

// ================= 路由 =================
const VIEWS = ['practice', 'course', 'import', 'stats', 'mistakes', 'settings', 'schemes'];
let lastView = '';
function route() {
  const v = (location.hash || '#/practice').replace('#/', '');
  const target = VIEWS.includes(v) ? v : 'practice';
  for (const name of VIEWS) $('view-' + name).classList.toggle('hidden', name !== target);
  qsa('.nav a').forEach(a => a.classList.toggle('on', a.dataset.view === target));
  if (target !== lastView) {
    // 视图入场：只入不退——升入淡入 160ms；旧视图 display:none 硬切（§5.6）
    const el = $('view-' + target);
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
  }
  lastView = target;
  if (target === 'stats') renderStats();
  if (target === 'mistakes') renderMistakes();
  if (target === 'course') renderCourse();
  if (target === 'import') renderImport();
  if (target === 'settings') loadSettingsUI();
  if (target === 'schemes') renderSchemeLibrary($('schemelib'), libEnv);
}
addEventListener('hashchange', route);

// ================= 键盘图（随方案 layout 重建）=================
let keyEls = {};

function buildKeyboard(container, { heat = false, map = false, onKey = null, preview = false } = {}, schemeArg) {
  container.innerHTML = '';
  const els = {};
  const sc = schemeArg || scheme;
  const { ROWS, extraKeys, keyLabel, specialOf } = sc.layout;
  const rows = [...ROWS];
  if (extraKeys.length) rows.push(extraKeys.join(''));
  container.classList.toggle('wide', rows.some(r => r.length > 10)); // 41 键大千：弹性键宽（T4-Q5）
  for (const row of rows) {
    const r = document.createElement('div');
    r.className = 'kbrow';
    for (const ch of row) {
      const lab = keyLabel(ch);
      const spec = specialOf(ch);
      const d = document.createElement('div');
      d.className = 'key' + (spec ? ' special' : '');
      d.dataset.key = ch;
      d.innerHTML = `<span class="sm">${esc(lab.main)}</span><span class="ym">${esc(lab.sub)}</span>`;
      // 练习/预览/认知图同源：有 keyLabel.title 即挂（五笔字根全列截断后 title 保全量）；
      // 音码无 title 时仅认知图走原声韵兜底，练习键盘不加空 title。
      d.title = lab.title || (map
        ? [spec ? `声母 ${spec}` : '', lab.sub ? `韵母 ${lab.sub}` : ''].filter(Boolean).join('｜') || `键 ${lab.main}`
        : '');
      els[ch] = d;
      r.appendChild(d);
    }
    container.appendChild(r);
  }
  if (heat) {
    container.classList.add('heat');
    for (const [ch, el] of Object.entries(els)) {
      el.onclick = () => gotoPractice('weak:' + ch);
      el.title += ' · 点击弱键特训';
    }
  } else if (!preview) {
    for (const [ch, el] of Object.entries(els)) {
      el.onclick = onKey ? () => onKey(ch) : () => { // 触屏/鼠标点按输入（onKey=认知图点键看说明）
        const inbox = $('inbox');
        inbox.value += ch;
        inbox.dispatchEvent(new Event('input'));
      };
    }
  }
  return els;
}
keyEls = buildKeyboard($('kb'));

// 数据包激活状态流（§5.5 三态 2）：正在准备资料包 → 就绪「开练」/ 失败「点按重试」
// 就绪判定按「本方案表已挂载」：速成与仓颉共用 cangjie5 包，pack 就绪不等于每个方案都已接载
async function ensurePack(s) {
  const needsCode = s.packId && !s.table;
  const needsCourse = s.coursePackId && !s.courseReady;
  if (!needsCode && !needsCourse) return true;
  const packId = needsCourse ? s.coursePackId : s.packId;
  const p = DATA_PACKS[packId];
  if (packState(packId) !== 'ready') toast(`正在准备${p.name}（~${p.kb}KB）…`);
  try {
    await s.activate(); // pack 已在内存时即时返回（内存缓存命中，零下载）
    toast(`${s.name}就绪，开练`);
    return true;
  } catch {
    toast(`${p.name}未就绪 —— 稍后可点按重试`);
    return false;
  }
}

async function applyScheme(id) {
  const next = getScheme(id);
  const same = next.id === scheme.id;
  if (same && !(next.packId && packState(next.packId) !== 'ready')
    && !(next.coursePackId && !next.courseReady)) { updateChip(); return true; } // 同方案且所有数据已接载
  scheme = next;
  rebuildKb();
  const s = store.getSettings();
  s.scheme = scheme.id;
  store.setSettings(s);
  stageIdx = store.getCourse(scheme.id).stage || 0;
  buildConfusButtons(); // 易混对按范式课程数据重建
  applyModeBar(); // 形码隐藏二字词/多字词/整句（§5.4）
  renderHelpBlock(); // 科普 details 块按当前方案数据驱动（§5.1）
  if (!$('view-course').classList.contains('hidden')) renderCourse();
  document.title = `鹤练 · ${scheme.name}练习`;
  $('inbox').setAttribute('aria-label', `输入${scheme.name}编码`);
  updateChip();
  // 练习中切换：立即重算 queue 重新出题（根治旧码残留，§5.4）
  if (!same) toast(queue.length && idx < queue.length ? `已切换：${scheme.name} · 本轮重新出题` : `已切换：${scheme.name}`);
  const ok = await ensurePack(scheme);
  if (!ok) return false;
  if (!$('view-course').classList.contains('hidden')) renderCourse();
  // 变化面：形码下被隐藏的模式回落单字（§5.4）
  if (!same && hiddenModesFor(scheme).includes(mode)) { mode = 'chars'; setModeButton(mode); }
  startSession(mode === 'finaldrill' ? 'chars' : mode); // 一律按新方案重新出题/刷新空态
  return true;
}

// 键盘重建：有 View Transitions 则渐进增强，否则回落级联入场（§5.6 可选增强）
function rebuildKb() {
  const build = () => { keyEls = buildKeyboard($('kb')); };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce) {
    const t = document.startViewTransition(build);
    t.ready.then(() => updateHighlight(pos)).catch(() => {});
  } else build();
}

function clearKeys(els = keyEls) {
  for (const k of Object.values(els)) {
    k.classList.remove('smhi', 'ymhi');
    delete k.dataset.n;
  }
}

// ================= 练习引擎（plan = 扁平键序，按下标寻址）=================
const SESSION_LEN = 20;
const SPRINT_SECS = 60;
let queue = [], idx = 0, planKeys = [], expected = '', pos = 0, doneWords = 0;
let startTime = 0, timer = null, correctKeys = 0, wrongKeys = 0;
let mode = 'chars', drillKey = '', drillSeq = [], drillUnit = 'ymKey', combo = 0, wrongInWord = false;
let hintLevel = store.getSettings().hintLevel || 'full';
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
    // 易混对由范式课程数据供给：键位对按 plan 触达过滤，音节尾对按音节结尾过滤（§4.1）
    const pair = courseOf(scheme.id).confus[Number(m.slice(7)) || 0];
    if (!pair) return [];
    const base = [...bi(BUILTIN.chars), ...bi(BUILTIN.words2)];
    if (pair.ends) return base.filter(e => confusEndsMatch(e.py, pair));
    const role = ['sm', 'ym', 'root'].includes(pair.role) ? pair.role : undefined; // 形码形近字母对 role:'root'
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

function startSession(sourceMode) {
  if (timer) { clearInterval(timer); timer = null; }
  mode = sourceMode || mode;
  drillKey = '';
  wrongWordsThisSession = new Set();
  const pool = poolFor(mode);
  $('result').classList.add('hidden');
  if (!pool.length) { showEmptyBoard(false); return; }
  const n = mode === 'sprint' ? Math.min(300, pool.length) : Math.min(SESSION_LEN, pool.length);
  const raw = weightedSample(pool, n);
  queue = raw.map(prepareEntry).filter(Boolean);
  if (!queue.length) { showEmptyBoard(true); return; } // 池有条目但全被 codeOf 过滤（如形码多字词）→ 空态，不出假会话
  if (mode.endsWith('@len')) queue.sort((a, b) => a.code.length - b.code.length); // 先简字后满码（#5 阶 2）
  idx = 0; doneWords = 0; startTime = 0; correctKeys = 0; wrongKeys = 0;
  $('sTime').textContent = mode === 'sprint' ? `0:${SPRINT_SECS}` : '0:00';
  $('sDone').textContent = mode === 'sprint' ? '0' : `0/${queue.length}`;
  $('sAcc').textContent = '100%'; $('sSpeed').textContent = '0';
  next();
}

// 空题板：池空或全被过滤时显示引导（不产生空会话）；
// filteredOut=池有条目但全被 codeOf 过滤——形码方案明示取题仅单字（§3.4）
function showEmptyBoard(filteredOut) {
  const packMissing = scheme.packId && packState(scheme.packId) !== 'ready';
  $('word').textContent = '∅';
  $('hint').textContent = '';
  $('guide').textContent = packMissing ? `${DATA_PACKS[scheme.packId].name}未就绪 —— 网络就绪后可重试加载`
    : mode === 'personal' && filteredOut && (scheme.id === 'zhuyin' || scheme.id === 'jyutping') ? `导入词暂无声调数据 —— ${scheme.name}按词级声调表出题，导入词暂未覆盖；可切回拼音方案练导入词`
    : mode === 'personal' ? '还没有导入词库 —— 去「导入」页添加你的词库，或换别的模式'
    : mode.startsWith('weak:') ? '该键还没有练习数据 —— 先练几轮'
    : mode === 'mistakes' ? '错词本是空的 —— 先去练一轮'
    : filteredOut && scheme.id === 'wubi86' && String(mode).includes('words2') ? `${scheme.name}词组只出课程池二字词 —— 换单字或再练几轮拆字`
    : filteredOut && scheme.paradigm === 'shape' ? `${scheme.name}仅取单字出题 —— 多字词与整句不取题，换个模式试试`
    : '这个模式在当前方案下暂无可练内容 —— 换别的模式试试';
  if (packMissing) {
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.style.marginTop = '12px';
    btn.textContent = '重试加载资料包';
    btn.onclick = async () => { await ensurePack(scheme); startSession(mode); };
    $('guide').appendChild(document.createElement('br'));
    $('guide').appendChild(btn);
  }
  $('inbox').value = '';
  $('inbox').blur();
  $('fb').textContent = '';
  $('prog').style.width = '0%';
  $('sDone').textContent = '0/0';
  clearKeys();
}

function current() { return queue[idx]; }

function updateAcc() {
  const total = correctKeys + wrongKeys;
  $('sAcc').textContent = (total ? Math.round((correctKeys / total) * 100) : 100) + '%';
}

// full 档话术：读 plan label（「第 n 步」，键数不限）
function guideText() {
  return planKeys.map((k, i) => {
    const note = k.note ? ` <span class="sub2">（${esc(k.note)}）</span>` : '';
    return `第 ${i + 1} 步 按 <span class="${i % 2 ? 'g2' : 'g1'}">${esc(k.label)}</span>${note}`;
  }).join('&nbsp;&nbsp;');
}

function updateHighlight(p) {
  const settings = store.getSettings();
  clearKeys();
  $('guide').innerHTML = '';
  if (hintLevel === 'none' || !settings.hlKeys) return;
  // plan 单元寻址（span 感知）：粤拼阳调双敲为单一连击单元（span=2），既有方案 span=1 行为不变
  const at = planUnitAt(planKeys, p);
  if (!at) return;
  const cur = at.unit;
  const after = planKeys[at.index + 1];
  if (keyEls[cur.key]) {
    keyEls[cur.key].classList.add('smhi');
    keyEls[cur.key].dataset.n = String(at.index + 1);
  }
  if (after && after.key !== cur.key && keyEls[after.key]) {
    keyEls[after.key].classList.add('ymhi');
    keyEls[after.key].dataset.n = String(at.index + 2);
  }
  if (hintLevel === 'full') {
    let html = guideText();
    // 五笔 86 兜底形态（§4.2）：展开当前键的字根候选表（与字根总表页同源取数）
    const curRoots = scheme.rootHint && cur && cur.role !== 'root' ? scheme.rootHint(cur.key) : '';
    if (curRoots) html += `<div class="roothint">${esc(curRoots)}</div>`;
    $('guide').innerHTML = html;
  }
}

function next() {
  if (mode !== 'sprint' && idx >= queue.length) return finish();
  if (mode === 'sprint' && idx >= queue.length) idx = 0; // 冲刺循环取题
  const it = current();
  expected = it.code;
  planKeys = (it.plan && it.plan.keys) || [];
  pos = 0; wrongInWord = false;
  $('word').textContent = it.word;
  const settings = store.getSettings();
  let hint = '';
  if (hintLevel === 'full') {
    if (settings.showPy && it.py) hint += esc(it.py.replace(/\s+/g, ' '));
    if (settings.showCode) hint += (hint ? ' · ' : '') + `<b>${esc(it.display)}</b>`;
  }
  $('hint').innerHTML = hint;
  $('fb').textContent = '';
  if (mode !== 'sprint') $('prog').style.width = `${(idx / queue.length) * 100}%`;
  const inbox = $('inbox');
  inbox.value = ''; inbox.focus();
  updateHighlight(0);
}

function tick() {
  const el = Math.floor((Date.now() - startTime) / 1000);
  if (mode === 'sprint') {
    const left = Math.max(0, SPRINT_SECS - el);
    $('sTime').textContent = `0:${String(left).padStart(2, '0')}`;
    if (left <= 0) return finish();
  } else {
    $('sTime').textContent = `${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`;
  }
  const mins = (Date.now() - startTime) / 60000;
  $('sSpeed').textContent = mins > 0 ? String(Math.round((correctKeys + wrongKeys) / mins)) : '0';
}

// 自适应难度（ADR-0006）：会话边界自动调提示档
function adapt(acc) {
  const s = store.getSettings();
  s.adaptHigh = acc >= 95 ? (s.adaptHigh || 0) + 1 : 0;
  const order = ['none', 'keys', 'full'];
  if (acc >= 95 && s.adaptHigh >= 2 && hintLevel !== 'none') {
    setHintLevel(order[Math.max(0, order.indexOf(hintLevel) - 1)]);
    s.adaptHigh = 0;
    toast('准确率持续 ≥95%，提示自动降一档');
  } else if (acc < 70 && hintLevel !== 'full') {
    setHintLevel(order[Math.min(2, order.indexOf(hintLevel) + 1)]);
    s.adaptHigh = 0;
    toast('准确率偏低，提示自动升一档');
  }
  store.setSettings(s);
}

function finish() {
  if (timer) { clearInterval(timer); timer = null; }
  store.flushKeys();
  const secs = Math.max(1, Math.round((Date.now() - startTime) / 1000));
  const total = correctKeys + wrongKeys;
  const acc = total ? Math.round((correctKeys / total) * 100) : 100;
  const kpm = Math.round((total / secs) * 60);
  store.addSession({ ts: Date.now(), mode, secs, acc, kpm, total, scheme: scheme.id, words: doneWords });
  adapt(acc);
  renderStreak();
  $('resgrid').innerHTML =
    `<div><b>${acc}%</b><span>准确率</span></div>` +
    `<div><b>${kpm}</b><span>键/分</span></div>` +
    `<div><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b><span>用时</span></div>` +
    `<div><b>${doneWords}</b><span>词条</span></div>`;
  $('result').classList.remove('hidden');
}
$('again').onclick = () => startSession(mode);

function trackWrongWord() {
  const it = current();
  if (it && !wrongWordsThisSession.has(it.word)) {
    wrongWordsThisSession.add(it.word);
    // 错词本弃码快照：存 {word, py, errPos}，回灌时按当前方案重派（§3.6）
    store.addMistake(scheme.id, { word: it.word, py: it.py, errPos: pos });
  }
}

// ================= 击键震荡与打击粒子引擎 =================
const canvas = /** @type {HTMLCanvasElement} */ ($('impactCanvas'));
const ctx = canvas ? canvas.getContext('2d') : null;
let particles = [], shockwaves = [], animFrame = null;

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
  constructor(x, y, color, speedMul = 1) {
    this.x = x; this.y = y;
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 3 + 2) * speedMul;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed - 1.2;
    this.alpha = 1;
    this.size = Math.random() * 3 + 1.8;
    this.color = color;
    this.decay = Math.random() * 0.035 + 0.025;
    this.gravity = 0.12;
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    this.vy += this.gravity; this.vx *= 0.96;
    this.alpha -= this.decay;
  }
  draw(c) {
    if (this.alpha <= 0) return;
    c.save(); c.globalAlpha = Math.max(0, this.alpha);
    c.fillStyle = this.color; c.beginPath();
    c.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    c.fill(); c.restore();
  }
}

class Shockwave {
  constructor(x, y, color) {
    this.x = x; this.y = y; this.r = 6;
    this.alpha = 0.85; this.color = color;
  }
  update() { this.r += 2.2; this.alpha *= 0.86; }
  draw(c) {
    if (this.alpha <= 0.02) return;
    c.save(); c.globalAlpha = this.alpha;
    c.strokeStyle = this.color; c.lineWidth = 2;
    c.beginPath(); c.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    c.stroke(); c.restore();
  }
}

function renderParticles() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    shockwaves[i].update(); shockwaves[i].draw(ctx);
    if (shockwaves[i].alpha <= 0.02) shockwaves.splice(i, 1);
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update(); particles[i].draw(ctx);
    if (particles[i].alpha <= 0) particles.splice(i, 1);
  }
  if (particles.length > 0 || shockwaves.length > 0) animFrame = requestAnimationFrame(renderParticles);
  else animFrame = null;
}

function triggerImpact(x, y, isBig = false) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // reduced-motion 停置击键粒子（§5.6）
  const colors = ['#D96C4F', '#EDEDEF', '#7FA98C', '#E47A5F'];
  const count = isBig ? 16 : 7;
  for (let i = 0; i < count; i++) {
    const col = colors[Math.floor(Math.random() * colors.length)];
    particles.push(new Particle(x, y, col, isBig ? 1.3 : 1));
  }
  shockwaves.push(new Shockwave(x, y, isBig ? '#7FA98C' : '#D96C4F'));
  if (!animFrame) animFrame = requestAnimationFrame(renderParticles);
}

function onInput() {
  if (!queue.length || idx >= queue.length || !$('result').classList.contains('hidden')) return;
  if (!startTime) { startTime = Date.now(); timer = setInterval(tick, 500); }
  const inbox = $('inbox');
  const typed = inbox.value.toLowerCase();
  if (!typed.length) return;
  const ch = typed[typed.length - 1];
  const ok = ch === expected[pos];
  store.addKey(scheme.id, ch, ok);
  const settings = store.getSettings();
  if (settings.sound) (ok ? sound.key : sound.miss)();
  if (ok) {
    correctKeys++;
    pos++;
    $('fb').textContent = '';
    const el = keyEls[ch];
    if (el) {
      el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 90);
      if (settings.keyImpact !== false) {
        el.classList.remove('key-impact');
        void el.offsetWidth;
        el.classList.add('key-impact');
        const rect = el.getBoundingClientRect();
        triggerImpact(rect.left + rect.width / 2, rect.top + rect.height / 2, false);
      }
    }
    if (settings.keyImpact !== false) {
      const st = /** @type {HTMLElement|null} */ (document.querySelector('.stage'));
      if (st) {
        st.classList.remove('recoil');
        void st.offsetWidth;
        st.classList.add('recoil');
      }
    }
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
      if (mode === 'sprint') { combo++; $('sCombo').textContent = String(combo); }
      if (settings.sound) sound.hit();
      idx++;
      if (mode !== 'sprint') $('sDone').textContent = `${idx}/${queue.length}`;
      else $('sDone').textContent = String(doneWords);
      if (settings.keyImpact !== false) {
        const wEl = $('word');
        if (wEl) {
          const rect = wEl.getBoundingClientRect();
          triggerImpact(rect.left + rect.width / 2, rect.top + rect.height / 2, true);
        }
      }
      const w = $('word');
      w.classList.add('fade');
      setTimeout(() => { w.classList.remove('fade'); next(); }, 60);
    } else {
      updateHighlight(pos);
    }
  } else {
    wrongKeys++;
    combo = 0; $('sCombo').textContent = '0';
    wrongInWord = true;
    trackWrongWord();
    inbox.value = typed.slice(0, -1);
    inbox.classList.add('shake');
    setTimeout(() => inbox.classList.remove('shake'), 130);
    const el = keyEls[ch];
    if (el) { el.classList.add('errflash'); setTimeout(() => el.classList.remove('errflash'), 120); }
    const want = planUnitAt(planKeys, pos);
    const note = want && want.unit.note ? `（${want.unit.note}）` : '';
    $('fb').textContent = want ? `第 ${want.index + 1} 步应是 ${want.unit.label}${note}` : '';
  }
  updateAcc();
}
$('inbox').addEventListener('input', onInput);

// 模式与提示切换
function setModeButton(m) {
  qsa('#modes button').forEach(x => x.classList.toggle('on', x.dataset.mode === m));
}
qsa('#modes button').forEach(b => {
  b.onclick = () => { setModeButton(b.dataset.mode); startSession(b.dataset.mode); };
});
// 易混对按钮由范式课程数据供给（音码=音系/拼写对；形码形近字母对由 #5 课程数据供，机制复用）
function buildConfusButtons() {
  qsa('#modes button[data-mode^="confus:"]').forEach(b => b.remove());
  const anchor = $('modes').querySelector('button[data-mode="personal"]');
  courseOf(scheme.id).confus.forEach((pair, i) => {
    const b = document.createElement('button');
    b.dataset.mode = `confus:${i}`;
    b.textContent = pair.label;
    b.onclick = () => { setModeButton(b.dataset.mode); startSession(b.dataset.mode); };
    anchor.before(b);
  });
}
// 模式栏变化面（§5.4）：形码隐藏二字词/多字词/整句（v3 形码只取单字）；骨架其余不动
function applyModeBar() {
  const hidden = hiddenModesFor(scheme);
  qsa('#modes button').forEach(b => {
    if (['words2', 'words34', 'sentences'].includes(b.dataset.mode)) {
      b.style.display = hidden.includes(b.dataset.mode) ? 'none' : '';
    }
  });
}
// 练习页科普 details 块：按当前方案数据驱动（§5.1 / T5-D7，不另起弹窗）
function renderHelpBlock() {
  const block = $('helpBlock');
  const h = schemeHelpOf(scheme);
  block.querySelector('summary').textContent = h.summary;
  block.querySelector('.helpbody').innerHTML = h.body;
}
function setHintLevel(level) {
  hintLevel = level;
  const s = store.getSettings();
  s.hintLevel = level;
  store.setSettings(s);
  qsa('input[name="hint"]').forEach(r => { r.checked = r.value === level; });
  qsa('input[name="hintSet"]').forEach(r => { r.checked = r.value === level; });
  if (queue.length && idx < queue.length) next();
}
$('hintseg').addEventListener('change', (e) => { if (e.target.name === 'hint') setHintLevel(e.target.value); });

// ================= 课程（数据驱动：每阶 = 范式课程数据 + 通用渲染器，§4.1）=================
// 五阶形状固定，内容换课程数据；进度 per-scheme（course.<scheme>，接 #1 存储拆分）。
let stageIdx = store.getCourse(scheme.id).stage || 0;

function challengeState() {
  const ch = store.getChallenge();
  if (!ch) return null;
  const course = courseOf(scheme.id);
  const sessions = store.getSessions();
  const days = store.getDays();
  return course.challenge.map((item, i) => {
    const day = new Date(ch.start + i * 86400000).toDateString();
    const done = i === 0 ? !!days[day]?.course
      : sessions.some(s => new Date(s.ts).toDateString() === day && challengeMatch(item.match, s.mode, course));
    return { tag: item.tag, label: item.label, done };
  });
}

function renderCourse() {
  const course = courseOf(scheme.id);
  const body = $('stageBody');
  if (scheme.coursePackId && !scheme.courseReady) {
    $('stages').innerHTML = '';
    body.innerHTML = `<p class="formnote">${esc(DATA_PACKS[scheme.coursePackId].name)}未就绪。</p><button class="btn primary" id="courseRetry">重试加载资料包</button>`;
    $('courseRetry').onclick = async () => { if (await ensurePack(scheme)) renderCourse(); };
    return;
  }
  const ol = $('stages');
  ol.innerHTML = '';
  course.stages.forEach((st, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${i + 1}. ${st.name}<small>${st.sub}</small></span>`;
    li.classList.toggle('on', i === stageIdx);
    li.onclick = () => { stageIdx = i; store.setCourse(scheme.id, { stage: i }); renderCourse(); };
    ol.appendChild(li);
  });
  // 七日挑战卡（谓词读范式课程数据）；课程包失败时由上方重试态接管
  if (!course.noChallenge) {
    const card = document.createElement('li');
    card.className = 'challenge';
    const st = challengeState();
    if (!st) {
      card.innerHTML = `<span>七日挑战<small>${course.challengeSub}</small></span>`;
      card.onclick = () => { store.startChallenge(); toast(`七日挑战开始！今天：${course.challenge[0].label}`); renderCourse(); };
    } else {
      const today = Math.min(6, Math.floor((Date.now() - store.getChallenge().start) / 86400000));
      card.innerHTML = `<span>七日挑战 · 第 ${today + 1} 天：${st[today].label}<small>${st.map(d => d.done ? '✓' : '·').join(' ')}</small></span>`;
    }
    ol.appendChild(card);
  }

  body.innerHTML = '';
  renderStage(body, course.stages[stageIdx]);
  if (scheme.id === 'wubi86') body.insertAdjacentHTML('beforeend', '<p class="formnote">拆解为本站教学口径。</p>');
}

// 课程页正文统一追加拆解口径说明，避免把自写教学拆解误作唯一标准。
// groups=[{label, desc?, keys}]，芯片标签随当前方案键帽派生，点击回调 pick
function renderRootChips(cats, groups, pick) {
  for (const g of groups || []) {
    const sec = document.createElement('div');
    sec.className = 'rootcat';
    sec.innerHTML = `<b>${esc(g.label)}</b>${g.desc ? ` <span class="sub">${esc(g.desc)}</span>` : ''}`;
    const row = document.createElement('div');
    row.className = 'rootrow';
    for (const k of g.keys) {
      const b = document.createElement('button');
      b.className = 'btn ghost rootchip';
      const lab = scheme.layout.keyLabel(k);
      b.innerHTML = `${esc(lab.main)}<small>${esc(lab.sub)}</small>`;
      b.onclick = () => pick(k);
      row.appendChild(b);
    }
    sec.appendChild(row);
    cats.appendChild(sec);
  }
}

// 兼容兜底课程视图：字根总表页；课程包失败时由 renderCourse 显示可重试状态。
function renderRootsPage(body, st) {
  const course = courseOf(scheme.id);
  body.innerHTML = `<h3>${esc(st.name)}</h3><p class="sub">${esc(st.sub)}</p>
    <p>${esc(st.body)}</p>
    <div class="kbmap" id="kbmap"></div>
    <div class="rootdetail" id="rootdetail"><p class="sub">点击任意键或下方键位，查看键上字根与例字。</p></div>
    <div class="rootcats" id="rootcats"></div>
    <p class="formnote">拆解为本站教学口径。</p>
    <button class="btn primary" id="goFree">自由练习 · 仅单字出题</button>`;
  const pick = (ch) => {
    const info = (course.roots || {})[ch];
    const box = $('rootdetail');
    if (!info) {
      box.innerHTML = `<p class="sub">${ch === 'z' ? 'Z 学习键 · 不参与取码' : `键 ${esc(ch.toUpperCase())}`}</p>`;
      return;
    }
    const exHtml = (info.ex || []).map((w) => {
      const c = scheme.codeOf({ word: w });
      return `<span class="rootex">${esc(w)}<small>${c ? esc(c) : '…'}</small></span>`;
    }).join(' ');
    box.innerHTML = `<h4>${esc(ch.toUpperCase())}<small>${esc(info.zone)}区${info.pos}位</small></h4>
      <p>键上字根：${esc(info.roots)}</p>
      ${exHtml ? `<p class="rootexwrap">例字（码随资料包派生）：${exHtml}</p>` : ''}`;
  };
  buildKeyboard($('kbmap'), { map: true, onKey: pick });
  renderRootChips($('rootcats'), course.zones, pick);
  $('goFree').onclick = () => gotoPractice('chars');
}

function renderStage(body, st) {
  if (st.kind === 'rootTable') renderRootsPage(body, st); // 兼容视图：课程包未接载时使用
  else if (st.kind === 'keys') renderStageKeys(body, st);
  else if (st.kind === 'drill') renderStageDrill(body, st);
  else if (st.kind === 'mistakes') renderStageMistakes(body, st);
  else renderStagePractice(body, st);
}

// kind='keys'：view='map' 键位说明图（双拼）；view='heat' 弱键热力图（全拼，点键特训）；
//               view='roots' 形码字根认知（#5：点键看字母详情，四类分区 + X/Z 单列）
function renderStageKeys(body, st) {
  store.markCourseSeen();
  if (st.view === 'roots') {
    body.innerHTML = `<h3>${st.name}</h3><p>${st.body}</p>
      <div class="kbmap" id="kbmap"></div>
      <div class="rootdetail" id="rootdetail"><p class="sub">点击任意键或下方字母，查看该字母的字根、辅助字形与例字。</p></div>
      <div class="rootcats" id="rootcats"></div>`;
    const pick = (ch) => {
      const info = (st.letters || {})[ch];
      const lab = scheme.layout.keyLabel(ch);
      const box = $('rootdetail');
      if (!info) { box.innerHTML = `<p class="sub">键 ${esc(ch.toUpperCase())}</p>`; return; }
      const exHtml = (info.ex || []).map((w) => {
        const c = scheme.codeOf({ word: w });
        return `<span class="rootex">${esc(w)}<small>${c ? esc(c) : '…'}</small></span>`;
      }).join(' ');
      box.innerHTML = `<h4>${esc(lab.main)} · ${esc(info.name)}${info.cat ? `<small>（${esc(info.cat)}类）</small>` : ''}</h4>
        ${info.note ? `<p>${esc(info.note)}</p>` : ''}
        ${info.forms ? `<p class="sub">辅助字形：${esc(info.forms)}</p>` : ''}
        ${exHtml ? `<p class="rootexwrap">例字（码随当前方案派生）：${exHtml}</p>` : ''}`;
    };
    buildKeyboard($('kbmap'), { map: true, onKey: pick });
    renderRootChips($('rootcats'), st.groups, pick);
    return;
  }
  if (st.view === 'heat') {
    body.innerHTML = `<h3>${st.name}</h3><p>${st.body}</p><div class="kbmap" id="kbmap"></div>`;
    const els = buildKeyboard($('kbmap'), { heat: true });
    const ks = store.getKeyStats(scheme.id);
    for (const [k, [hit, err]] of Object.entries(ks)) {
      const el = els[k];
      if (!el || !hit) continue;
      const rate = err / hit;
      if (err) el.style.background = `rgba(196, 87, 78, ${Math.min(0.9, rate * 2.2).toFixed(2)})`;
      el.title = `${k.toUpperCase()}：${hit} 次，错 ${err} 次（${Math.round(rate * 100)}%）· 点击弱键特训`;
    }
    return;
  }
  const spec = Object.entries(scheme.SM_NAME);
  const specLine = spec.length
    ? `翘舌声母换位见朱砂描边键（${scheme.name}：${spec.map(([k, v]) => `${v}→${k.toUpperCase()}`).join('、')}）。`
    : '全拼的码就是拼音本身，键位即标准键盘。';
  const intro = st.body || `大字是物理键位，小字是该键在当前方案下承载的韵母。${specLine}`;
  body.innerHTML = `<h3>${scheme.name}键位全景</h3>
    <p>${intro}
    点击任意键查看说明。</p>
    <div class="kbmap" id="kbmap"></div>
    <div class="legend">
      <span><i style="background:var(--cinnabar)"></i>当前要按的键</span>
      <span><i style="background:var(--bamboo)"></i>下一键预告</span>
    </div>`;
  buildKeyboard($('kbmap'), { map: true });
}

// kind='drill'：间隔重复操练。双拼单元=韵母键；全拼单元=音节；五笔单元=码键
function renderStageDrill(body, st) {
  const due = store.srsDueKeys(scheme.id);
  const unitName = st.unit === 'syllable' ? '音节' : st.unit === 'letter' ? '字母' : '键';
  body.innerHTML = `<h3>${st.name}</h3>
    <p>${st.body}
    ${due.length ? `<button class="btn primary" id="dueBtn">先练 ${due.length} 个到期${unitName}</button>` : '<span class="sub2">暂无到期待复习键</span>'}</p>
    <div class="finalkeys" id="finalkeys"></div>`;
  if (due.length) $('dueBtn').onclick = () => startDrill(st, due[0], due);
  const wrap = $('finalkeys');
  const mkBtn = (html, id) => {
    const b = document.createElement('button');
    b.innerHTML = html;
    b.onclick = () => {
      wrap.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      startDrill(st, id);
    };
    wrap.appendChild(b);
  };
  if (st.unit === 'syllable') {
    for (const syl of st.items || []) {
      mkBtn(`${syl.toUpperCase()}${due.includes(syl) ? '<b class="due-dot">●</b>' : ''}`, syl);
    }
  } else if (st.unit === 'symbol' || st.unit === 'letter' || st.unit === 'wbkey') {
    // 注音符号键分组（声符→介符→韵符→声调键收尾，§4.1）/ 仓颉字母四类分组（#5）；
    // 按钮标签随布局键帽派生
    for (const g of st.groups || []) {
      const h = document.createElement('div');
      h.className = 'drillgroup';
      h.textContent = g.label;
      wrap.appendChild(h);
      for (const k of g.keys) {
        const lab = scheme.layout.keyLabel(k);
        mkBtn(`${esc(lab.main)}<small>${esc(lab.sub)}</small>${due.includes(k) ? '<b class="due-dot">●</b>' : ''}`, k);
      }
    }
  } else {
    const groups = {};
    for (const [ym, k] of Object.entries(scheme.YM || {})) (groups[k] ||= []).push(ym);
    // 键遍历派生自 layout（含 e/a 与附键，不再手写串）
    const keys = [...scheme.layout.ROWS.join(''), ...scheme.layout.extraKeys];
    for (const k of keys) {
      const yms = groups[k] || [];
      if (!yms.length && !scheme.layout.specialOf(k)) continue;
      mkBtn(`${k === ';' ? ';' : k.toUpperCase()}<small>${yms.join('/') || '声母位'}</small>${due.includes(k) ? '<b class="due-dot">●</b>' : ''}`, k);
    }
  }
  if (!wrap.children.length) {
    wrap.innerHTML = '<p class="sub">当前方案的操练内容建设中 —— 先去「练习」用内置池自由练习。</p>';
  }
}

function startDrill(st, first, seq) {
  mode = 'finaldrill';
  drillUnit = st.unit;
  drillKey = first;
  drillSeq = seq || [first];
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
  if (timer) { clearInterval(timer); timer = null; }
  wrongWordsThisSession = new Set();
  const raw = weightedSample(hit, Math.min(SESSION_LEN, hit.length));
  queue = raw.map(prepareEntry).filter(Boolean);
  if (!queue.length) { location.hash = '#/practice'; startSession('finaldrill'); return; } // 无可练条目（如注音包未就绪）走空池引导
  idx = 0; doneWords = 0; startTime = 0; correctKeys = 0; wrongKeys = 0;
  $('result').classList.add('hidden');
  $('sTime').textContent = '0:00'; $('sDone').textContent = `0/${queue.length}`;
  $('sAcc').textContent = '100%'; $('sSpeed').textContent = '0';
  setModeButton('');
  location.hash = '#/practice';
  next();
}

function gotoPractice(m) {
  location.hash = '#/practice';
  setModeButton(m);
  startSession(m);
}

// kind='practice'：内置池取题（多池合并模式 = pools 以 '+' 连接；'@'+seq 传轮内排序选项）
function renderStagePractice(body, st) {
  const m = (st.pools || []).join('+') + (st.seq ? '@' + st.seq : '');
  body.innerHTML = `<h3>${st.name}</h3><p>${st.body}</p>
    <button class="btn primary" id="goStage">开始练习</button>`;
  $('goStage').onclick = () => gotoPractice(m);
}

// kind='mistakes'：错词本取题
function renderStageMistakes(body, st) {
  const n = store.getMistakes(scheme.id).length;
  body.innerHTML = `<h3>${st.name}</h3>
    <p>${st.body.replace('{n}', `<b>${n}</b>`)}</p>
    ${n ? '' : '<p class="sub">词库全方案通用，立即可练</p>'}
    <button class="btn primary" id="goMk">${n ? '开始强化' : '错词本是空的'}</button>`;
  $('goMk').onclick = () => { if (n) gotoPractice('mistakes'); };
}

// ================= 导入 =================
const PACKS = [
  { file: 'programming', name: '编程术语' },
  { file: 'idioms', name: '常用成语' },
];
function renderImport() {
  renderLiblist();
  renderPacks();
}
function renderPacks() {
  const box = $('packs');
  box.innerHTML = '';
  const subs = store.getSubs();
  for (const p of PACKS) {
    const d = document.createElement('div');
    d.className = 'lib';
    const subbed = subs.includes(p.file) && store.getLibs().some(l => l.name === `集市·${p.name}`);
    d.innerHTML = `<div><b>${p.name}</b><br><span>词表集市 · 同源静态包</span></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (subbed ? 'ghost' : 'primary');
    btn.textContent = subbed ? '已订阅' : '一键订阅';
    btn.onclick = async () => {
      if (subbed) return;
      const res = await fetch(`data/wordpacks/${p.file}.json`);
      const pack = await res.json();
      const { entries } = mergeEntries([pack.entries.map(({ w, p: py }) => ({ word: w, py, weight: 5 }))]);
      const r = store.addLib(`集市·${p.name}`, entries);
      if (r.ok) {
        store.setSubs([...subs, p.file]);
        toast(`已订阅「${p.name}」，${entries.length} 条入库${scheme.paradigm === 'shape' ? ' · 形码仅取导入词中的单字' : ''}`);
        renderImport();
      } else toast('存储已满，先删除旧词库');
    };
    d.appendChild(btn);
    box.appendChild(d);
  }
}
$('addCustom').onclick = () => {
  const text = $('customText').value;
  if (!text.trim()) return;
  const r = parsePlain(text);
  if (!r.entries.length) { toast('未解析出有效词条（格式：词 拼音）'); return; }
  const old = store.getLibs().find(l => l.name === '自定义词单');
  const { entries } = mergeEntries([...(old ? [old.entries] : []), r.entries]);
  store.removeLib('自定义词单');
  const res = store.addLib('自定义词单', entries);
  toast(res.ok ? `自定义词单入库 ${entries.length} 条` : '存储已满');
  $('customText').value = '';
  renderLiblist();
};

function renderLiblist() {
  const box = $('liblist');
  const libs = store.getLibs();
  box.innerHTML = '';
  if (!libs.length) {
    box.innerHTML = '<p class="sub">尚未导入词库。</p>';
    return;
  }
  for (const lib of libs) {
    const d = document.createElement('div');
    d.className = 'lib';
    const info = document.createElement('div');
    info.innerHTML = `<b>${esc(lib.name)}</b><br><span>${new Date(lib.addedAt).toLocaleString()} · ${lib.entries.length} 条</span>`;
    const del = document.createElement('button');
    del.className = 'btn ghost';
    del.textContent = '删除此库';
    del.onclick = () => { store.removeLib(lib.name); renderLiblist(); };
    d.appendChild(info);
    d.appendChild(del);
    box.appendChild(d);
  }
  const foot = document.createElement('div');
  foot.className = 'lib';
  foot.innerHTML = `<div>当前练习池（合并去重后）<span> ${store.getPool().length}</span> 条，上限 20000</div>`;
  const btn = document.createElement('button');
  btn.className = 'btn ghost';
  btn.textContent = '清空全部';
  btn.onclick = () => { store.clearPool(); renderLiblist(); };
  foot.appendChild(btn);
  box.appendChild(foot);
}

async function handleFiles(files) {
  const report = $('report');
  report.innerHTML = '<div class="line">解析中…</div>';
  const lines = [];
  for (const f of files) {
    const text = await f.text();
    const r = sniffAndParse(f.name, text);
    if (!r.entries.length) {
      lines.push(`<div class="line bad"><b>${esc(f.name)}</b> · 未识别出有效词条（按 ${r.format} 尝试）</div>`);
      continue;
    }
    const { entries, dropped } = mergeEntries([r.entries]);
    const res = store.addLib(f.name, entries);
    if (!res.ok) {
      lines.push(`<div class="line bad"><b>${esc(f.name)}</b> · 浏览器存储已满，删除旧词库后重试</div>`);
      continue;
    }
    lines.push(`<div class="line"><b>${esc(f.name)}</b> · ${r.format} · 读入 ${r.entries.length} 条，去重后 ${entries.length} 条入库` +
      `${dropped ? ` · <span class="bad">${dropped} 条无法切分拼音且无可用码未入库</span>` : ''} · 练习池现有 ${res.kept} 条</div>`);
  }
  lines.push('<div class="line">形码方案（仓颉/速成/五笔 86）仅取导入词中的单字出题，多字词不取题。</div>');
  lines.push('<div class="line">文件仅在你的浏览器内解析，未上传任何服务器。</div>');
  report.innerHTML = lines.join('');
  renderLiblist();
}

const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('over');
  if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]);
});
$('filein').addEventListener('change', (e) => { if (e.target.files.length) handleFiles([...e.target.files]); e.target.value = ''; });

// ================= 统计 =================
function renderStreak() {
  const days = new Set(store.getSessions().map(s => new Date(s.ts).toDateString()));
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  $('streak').textContent = streak ? `${streak} 天连练` : '';
  return streak;
}

function maxStreakFromDays(days) {
  let best = 0;
  for (const k of Object.keys(days)) {
    const prev = new Date(new Date(k).getTime() - 86400000).toDateString();
    if (days[prev]) continue;
    let cur = 1, n = new Date(k);
    while (days[new Date(n.getTime() + 86400000).toDateString()]) { cur++; n = new Date(n.getTime() + 86400000); }
    best = Math.max(best, cur);
  }
  return best;
}

function computeBadges(sessions, streak) {
  const keys = sessions.reduce((a, s) => a + s.total, 0);
  const bestStreak = Math.max(streak, maxStreakFromDays(store.getDays()));
  return [
    ['首练', sessions.length >= 1, '完成第一次练习'],
    ['百词', keys >= 200, '累计 100 词'],
    ['千键', keys >= 1000, '累计 1000 键'],
    ['七日连练', bestStreak >= 7, '连续 7 天'],
    ['冲刺 80', sessions.some(s => s.mode === 'sprint' && s.kpm >= 80), '冲刺 80 键/分'],
    ['满分一轮', sessions.some(s => s.acc === 100 && s.total >= 20), '整轮零失误'],
    ['藏书', store.getLibs().length >= 1, '导入或订阅词库'],
  ];
}

function renderStats() {
  store.flushKeys();
  const sessions = store.getSessions();
  const streak = renderStreak();
  // 连练天数/总时长跨方案聚合；PB 与徽章按方案过滤（不同码长的 kpm 不可比，§3.6）
  const mine = sessions.filter(s => (s.scheme || 'flypy') === scheme.id);
  const tot = sessions.reduce((a, s) => { a.secs += s.secs; a.keys += s.total; return a; }, { secs: 0, keys: 0 });
  const pbKpm = mine.reduce((a, s) => Math.max(a, s.kpm), 0);
  const pbAcc = mine.reduce((a, s) => Math.max(a, s.acc), 0);
  $('totals').innerHTML =
    `<div><b>${Math.round(tot.secs / 60)}</b><span>总分钟</span></div>` +
    `<div><b>${pbKpm}</b><span>PB 键/分 · ${scheme.name}</span></div>` +
    `<div><b>${pbAcc}%</b><span>PB 准确率 · ${scheme.name}</span></div>` +
    `<div><b>${streak}</b><span>连练天数</span></div>`;

  // 徽章墙（会话类徽章按当前方案过滤）
  $('badges').innerHTML = computeBadges(mine, streak).map(([name, got, desc]) =>
    `<div class="badge${got ? ' got' : ''}" title="${desc}"><b>${name}</b><span>${got ? '已达成' : '未达成'}</span></div>`).join('');

  // 键位日历（近一年，跨方案聚合）
  const days = store.getDays();
  const cal = $('calendar');
  cal.innerHTML = '';
  const now = new Date();
  for (let i = 364; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const rec = days[d.toDateString()];
    const lv = !rec ? 0 : rec.keys < 50 ? 1 : rec.keys < 150 ? 2 : 3;
    const c = document.createElement('i');
    c.className = 'cal' + lv;
    c.title = `${d.toLocaleDateString('zh-CN')} · ${rec ? rec.keys + ' 键' : '未练习'}`;
    cal.appendChild(c);
  }

  // 错键热力图：按方案隔离记账
  const ks = store.getKeyStats(scheme.id);
  const heatEls = buildKeyboard($('kbheat'), { heat: true });
  for (const [k, [hit, err]] of Object.entries(ks)) {
    const el = heatEls[k];
    if (!el || !hit) continue;
    const rate = err / hit;
    if (err) el.style.background = `rgba(196, 87, 78, ${Math.min(0.9, rate * 2.2).toFixed(2)})`;
    el.title = `${k.toUpperCase()}：${hit} 次，错 ${err} 次（${Math.round(rate * 100)}%）· 点击弱键特训`;
  }

  const spark = $('spark');
  const pts = sessions.slice(-100);
  if (pts.length < 2) {
    spark.innerHTML = '<div class="no">完成两个会话后这里显示准确率曲线</div>';
  } else {
    const w = 100, h = 100;
    const path = pts.map((s, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - (s.acc / 100) * h;
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    spark.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path d="${path}" fill="none" stroke="#7FA98C" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  $('shareBtn').onclick = () => {
    const last = sessions[sessions.length - 1];
    downloadShareCard({
      acc: last?.acc ?? 100, kpm: last?.kpm ?? 0, secs: last?.secs ?? 0,
      words: last?.words ?? 0, schemeName: scheme.name, streak,
    });
  };

  const list = $('sesslist');
  list.innerHTML = '';
  for (const s of sessions.slice(-100).reverse()) {
    const d = document.createElement('div');
    d.className = 'sess';
    const sname = getScheme(s.scheme || 'flypy').name;
    d.innerHTML = `<span>${new Date(s.ts).toLocaleString()}</span><span>${sname}</span><span>${s.mode.split('@')[0]}</span><b>${s.acc}%</b><span>${s.kpm} 键/分</span><span>${s.secs}s</span>`;
    list.appendChild(d);
  }
  if (!sessions.length) list.innerHTML = '<div class="empty">还没有会话记录</div>';
}

// ================= 错词本 =================
function renderMistakes() {
  const mk = store.getMistakes(scheme.id);
  const box = $('mklist');
  box.innerHTML = '';
  if (!mk.length) {
    box.innerHTML = `<div class="empty">
      <svg width="56" height="56" viewBox="0 0 56 56"><path d="M14 40 Q20 18 28 22 Q36 26 34 34 Q44 28 44 40" stroke="#8B8B93" stroke-width="2" fill="none"/><circle cx="30" cy="18" r="3" fill="#D96C4F"/></svg>
      还没有错过，继续
      <p class="sub">词库全方案通用，立即可练</p></div>`;
    return;
  }
  for (const m of mk.slice(0, 60)) {
    const d = document.createElement('div');
    d.className = 'mk';
    // 不存码快照：展示码按当前方案重派，派不出则显拼音
    const shown = scheme.codeOf({ word: m.word, py: m.py, srcCode: m.srcCode, srcScheme: m.srcScheme }) || m.py || '—';
    d.innerHTML = `<span class="w">${esc(m.word)}</span><span class="c">${esc(shown)}</span><span class="n">错 ${m.n} 次</span>`;
    box.appendChild(d);
  }
}
$('trainMistakes').onclick = () => gotoPractice('mistakes');
$('clearMistakes').onclick = () => { store.clearMistakes(scheme.id); renderMistakes(); };
$('exportRime').onclick = () => {
  const fly = SCHEMES.flypy;
  const mk = store.getMistakes(scheme.id);
  const custom = store.getLibs().find(l => l.name === '自定义词单');
  const lines = ['# Rime 自定义短语（鹤练导出 · 固定小鹤码）',
    '# 格式：词<TAB>码<TAB>权重；放入 rime 配置并挂载 custom_phrase',
    '# 注：导出码恒为小鹤双拼，与你当前练习方案无关'];
  const seen = new Set();
  for (const e of [...mk, ...(custom?.entries || [])]) {
    const code = fly.codeOf(e);
    if (!code || seen.has(e.word)) continue;
    seen.add(e.word);
    lines.push(`${e.word}\t${code}\t1`);
  }
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'helian_rime_phrase.txt';
  a.click();
  URL.revokeObjectURL(a.href);
};

// ================= 设置 =================
function loadSettingsUI() {
  const s = store.getSettings();
  $('setPy').checked = s.showPy;
  $('setCode').checked = s.showCode;
  $('setHl').checked = s.hlKeys;
  $('setImpact').checked = s.keyImpact !== false;
  $('setSound').checked = !!s.sound;
  $('setSchemeNow').textContent = `${scheme.name} · ${scheme.paradigm === 'shape' ? '形码' : '音码'}`;
  qsa('input[name="hintSet"]').forEach(r => { r.checked = r.value === s.hintLevel; });
}
for (const [id, key] of [['setPy', 'showPy'], ['setCode', 'showCode'], ['setHl', 'hlKeys'], ['setImpact', 'keyImpact'], ['setSound', 'sound']]) {
  $(id).addEventListener('change', (e) => {
    const s = store.getSettings();
    s[key] = e.target.checked;
    store.setSettings(s);
  });
}
$('hintSetGroup').addEventListener('change', (e) => { if (e.target.name === 'hintSet') setHintLevel(e.target.value); });
$('resetAll').onclick = () => {
  if (confirm('确定重置全部本地数据？词库、统计、错词本都会清空。')) {
    store.resetAll();
    location.reload();
  }
};

// ================= 方案库 / 芯片（#7：环境对象供 schemes-ui 渲染用）=================
const libEnv = {
  current: () => scheme,
  applyScheme,
  gotoPractice,
  buildKeyboard,
  toast,
};
const updateChip = initSchemeChip(libEnv);

// ================= 启动 =================
document.title = `鹤练 · ${scheme.name}练习`;
$('inbox').setAttribute('aria-label', `输入${scheme.name}编码`);
qsa('input[name="hint"]').forEach(r => { r.checked = r.value === hintLevel; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
buildConfusButtons();
applyModeBar();
renderHelpBlock();
updateChip();
renderStreak();
route();
(async () => {
  const ok = await ensurePack(scheme); // 带包方案先走激活状态流再出题
  if (ok && location.hash === '#/course') renderCourse();
  startSession('chars');
})();
