import { BUILTIN } from './data.js';
import { getScheme } from './schemes.js';
import { sniffAndParse, mergeEntries, weightedSample } from './parsers.js';
import { store } from './store.js';

const scheme = getScheme(); // scheme 扩展点：V1 小鹤，未来注册新方案即换表
const { keyPlan, entryCode, YM, SM_NAME, ROWS } = scheme;

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const qsa = (sel) => /** @type {NodeListOf<any>} */ (document.querySelectorAll(sel));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  if (target === 'import') renderLiblist();
  if (target === 'settings') loadSettingsUI();
}
addEventListener('hashchange', route);

// ================= 键盘图 =================
const YM_LABEL = {};
for (const [ym, k] of Object.entries(YM)) (YM_LABEL[k] ||= []).push(ym);

function buildKeyboard(container, { heat = false, map = false } = {}) {
  container.innerHTML = '';
  const els = {};
  for (const row of ROWS) {
    const r = document.createElement('div');
    r.className = 'kbrow';
    for (const ch of row) {
      const d = document.createElement('div');
      d.className = 'key' + (['v', 'i', 'u'].includes(ch) ? ' special' : '');
      d.dataset.key = ch;
      d.innerHTML = `<span class="sm">${ch.toUpperCase()}</span><span class="ym">${(YM_LABEL[ch] || []).join('/')}</span>`;
      if (map) d.title = `声母 ${SM_NAME[ch] || ch}｜韵母 ${(YM_LABEL[ch] || []).join(' / ') || '—'}`;
      els[ch] = d;
      r.appendChild(d);
    }
    container.appendChild(r);
  }
  if (heat) container.classList.add('heat');
  return els;
}
const keyEls = buildKeyboard($('kb'));

function clearKeys(els = keyEls) {
  for (const k of Object.values(els)) k.classList.remove('smhi', 'ymhi');
}

// ================= 练习引擎 =================
const SESSION_LEN = 20;
let queue = [], idx = 0, plans = [], expected = '', pos = 0;
let startTime = 0, timer = null, correctKeys = 0, wrongKeys = 0;
let mode = 'chars';
let hintLevel = store.getSettings().hintLevel || 'full';
let wrongWordsThisSession = new Set();

function poolFor(m) {
  const imported = store.getPool();
  const mk = store.getMistakes();
  const bi = (arr) => arr.map(({ w, p }) => ({ word: w, py: p, code: '', weight: 1 }));
  switch (m) {
    case 'chars': return bi(BUILTIN.chars);
    case 'words2': return bi(BUILTIN.words2);
    case 'words34': return bi(BUILTIN.words34);
    case 'mixed': return mergeEntries([[...bi(BUILTIN.chars).slice(0, 200), ...bi(BUILTIN.words2).slice(0, 300)], imported]).entries;
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
  wrongWordsThisSession = new Set();
  const pool = poolFor(mode);
  $('result').classList.add('hidden');
  if (!pool.length) {
    $('word').textContent = '∅';
    $('hint').textContent = '';
    $('guide').textContent = mode === 'personal' ? '还没有导入词库 —— 去「导入」页添加你的词库，或换别的模式' : '错词本是空的 —— 先去练一轮';
    $('inbox').value = '';
    $('inbox').blur();
    $('fb').textContent = '';
    $('prog').style.width = '0%';
    $('sDone').textContent = '0/0';
    clearKeys();
    return;
  }
  const raw = weightedSample(pool, Math.min(SESSION_LEN, pool.length));
  queue = raw.map(prepareEntry).filter(e => e.code);
  idx = 0; startTime = 0; correctKeys = 0; wrongKeys = 0;
  $('sTime').textContent = '0:00'; $('sDone').textContent = `0/${queue.length}`;
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

// 按「已打对的键数」定位 ①② 高亮与引导（不依赖输入框长度）
function updateHighlight(pos) {
  const settings = store.getSettings();
  clearKeys();
  $('guide').innerHTML = '';
  if (hintLevel === 'none' || !settings.hlKeys) return;
  const sylIdx = Math.floor(pos / 2);
  const plan = plans[sylIdx];
  if (!plan) return;
  const want = pos % 2 === 0 ? plan.smKey : plan.ymKey;
  const after = pos % 2 === 0 ? plan.ymKey : (plans[sylIdx + 1]?.smKey ?? '');
  if (keyEls[want]) keyEls[want].classList.add('smhi');
  if (after && after !== want && keyEls[after]) keyEls[after].classList.add('ymhi');
  if (hintLevel === 'full') $('guide').innerHTML = guideText(plan);
}

function next() {
  if (idx >= queue.length) return finish();
  const it = current();
  expected = it.code;
  plans = it.plans;
  pos = 0;
  $('word').textContent = it.word;
  const settings = store.getSettings();
  let hint = '';
  if (hintLevel === 'full') { // 仅「全提示」档显示拼音/码；「仅按键」只留键盘高亮
    if (settings.showPy && it.py) hint += it.py.replace(/\s+/g, ' ');
    if (settings.showCode) hint += (hint ? ' · ' : '') + `<b>${esc(it.code)}</b>`;
  }
  $('hint').innerHTML = hint;
  $('fb').textContent = '';
  $('prog').style.width = `${(idx / queue.length) * 100}%`;
  const inbox = $('inbox');
  inbox.value = ''; inbox.focus();
  updateHighlight(0);
}

function tick() {
  const t = Math.floor((Date.now() - startTime) / 1000);
  $('sTime').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const mins = (Date.now() - startTime) / 60000;
  $('sSpeed').textContent = mins > 0 ? String(Math.round((correctKeys + wrongKeys) / mins)) : '0';
}

function finish() {
  if (timer) { clearInterval(timer); timer = null; }
  store.flushKeys();
  const secs = Math.round((Date.now() - startTime) / 1000);
  const total = correctKeys + wrongKeys;
  const acc = total ? Math.round((correctKeys / total) * 100) : 100;
  const kpm = secs > 0 ? Math.round((total / secs) * 60) : 0;
  store.addSession({ ts: Date.now(), mode, secs, acc, kpm, total });
  renderStreak();
  $('resgrid').innerHTML =
    `<div><b>${acc}%</b><span>准确率</span></div>` +
    `<div><b>${kpm}</b><span>键/分</span></div>` +
    `<div><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b><span>用时</span></div>` +
    `<div><b>${queue.length}</b><span>词条</span></div>`;
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
  if (ok) {
    correctKeys++;
    pos++;
    $('fb').textContent = '';
    const el = keyEls[ch];
    const settings = store.getSettings();
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
      idx++;
      $('sDone').textContent = `${idx}/${queue.length}`;
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
    trackWrongWord();
    inbox.value = typed.slice(0, -1); // 错键即刻出局，不占位
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
  ['键位认知', '一张图看懂小鹤 26 键'],
  ['韵母操练', '逐键建立韵母反射'],
  ['单字练习', '高频字两键输入'],
  ['词组练习', '二字词连贯输入'],
  ['易错强化', '从你的错词本取题'],
];
let stageIdx = store.getCourse().stage || 0;

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
  const body = $('stageBody');
  body.innerHTML = '';
  if (stageIdx === 0) renderStage0(body);
  else if (stageIdx === 1) renderStage1(body);
  else if (stageIdx === 4) renderStage4(body);
  else renderStagePractice(body, stageIdx === 2 ? 'chars' : 'words2');
}

function renderStage0(body) {
  body.innerHTML = `<h3>小鹤双拼键位全景</h3>
    <p>每个键有两个角色：大字是声母位，小字是该键承载的韵母。
    三个翘舌声母换位：<b>zh → V</b>、<b>ch → I</b>、<b>sh → U</b>（朱砂描边的键）。
    点击任意键查看说明。</p>
    <div class="kbmap" id="kbmap"></div>
    <div class="legend">
      <span><i style="background:var(--cinnabar)"></i>① 声母键（先按）</span>
      <span><i style="background:var(--bamboo)"></i>② 韵母键（后按）</span>
    </div>`;
  buildKeyboard($('kbmap'), { map: true });
}

function renderStage1(body) {
  body.innerHTML = `<h3>韵母操练</h3>
    <p>选一个韵母键，用含该韵母的高频字反复练，直到形成肌肉记忆。</p>
    <div class="finalkeys" id="finalkeys"></div>`;
  const wrap = $('finalkeys');
  const groups = {};
  for (const [ym, k] of Object.entries(YM)) (groups[k] ||= []).push(ym);
  for (const k of 'qwrtyuiopsdfghjklzxcvbnm') {
    const yms = groups[k] || [];
    if (!yms.length && !SM_NAME[k]) continue;
    const b = document.createElement('button');
    b.innerHTML = `${k.toUpperCase()}<small>${yms.join('/') || '声母位'}</small>`;
    b.onclick = () => {
      wrap.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      startFinalDrill(k);
    };
    wrap.appendChild(b);
  }
}

function startFinalDrill(k) {
  const hit = BUILTIN.chars
    .map(({ w, p }) => ({ word: w, py: p, code: '', weight: 1 }))
    .filter(e => e.py.split(/\s+/).some(s => { const pl = keyPlan(s); return pl && pl.ymKey === k; }));
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
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // 今天没练，从昨天数
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  $('streak').textContent = streak ? `${streak} 天连练` : '';
}

function renderStats() {
  store.flushKeys();
  const sessions = store.getSessions();
  const tot = sessions.reduce((a, s) => { a.secs += s.secs; a.keys += s.total; return a; }, { secs: 0, keys: 0 });
  const avgAcc = sessions.length ? Math.round(sessions.reduce((a, s) => a + s.acc, 0) / sessions.length) : 0;
  $('totals').innerHTML =
    `<div><b>${Math.round(tot.secs / 60)}</b><span>总分钟</span></div>` +
    `<div><b>${sessions.length}</b><span>总会话</span></div>` +
    `<div><b>${sessions.length ? avgAcc + '%' : '—'}</b><span>平均准确率</span></div>`;

  const ks = store.getKeyStats();
  const heatEls = buildKeyboard($('kbheat'), { heat: true });
  for (const [k, [hit, err]] of Object.entries(ks)) {
    const el = heatEls[k];
    if (!el || !hit) continue;
    const rate = err / hit;
    if (err) el.style.background = `rgba(196, 87, 78, ${Math.min(0.9, rate * 2.2).toFixed(2)})`;
    el.title = `${k.toUpperCase()}：${hit} 次，错 ${err} 次（${Math.round(rate * 100)}%）`;
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

// ================= 设置 =================
function loadSettingsUI() {
  const s = store.getSettings();
  $('setPy').checked = s.showPy;
  $('setCode').checked = s.showCode;
  $('setHl').checked = s.hlKeys;
  $('setImpact').checked = s.keyImpact !== false;
  qsa('input[name="hintSet"]').forEach(r => { r.checked = r.value === s.hintLevel; });
}
for (const [id, key] of [['setPy', 'showPy'], ['setCode', 'showCode'], ['setHl', 'hlKeys'], ['setImpact', 'keyImpact']]) {
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

// ================= 启动 =================
qsa('input[name="hint"]').forEach(r => { r.checked = r.value === hintLevel; });
renderStreak();
route();
startSession('chars');
