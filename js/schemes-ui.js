// 方案库视图 #/schemes 与顶栏方案芯片（SPEC-0003 §5，issue #7）。
// 纯逻辑部分（分组/次序/卡面元数据/变化面裁定/科普文案）无 DOM 依赖，供单测直取；
// 渲染函数（方案库页/芯片弹层）由 js/app.js 注入环境对象后调用。
// 视觉延续「深夜书法房」，只新增「方案卡」组件（§5.1）。
import { SCHEMES } from './schemes.js';
import { courseOf } from './courses.js';
import { PACKS, packState, packCached, prefetchPacks } from './packs.js';
import { store } from './store.js';

export const FLAGSHIP_ID = 'flypy'; // 旗舰·默认：顶层独享全宽大卡（T5-D1）

// 三层分组（§5.1）：旗舰小鹤顶层 + 音码组/形码组各带一行科普。
// 组内次序 = 音码：自然码/微软/搜狗/智能ABC（双拼子标签）→ 全拼 → 注音；形码：仓颉 → 速成 → 五笔 86。
export const GROUPS = [
  { id: 'phonetic', title: '音码', blurb: '音码 · 码即读音（全拼、五种双拼、注音）',
    ids: ['ziranma', 'mspy', 'sogou', 'abc', 'quanpin', 'zhuyin'] },
  { id: 'shape', title: '形码', blurb: '形码 · 码即字形（仓颉、速成、五笔）',
    ids: ['cangjie', 'quick', 'wubi86'] },
];

// 卡片五层信息之一②：一句话特点（自然码/注音文案出自 T4 简报，§5.1）
export const CARD_FEATURES = {
  flypy: '鹤练旗舰：声母一键、韵母一键，任何音节两键到手。',
  ziranma: '与微软双拼仅差 3 处',
  mspy: '微软系输入法内置键位，双拼通行方案',
  sogou: '搜狗系输入法的双拼键位',
  abc: '老牌智能ABC 的双拼键位',
  quanpin: '码即拼音本身，零键位映射，提速为核',
  zhuyin: '41 键大千布局 · 声调成字',
  cangjie: '字形拆成字母序列，熟字根即识码',
  quick: '速成 = 仓颉首尾二码，节奏更快',
  wubi86: '字根查表出码，先认字根再自由练习',
};

// 卡片五层信息之④：课程形态标签（§5.1 状态行）
export function courseFormOf(id) {
  const c = courseOf(id);
  if (c.form === 'rootTable') return '字根总表 + 自由练习';
  if (id === 'quanpin') return '提速课程';
  return '五阶课程';
}

// 五笔 86 降级形态灰调标签全句（§5.1 / T5-D6）：标签直陈、不遮掩不劝退
export function cardTagOf(id) {
  return id === 'wubi86' ? '字根总表 + 自由练习 · 暂无五阶课程' : '';
}

// 变化面裁定（§5.4）：形码隐藏二字词/多字词/整句（v3 形码只取单字，T2-D5）
export function hiddenModesFor(scheme) {
  return scheme && scheme.paradigm === 'shape' ? ['words2', 'words34', 'sentences'] : [];
}

// 切回态卡片摘要（§5.5 三态 1）：课程第 N 阶 · 错词 X 条；皆无则不显
export function progressSummary(id) {
  const parts = [];
  const stage = store.getCourse(id).stage || 0;
  const c = courseOf(id);
  if (c.form !== 'rootTable') parts.push(`课程第 ${stage + 1} 阶`);
  const n = store.getMistakes(id).length;
  if (n) parts.push(`错词 ${n} 条`);
  return parts.join(' · ');
}

// 科普 details 块（§5.1 末段 / T5-D7）：按当前方案数据驱动，范式科普不做弹窗
export function schemeHelpOf(scheme) {
  if (scheme.paradigm === 'shape') {
    return {
      summary: `什么是${scheme.name}？什么是形码？`,
      body: `<p>形码的码来自字形：把汉字按规则拆成字根（部件），字根落在键上，码就是拆出的键序。「拼」字怎么写，码就怎么打，与读音无关。</p>
        <p><b>${scheme.name}</b>是字表查询范式：逐字查内置字表派生编码。v3 取题仅单字——多字词与整句暂不取题。</p>
        <p>建议先从课程页的字根认知开始，认熟字根再上练习页。</p>`,
    };
  }
  if (scheme.id === 'quanpin') {
    return {
      summary: '什么是全拼？',
      body: `<p>每个汉字的拼音分两部分：<b>声母</b>是开头的辅音，<b>韵母</b>是剩下的部分。
        例如「拼」= <b>p</b>（声母）+ <b>in</b>（韵母）；「双」= <b>sh</b>（声母）+ <b>uang</b>（韵母）。</p>
        <p>全拼的码就是拼音本身：一个字一个字把拼音打全，键序即字母序，没有键位映射可背。
        代价是键数多（双 = shuang，6 键），练的是节奏与指法提速。</p>`,
    };
  }
  if (scheme.id === 'zhuyin') {
    return {
      summary: '什么是注音？',
      body: `<p>注音用 37 个符号给汉字标音：声符、介符、韵符各占一组键，排布是大千布局（41 键）。</p>
        <p>打完符号键必须补一个<b>声调键</b>才出字——ˉ 第一声就是空格键，ˊ ˇ ˋ ˙ 分别在 6 3 4 7 键，轻声按 7。
        所以注音的码 = 符号键 + 声调键收尾。</p>`,
    };
  }
  // 双拼族：翘舌换位与零声母规则自方案表派生（审计-§9 文案面数据驱动）
  const spec = Object.entries(scheme.SM_NAME || {})
    .map(([k, v]) => `${v} 在 <b>${k === ';' ? ';' : k.toUpperCase()}</b> 键`).join('、');
  const zero = scheme.toFly && scheme.toFly('ai').startsWith('o')
    ? '零声母音节（如「爱 ai」）先按 O 引导，再按韵母键（爱 = O L）。'
    : '零声母音节（如「爱 ai」）按 首字母+韵母键（爱 = A D），单韵母 a/o/e 按两下。';
  return {
    summary: `什么是声母、韵母？什么是${scheme.name}？`,
    body: `<p>每个汉字的拼音分两部分：<b>声母</b>是开头的辅音，<b>韵母</b>是剩下的部分。
      例如「拼」= <b>p</b>（声母）+ <b>in</b>（韵母）；「双」= <b>sh</b>（声母）+ <b>uang</b>（韵母）。</p>
      <p>全拼要打很多键（双 = shuang，6 键）。<b>${scheme.name}</b>把每个韵母也放到一个键上，
      于是任何音节都只要两键：第一键声母、第二键韵母。「双」= 先按 U（sh）再按 L（uang）。</p>
      <p>特殊：${spec ? spec + '；' : ''}${zero}</p>`,
  };
}

// ================= 渲染：方案库页（全信息层）=================
// env: { current: () => scheme, applyScheme: (id) => Promise, gotoPractice: (mode) => void,
//        buildKeyboard: (container, opts?, scheme?) => els, toast: (msg) => void }
export async function renderSchemeLibrary(box, env) {
  const cur = env.current();
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'schemelib-head';
  head.innerHTML = '<h1>方案库</h1><p class="sub">音码打声、形码打形——选一个开练。</p>';
  box.appendChild(head);

  box.appendChild(await buildCard(cur, env, SCHEMES[FLAGSHIP_ID], true));

  for (const g of GROUPS) {
    const sec = document.createElement('section');
    sec.className = 'schemegroup';
    sec.dataset.group = g.id;
    sec.innerHTML = `<h2>${g.title}<small>${g.blurb}</small></h2>`;
    const grid = document.createElement('div');
    grid.className = 'schemegrid';
    for (const id of g.ids) grid.appendChild(await buildCard(cur, env, SCHEMES[id], false));
    sec.appendChild(grid);
    box.appendChild(sec);
  }
}

async function buildCard(cur, env, s, flagship) {
  const card = document.createElement('article');
  card.className = 'scard' + (flagship ? ' flagship' : '') + (s.id === 'wubi86' ? ' degraded' : '');
  card.dataset.scheme = s.id;
  const isCur = s.id === cur.id;
  const pack = s.packId ? PACKS[s.packId] : null;
  const cached = s.packId ? (packState(s.packId) === 'ready' || await packCached(s.packId)) : false;

  // ① 名 + 范式标签（双拼加子标签）
  const tags = [s.paradigm === 'shape' ? '形码' : '音码'];
  if (s.id !== 'quanpin' && s.id !== 'zhuyin' && s.paradigm === 'phonetic') tags.push('双拼');
  const badge = flagship ? '<b class="flagbadge">旗舰 · 默认</b>' : '';
  const grayTag = s.id === 'wubi86' ? `<span class="formtag gray">${cardTagOf(s.id)}</span>` : '';

  // ④ 状态行 = 课程形态 + 数据状态
  const dataState = !pack ? '无需下载' : cached ? '已缓存 ✓' : `未下载 ~${pack.kb}KB`;
  const summary = progressSummary(s.id);
  const progress = flagship && summary ? `<p class="scard-progress">${summary}</p>` : (!flagship && summary ? `<span class="scard-sum"> · ${summary}</span>` : '');

  card.innerHTML = `
    <div class="scard-top">${badge}<b class="scard-name">${s.name}</b>${tags.map(t => `<span class="paratag">${t}</span>`).join('')}${grayTag}</div>
    <p class="scard-feat">${CARD_FEATURES[s.id]}</p>
    <div class="kbmini kb" aria-hidden="true"></div>
    <p class="scard-state"><span class="formtag">${courseFormOf(s.id)}</span><span class="datastate" data-pack="${s.packId || ''}">${dataState}</span>${progress}</p>
    <div class="scard-actions"></div>`;

  // ③ 迷你键盘预览（复用 buildKeyboard 缩略模式：注音显数字行、形码显字根角标）
  env.buildKeyboard(card.querySelector('.kbmini'), { preview: true }, s);

  // ⑤ 动作
  const acts = card.querySelector('.scard-actions');
  if (flagship && isCur) {
    acts.innerHTML = '<span class="inuse">使用中</span>';
    return card;
  }
  const go = document.createElement('button');
  go.className = 'btn ' + (flagship ? 'primary' : 'ghost');
  go.textContent = '切换开练';
  go.onclick = async () => {
    const ok = await env.applyScheme(s.id);
    if (ok === false) return;
    location.hash = s.id === 'wubi86' ? '#/course' : '#/practice'; // 五笔入口直达字根总表页（T5-D6）
  };
  acts.appendChild(go);
  if (pack && !cached) {
    const dl = document.createElement('button');
    dl.className = 'btn ghost';
    dl.textContent = `预下载 ~${pack.kb}KB`;
    dl.onclick = async () => {
      dl.disabled = true; dl.textContent = `正在下载 ~${pack.kb}KB…`;
      const r = await prefetchPacks([s.packId]);
      if (r.ok) {
        dl.textContent = '已缓存 ✓';
        const st = card.querySelector('.datastate');
        if (st) st.textContent = '已缓存 ✓';
        env.toast(`${pack.name}已缓存，离线可用`);
      } else {
        dl.disabled = false; dl.textContent = `预下载 ~${pack.kb}KB`;
        env.toast('下载失败——稍后重试');
      }
    };
    acts.appendChild(dl);
  }
  return card;
}

// ================= 渲染：顶栏方案芯片 + 分组弹层（快切层）=================
// env 另需 { hideModeBarOf?: noop } —— 弹层只做快切，全信息去方案库页（§5.2 两层分工）
export function initSchemeChip(env) {
  const chip = document.getElementById('schemeChip');
  const pop = document.getElementById('schemePop');
  const bubble = document.getElementById('chipBubble');
  if (!chip || !pop) return () => {};

  const isOpen = () => !pop.classList.contains('hidden');
  function open() {
    renderPop();
    pop.classList.remove('hidden');
    chip.setAttribute('aria-expanded', 'true');
    const first = /** @type {HTMLButtonElement|null} */ (pop.querySelector('button[data-scheme]'));
    if (first) first.focus();
  }
  function close(refocus = false) {
    if (!isOpen()) return;
    pop.classList.add('hidden');
    chip.setAttribute('aria-expanded', 'false');
    if (refocus) chip.focus(); // 无障碍：焦点归还芯片（§5.2）
  }
  const toggle = () => (isOpen() ? close(true) : open());

  function renderPop() {
    const cur = env.current();
    pop.innerHTML = GROUPS.map(g => `
      <div class="popgroup" role="group" aria-label="${g.title}">
        <span class="pophead">${g.title}</span>
        ${(g.id === 'phonetic' ? [FLAGSHIP_ID, ...g.ids] : g.ids).map(id => {
          const s = SCHEMES[id];
          return `<button data-scheme="${id}" role="menuitem" class="${id === cur.id ? 'cur' : ''}">
            ${id === cur.id ? '<i class="tick">✓</i>' : '<i class="tick"></i>'}${s.name}</button>`;
        }).join('')}
      </div>`).join('') +
      '<a class="poplib" href="#/schemes">进入方案库 →</a>';
  /** @type {NodeListOf<HTMLButtonElement>} */ (pop.querySelectorAll('button[data-scheme]')).forEach(b => {
      b.onclick = async () => {
        close(false);
        chip.focus();
        await env.applyScheme(b.dataset.scheme);
      };
    });
    const lib = /** @type {HTMLAnchorElement|null} */ (pop.querySelector('.poplib'));
    if (lib) lib.onclick = () => close(false);
  }

  chip.onclick = () => toggle();
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(true); }
  });
  document.addEventListener('pointerdown', (e) => {
    const t = /** @type {Node|null} */ (e.target);
    if (isOpen() && t && !pop.contains(t) && !chip.contains(t)) close(false);
  });
  // Alt+S 开关弹层：Alt 组合键不落入练习输入流（§5.2）
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyS') { e.preventDefault(); toggle(); }
  });

  // 首次引导：芯片一次性气泡（§5.3）。记 flag 于显示时，任意导航/点击即消
  const set = store.getSettings();
  if (!set.chipTipSeen && bubble) {
    bubble.classList.add('show');
    set.chipTipSeen = true;
    store.setSettings(set);
    const dismiss = () => { bubble.classList.remove('show'); };
    document.addEventListener('pointerdown', dismiss, { once: true });
    addEventListener('hashchange', dismiss, { once: true });
  }

  // 芯片文案随当前方案
  return () => {
    const cur = env.current();
    chip.querySelector('.chipname').textContent = cur.name;
    if (isOpen()) renderPop();
  };
}
