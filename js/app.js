import { BUILTIN } from './data.js';
import { getScheme, SCHEME_LIST, SCHEMES } from './schemes.js';
import { sniffAndParse, mergeEntries, weightedSample, parsePlain } from './parsers.js';
import { store } from './store.js';
import { sound } from './sound.js';
import { downloadShareCard } from './share.js';

let scheme = getScheme(store.getSettings().scheme);
let keyPlan = scheme.keyPlan, entryCode = scheme.entryCode, YM = scheme.YM,
  SM_NAME = scheme.SM_NAME, ROWS = scheme.ROWS, extraKeys = scheme.extraKeys;

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const qsa = (sel) => /** @type {NodeListOf<any>} */ (document.querySelectorAll(sel));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

// ================= 路由 =================
const VIEWS = ['practice', 'course', 'import', 'stats', 'mistakes', 'settings'];
function route() {
  const v = (location.hash || '#/practice').replace('#/', '');
  const target = VIEWS.includes(v) ? v : 'practice';
  for (const name of VIEWS) $('view-' + name).classList.toggle('hidden', name !== target);
  qsa('.nav a').forEach(a => a.classList.toggle('on', a.dataset.view === target));
  if (target === 'stats') renderStats();
  if (target === 'mistakes') renderMistakes();
  if (target === 'course') renderCourse();
  if (target === 'import') renderImport();
  if (target === 'settings') loadSettingsUI();
}
addEventListener('hashchange', route);

// ================= 键盘图 =================
let YM_LABEL = {};
let keyEls = {};
function rebuildYmLabel() {
  YM_LABEL = {};
  for (const [ym, k] of Object.entries(YM)) (YM_LABEL[k] ||= []).push(ym);
}
rebuildYmLabel();

function buildKeyboard(container, { heat = false, map = false } = {}) {
  container.innerHTML = '';
  const els = {};
  const rows = [...ROWS];
  if (extraKeys.length) rows.push(extraKeys.join(''));
  for (const row of rows) {
    const r = document.createElement('div');
    r.className = 'kbrow';
    for (const ch of row) {
      const d = document.createElement('div');
      d.className = 'key' + (Object.values(scheme.SM_KEYS).includes(ch) ? ' special' : '');
      d.dataset.key = ch;
      d.innerHTML = `<span class="sm">${ch === ';' ? ';' : ch.toUpperCase()}</span><span class="ym">${(YM_LABEL[ch] || []).join('/')}</span>`;
      if (map) d.title = `声母 ${SM_NAME[ch] || ch}｜韵母 ${(YM_LABEL[ch] || []).join(' / ') || '—'}`;
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
  } else {
    for (const [ch, el] of Object.entries(els)) {
      el.onclick = () => { // 触屏/鼠标点按输入
        const inbox = $('inbox');
        inbox.value += ch;
        inbox.dispatchEvent(new Event('input'));
      };
    }
  }
  return els;
}
keyEls = buildKeyboard($('kb'));

function applyScheme(id) {
  scheme = getScheme(id);
  keyPlan = scheme.keyPlan; entryCode = scheme.entryCode; YM = scheme.YM;
  SM_NAME = scheme.SM_NAME; ROWS = scheme.ROWS; extraKeys = scheme.extraKeys;
  rebuildYmLabel();
  keyEls = buildKeyboard($('kb'));
  const s = store.getSettings();
  s.scheme = scheme.id;
  store.setSettings(s);
  toast(`已切换：${scheme.name}`);
  if (queue.length) next();
}

function clearKeys(els = keyEls) {
  for (const k of Object.values(els)) k.classList.remove('smhi', 'ymhi');
}

// ================= 练习引擎 =================
const SESSION_LEN = 20;
const SPRINT_SECS = 60;
let queue = [], idx = 0, plans = [], expected = '', pos = 0;
let startTime = 0, timer = null, correctKeys = 0, wrongKeys = 0;
let mode = 'chars', drillKey = '', drillSeq = [], combo = 0, wrongInWord = false;
let hintLevel = store.getSettings().hintLevel || 'full';
let wrongWordsThisSession = new Set();

const SENTENCES = (() => { // 二字词连句（2-3 词）
  const out = [];
  const w = BUILTIN.words2;
  for (let i = 0; i + 1 < w.length; i += 2) {
    out.push({ word: w[i].w + w[i + 1].w, py: `${w[i].p} ${w[i + 1].p}`, code: '', weight: 1 });
  }
  for (let i = 0; i + 2 < w.length; i += 3) {
    out.push({ word: w[i].w + w[i + 1].w + w[i + 2].w, py: `${w[i].p} ${w[i + 1].p} ${w[i + 2].p}`, code: '', weight: 1 });
  }
  return out;
})();

const CONFUS = [
  ['ym', 'in', 'ing'], ['ym', 'an', 'ang'], ['ym', 'en', 'eng'],
  ['sm', 'zh', 'z'], ['sm', 'ch', 'c'], ['sm', 'sh', 's'],
];
function confusKeys(triple) {
  const role = triple[0];
  const keys = [triple[1], triple[2]].map(n => scheme.SM_KEYS[n] || scheme.YM[n] || n);
  return { role, keys };
}
function entryTouchesKey(e, role, keys) {
  return (e.py || '').split(/\s+/).some(s => {
    const pl = keyPlan(s);
    if (!pl) return false;
    return role === 'sm' ? keys.includes(pl.smKey) : keys.includes(pl.ymKey);
  });
}

function poolFor(m) {
  const imported = store.getPool();
  const mk = store.getMistakes();
  const bi = (arr) => arr.map(({ w, p }) => ({ word: w, py: p, code: '', weight: 1 }));
  if (m.startsWith('weak:')) {
    const k = m.slice(5);
    return [...bi(BUILTIN.chars), ...imported].filter(e => entryTouchesKey(e, 'ym', [k]) || entryTouchesKey(e, 'sm', [k]));
  }
  if (m.startsWith('confus:')) {
    const { role, keys } = confusKeys(CONFUS[Number(m.slice(7)) || 0]);
    return [...bi(BUILTIN.chars), ...bi(BUILTIN.words2)].filter(e => entryTouchesKey(e, role, keys));
  }
  switch (m) {
    case 'chars': return bi(BUILTIN.chars);
    case 'words2': return bi(BUILTIN.words2);
    case 'words34': return bi(BUILTIN.words34);
    case 'sentences': return SENTENCES;
    case 'sprint': case 'mixed':
      return mergeEntries([[...bi(BUILTIN.chars).slice(0, 200), ...bi(BUILTIN.words2).slice(0, 300)], imported]).entries;
    case 'personal': return imported;
    case 'mistakes': return mk.map(({ word, py, code }) => ({ word, py, code, weight: 1 }));
  }
  return [];
}

function prepareEntry(e) {
  const code = entryCode(e);
  const syls = e.py ? e.py.split(/\s+/) : [];
  const ps = syls.length === code.length / 2 ? syls.map(s => keyPlan(s)) : [];
  return { word: e.word, py: e.py || '', code, plans: ps };
}

function startSession(sourceMode) {
  if (timer) { clearInterval(timer); timer = null; }
  mode = sourceMode || mode;
  drillKey = '';
  wrongWordsThisSession = new Set();
  const pool = poolFor(mode);
  $('result').classList.add('hidden');
  if (!pool.length) {
    $('word').textContent = '∅';
    $('hint').textContent = '';
    $('guide').textContent = mode === 'personal' ? '还没有导入词库 —— 去「导入」页添加你的词库，或换别的模式'
      : mode.startsWith('weak:') ? '该键还没有练习数据 —— 先练几轮' : '错词本是空的 —— 先去练一轮';
    $('inbox').value = '';
    $('inbox').blur();
    $('fb').textContent = '';
    $('prog').style.width = '0%';
    $('sDone').textContent = '0/0';
    clearKeys();
    return;
  }
  const n = mode === 'sprint' ? Math.min(300, pool.length) : Math.min(SESSION_LEN, pool.length);
  const raw = weightedSample(pool, n);
  queue = raw.map(prepareEntry).filter(e => e.code);
  idx = 0; startTime = 0; correctKeys = 0; wrongKeys = 0;
  $('sTime').textContent = mode === 'sprint' ? `0:${SPRINT_SECS}` : '0:00';
  $('sDone').textContent = mode === 'sprint' ? '0' : `0/${queue.length}`;
  $('sAcc').textContent = '100%'; $('sSpeed').textContent = '0';
  next();
}

function current() { return queue[idx]; }

function updateAcc() {
  const total = correctKeys + wrongKeys;
  $('sAcc').textContent = (total ? Math.round((correctKeys / total) * 100) : 100) + '%';
}

function guideText(plan) {
  if (!plan) return '';
  if (plan.zeroDouble) {
    return `① 先按 <span class="g1">${plan.smKey.toUpperCase()}</span>，② 再按 <span class="g2">${plan.ymKey.toUpperCase()}</span> <span class="sub2">（单韵母 ${plan.ymName}，按两下）</span>`;
  }
  const smNote = SM_NAME[plan.smKey] ? `（${SM_NAME[plan.smKey]} 在 ${plan.smKey.toUpperCase()} 键）` : '';
  return `① 先按 <span class="g1">${plan.smKey.toUpperCase()}</span> <span class="sub2">声母 ${plan.smName}${smNote}</span>&nbsp;&nbsp;② 再按 <span class="g2">${plan.ymKey.toUpperCase()}</span> <span class="sub2">韵母 ${plan.ymName}</span>`;
}

function updateHighlight(p) {
  const settings = store.getSettings();
  clearKeys();
  $('guide').innerHTML = '';
  if (hintLevel === 'none' || !settings.hlKeys) return;
  const sylIdx = Math.floor(p / 2);
  const plan = plans[sylIdx];
  if (!plan) return;
  const want = p % 2 === 0 ? plan.smKey : plan.ymKey;
  const after = p % 2 === 0 ? plan.ymKey : (plans[sylIdx + 1]?.smKey ?? '');
  if (keyEls[want]) keyEls[want].classList.add('smhi');
  if (after && after !== want && keyEls[after]) keyEls[after].classList.add('ymhi');
  if (hintLevel === 'full') $('guide').innerHTML = guideText(plan);
}

function next() {
  if (mode !== 'sprint' && idx >= queue.length) return finish();
  if (mode === 'sprint' && idx >= queue.length) idx = 0; // 冲刺循环取题
  const it = current();
  expected = it.code;
  plans = it.plans;
  pos = 0; wrongInWord = false;
  $('word').textContent = it.word;
  const settings = store.getSettings();
  let hint = '';
  if (hintLevel === 'full') {
    if (settings.showPy && it.py) hint += esc(it.py.replace(/\s+/g, ' '));
    if (settings.showCode) hint += (hint ? ' · ' : '') + `<b>${esc(it.code)}</b>`;
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
  store.addSession({ ts: Date.now(), mode, secs, acc, kpm, total });
  adapt(acc);
  renderStreak();
  $('resgrid').innerHTML =
    `<div><b>${acc}%</b><span>准确率</span></div>` +
    `<div><b>${kpm}</b><span>键/分</span></div>` +
    `<div><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b><span>用时</span></div>` +
    `<div><b>${mode === 'sprint' ? Math.floor(total / 2) : queue.length}</b><span>词条</span></div>`;
  $('result').classList.remove('hidden');
}
$('again').onclick = () => startSession(mode);

function trackWrongWord() {
  const it = current();
  if (it && !wrongWordsThisSession.has(it.word)) {
    wrongWordsThisSession.add(it.word);
    store.addMistake({ word: it.word, py: it.py, code: it.code });
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
  store.addKey(ch, ok);
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
      if (mode === 'finaldrill' && drillSeq.length) {
        for (const pl of plans) if (pl && drillSeq.includes(pl.ymKey)) store.srsTouch(pl.ymKey, !wrongInWord);
      }
      if (mode === 'sprint') { combo++; $('sCombo').textContent = String(combo); }
      if (settings.sound) sound.hit();
      idx++;
      if (mode !== 'sprint') $('sDone').textContent = `${idx}/${queue.length}`;
      else $('sDone').textContent = String(Math.floor((correctKeys + wrongKeys) / 2));
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
    $('fb').textContent = `这一键应是 ${expected[pos].toUpperCase()}`;
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

// ================= 课程 =================
const STAGES = [
  ['键位认知', '一张图看懂当前方案键位'],
  ['韵母操练', '逐键建立韵母反射（间隔重复）'],
  ['单字练习', '高频字两键输入'],
  ['词组练习', '二字词连贯输入'],
  ['易错强化', '从你的错词本取题'],
];
let stageIdx = store.getCourse().stage || 0;

const CHALLENGE = [
  ['D1', '任意一轮热身', () => true],
  ['D2', '韵母操练一轮', (m) => m === 'finaldrill'],
  ['D3', '单字一轮', (m) => m === 'chars'],
  ['D4', '二字词一轮', (m) => m === 'words2'],
  ['D5', '易混对抗一轮', (m) => m.startsWith('confus')],
  ['D6', '限时冲刺一轮', (m) => m === 'sprint'],
  ['D7', '混合综合一轮', (m) => m === 'mixed' || m === 'sentences'],
];
function challengeState() {
  const ch = store.getChallenge();
  if (!ch) return null;
  const sessions = store.getSessions();
  const days = store.getDays();
  return CHALLENGE.map((item, i) => {
    const match = /** @type {(m: string) => boolean} */ (item[2]);
    const day = new Date(ch.start + i * 86400000).toDateString();
    const done = i === 0 ? !!days[day]?.course : sessions.some(s => new Date(s.ts).toDateString() === day && match(s.mode));
    return { tag: item[0], label: item[1], done };
  });
}

function renderCourse() {
  const ol = $('stages');
  ol.innerHTML = '';
  STAGES.forEach(([name, sub], i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${i + 1}. ${name}<small>${sub}</small></span>`;
    li.classList.toggle('on', i === stageIdx);
    li.onclick = () => { stageIdx = i; store.setCourse({ stage: i }); renderCourse(); };
    ol.appendChild(li);
  });
  // 七日挑战卡
  const card = document.createElement('li');
  card.className = 'challenge';
  const st = challengeState();
  if (!st) {
    card.innerHTML = `<span>七日挑战<small>每天一个小目标，七天入门双拼</small></span>`;
    card.onclick = () => { store.startChallenge(); toast('七日挑战开始！今天：任意一轮热身'); renderCourse(); };
  } else {
    const today = Math.min(6, Math.floor((Date.now() - store.getChallenge().start) / 86400000));
    card.innerHTML = `<span>七日挑战 · 第 ${today + 1} 天：${st[today].label}<small>${st.map(d => d.done ? '✓' : '·').join(' ')}</small></span>`;
  }
  ol.appendChild(card);

  const body = $('stageBody');
  body.innerHTML = '';
  if (stageIdx === 0) renderStage0(body);
  else if (stageIdx === 1) renderStage1(body);
  else if (stageIdx === 4) renderStage4(body);
  else renderStagePractice(body, stageIdx === 2 ? 'chars' : 'words2');
}

function renderStage0(body) {
  store.markCourseSeen();
  body.innerHTML = `<h3>${scheme.name}键位全景</h3>
    <p>每个键有两个角色：大字是声母位，小字是该键承载的韵母。
    翘舌声母换位见朱砂描边键（${scheme.name}：${Object.entries(scheme.SM_NAME).map(([k, v]) => `${v}→${k.toUpperCase()}`).join('、')}）。
    点击任意键查看说明。</p>
    <div class="kbmap" id="kbmap"></div>
    <div class="legend">
      <span><i style="background:var(--cinnabar)"></i>① 声母键（先按）</span>
      <span><i style="background:var(--bamboo)"></i>② 韵母键（后按）</span>
    </div>`;
  buildKeyboard($('kbmap'), { map: true });
}

function renderStage1(body) {
  const due = store.srsDueKeys();
  body.innerHTML = `<h3>韵母操练</h3>
    <p>选一个韵母键反复练。带 <b class="due-dot">●</b> 的键是到期待复习键（间隔重复调度）。
    ${due.length ? `<button class="btn primary" id="dueBtn">先练 ${due.length} 个到期键</button>` : '<span class="sub2">暂无到期待复习键</span>'}</p>
    <div class="finalkeys" id="finalkeys"></div>`;
  if (due.length) $('dueBtn').onclick = () => startFinalDrill(due[0], due);
  const wrap = $('finalkeys');
  const groups = {};
  for (const [ym, k] of Object.entries(YM)) (groups[k] ||= []).push(ym);
  for (const k of 'qwrtyuiopsdfghjklzxcvbnm' + extraKeys.join('')) {
    const yms = groups[k] || [];
    if (!yms.length && !SM_NAME[k]) continue;
    const b = document.createElement('button');
    b.innerHTML = `${k === ';' ? ';' : k.toUpperCase()}<small>${yms.join('/') || '声母位'}</small>${due.includes(k) ? '<b class="due-dot">●</b>' : ''}`;
    b.onclick = () => {
      wrap.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      startFinalDrill(k);
    };
    wrap.appendChild(b);
  }
}

function startFinalDrill(k, keySeq) {
  mode = 'finaldrill';
  drillKey = k;
  drillSeq = keySeq || [k];
  const seq = keySeq || [k];
  const hit = BUILTIN.chars
    .map(({ w, p }) => ({ word: w, py: p, code: '', weight: 1 }))
    .filter(e => e.py.split(/\s+/).some(s => { const pl = keyPlan(s); return pl && seq.includes(pl.ymKey); }));
  if (timer) { clearInterval(timer); timer = null; }
  wrongWordsThisSession = new Set();
  const raw = weightedSample(hit, Math.min(SESSION_LEN, hit.length));
  queue = raw.map(prepareEntry).filter(e => e.code);
  idx = 0; startTime = 0; correctKeys = 0; wrongKeys = 0;
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

function renderStagePractice(body, m) {
  const name = m === 'chars' ? '单字练习' : '词组练习';
  body.innerHTML = `<h3>${name}</h3>
    <p>从内置${m === 'chars' ? '高频字' : '常用二字词'}池按频抽题。建议先用「全提示」，
    顺手后切「仅按键」乃至「无提示」。</p>
    <button class="btn primary" id="goStage">开始练习</button>`;
  $('goStage').onclick = () => gotoPractice(m);
}

function renderStage4(body) {
  const n = store.getMistakes().length;
  body.innerHTML = `<h3>易错强化</h3>
    <p>错词本现有 <b>${n}</b> 条。答错的词会自动进错词本（上限 200 条），这里专门重练它们。</p>
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
      const { entries } = mergeEntries([pack.entries.map(({ w, p: py }) => ({ word: w, py, code: '', weight: 5 }))]);
      const r = store.addLib(`集市·${p.name}`, entries);
      if (r.ok) {
        store.setSubs([...subs, p.file]);
        toast(`已订阅「${p.name}」，${entries.length} 条入库`);
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
    const { entries, splitFails } = mergeEntries([r.entries]);
    const res = store.addLib(f.name, entries);
    if (!res.ok) {
      lines.push(`<div class="line bad"><b>${esc(f.name)}</b> · 浏览器存储已满，删除旧词库后重试</div>`);
      continue;
    }
    lines.push(`<div class="line"><b>${esc(f.name)}</b> · ${r.format} · 读入 ${r.entries.length} 条，去重后 ${entries.length} 条入库` +
      `${splitFails ? ` · <span class="bad">${splitFails} 条无法切分拼音未入库</span>` : ''} · 练习池现有 ${res.kept} 条</div>`);
  }
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
  const tot = sessions.reduce((a, s) => { a.secs += s.secs; a.keys += s.total; return a; }, { secs: 0, keys: 0 });
  const avgAcc = sessions.length ? Math.round(sessions.reduce((a, s) => a + s.acc, 0) / sessions.length) : 0;
  const pbKpm = sessions.reduce((a, s) => Math.max(a, s.kpm), 0);
  const pbAcc = sessions.reduce((a, s) => Math.max(a, s.acc), 0);
  $('totals').innerHTML =
    `<div><b>${Math.round(tot.secs / 60)}</b><span>总分钟</span></div>` +
    `<div><b>${pbKpm}</b><span>PB 键/分</span></div>` +
    `<div><b>${pbAcc}%</b><span>PB 准确率</span></div>` +
    `<div><b>${streak}</b><span>连练天数</span></div>`;

  // 徽章墙
  $('badges').innerHTML = computeBadges(sessions, streak).map(([name, got, desc]) =>
    `<div class="badge${got ? ' got' : ''}" title="${desc}"><b>${name}</b><span>${got ? '已达成' : '未达成'}</span></div>`).join('');

  // 键位日历（近一年）
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

  const ks = store.getKeyStats();
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
      words: Math.floor((last?.total ?? 0) / 2), schemeName: scheme.name, streak,
    });
  };

  const list = $('sesslist');
  list.innerHTML = '';
  for (const s of sessions.slice(-100).reverse()) {
    const d = document.createElement('div');
    d.className = 'sess';
    d.innerHTML = `<span>${new Date(s.ts).toLocaleString()}</span><span>${s.mode}</span><b>${s.acc}%</b><span>${s.kpm} 键/分</span><span>${s.secs}s</span>`;
    list.appendChild(d);
  }
  if (!sessions.length) list.innerHTML = '<div class="empty">还没有会话记录</div>';
}

// ================= 错词本 =================
function renderMistakes() {
  const mk = store.getMistakes();
  const box = $('mklist');
  box.innerHTML = '';
  if (!mk.length) {
    box.innerHTML = `<div class="empty">
      <svg width="56" height="56" viewBox="0 0 56 56"><path d="M14 40 Q20 18 28 22 Q36 26 34 34 Q44 28 44 40" stroke="#8B8B93" stroke-width="2" fill="none"/><circle cx="30" cy="18" r="3" fill="#D96C4F"/></svg>
      还没有错过，继续</div>`;
    return;
  }
  for (const m of mk.slice(0, 60)) {
    const d = document.createElement('div');
    d.className = 'mk';
    d.innerHTML = `<span class="w">${esc(m.word)}</span><span class="c">${esc(m.code)}</span><span class="n">错 ${m.n} 次</span>`;
    box.appendChild(d);
  }
}
$('trainMistakes').onclick = () => gotoPractice('mistakes');
$('clearMistakes').onclick = () => { store.clearMistakes(); renderMistakes(); };
$('exportRime').onclick = () => {
  const fly = SCHEMES.flypy;
  const mk = store.getMistakes();
  const custom = store.getLibs().find(l => l.name === '自定义词单');
  const lines = ['# Rime 自定义短语（鹤练导出 · 小鹤码）', '# 格式：词<TAB>码<TAB>权重；放入 rime 配置并挂载 custom_phrase'];
  const seen = new Set();
  for (const e of [...mk, ...(custom?.entries || [])]) {
    const code = fly.entryCode(e);
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
  $('setScheme').value = s.scheme || 'flypy';
  qsa('input[name="hintSet"]').forEach(r => { r.checked = r.value === s.hintLevel; });
}
for (const [id, key] of [['setPy', 'showPy'], ['setCode', 'showCode'], ['setHl', 'hlKeys'], ['setImpact', 'keyImpact'], ['setSound', 'sound']]) {
  $(id).addEventListener('change', (e) => {
    const s = store.getSettings();
    s[key] = e.target.checked;
    store.setSettings(s);
  });
}
$('setScheme').addEventListener('change', (e) => applyScheme(e.target.value));
$('hintSetGroup').addEventListener('change', (e) => { if (e.target.name === 'hintSet') setHintLevel(e.target.value); });
$('resetAll').onclick = () => {
  if (confirm('确定重置全部本地数据？词库、统计、错词本都会清空。')) {
    store.resetAll();
    location.reload();
  }
};

// ================= 启动 =================
qsa('input[name="hint"]').forEach(r => { r.checked = r.value === hintLevel; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
renderStreak();
route();
startSession('chars');
