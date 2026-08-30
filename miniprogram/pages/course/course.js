// 课程页：五阶数据驱动（§4.1）+ 七日挑战 + 键位图/热力/字根认知/操练。
// 与 web 版 js/app.js §课程 对齐：进度 per-scheme（course.<scheme>），
// 降级形态（五笔 86 字根总表页）不入七日挑战。
const { getScheme } = require('../../utils/schemes.js');
const { store } = require('../../utils/store.js');
const { courseOf, challengeMatch } = require('../../utils/courses.js');
const { PACKS } = require('../../utils/packs.js');
const { buildRows, heatLevel } = require('../../utils/ui.js');

Page({
  data: {
    stages: [], stageIdx: 0,
    challenge: null,
    vm: null,            // 当前阶视图模型
    kbRows: [], heat: {}, keyDetail: '',
    packMissing: false,
  },

  async onShow() {
    const settings = store.getSettings();
    this.scheme = getScheme(settings.scheme || 'flypy');
    if (this.scheme.packId && !this.scheme.table) {
      try { await this.scheme.activate(); } catch { this.setData({ packMissing: true }); return; }
    }
    this.setData({ kbRows: buildRows(this.scheme), packMissing: false });
    this.stageIdx = store.getCourse(this.scheme.id).stage || 0;
    this.renderAll();
  },

  renderAll() {
    const sid = this.scheme.id;
    const course = courseOf(sid);
    this.setData({
      stages: course.stages.map((st, i) => ({ name: st.name, sub: st.sub || '' })),
      stageIdx: this.stageIdx,
      challenge: this.challengeVM(course),
      isRootTable: course.form === 'rootTable',
    });
    this.renderStage(course.stages[this.stageIdx] || course.stages[0]);
  },

  // 七日挑战状态（谓词读范式课程数据；降级形态不入挑战）
  challengeVM(course) {
    if (course.noChallenge) return null;
    const ch = store.getChallenge();
    if (!ch) return { started: false, sub: course.challengeSub };
    const sessions = store.getSessions();
    const days = store.getDays();
    const items = course.challenge.map((item, i) => {
      const day = new Date(ch.start + i * 86400000).toDateString();
      const done = i === 0 ? !!days[day]?.course
        : sessions.some(s => new Date(s.ts).toDateString() === day && challengeMatch(item.match, s.mode, course));
      return { tag: item.tag, label: item.label, done };
    });
    const today = Math.min(6, Math.floor((Date.now() - ch.start) / 86400000));
    return { started: true, today, items, marks: items.map(d => d.done ? '✓' : '·').join(' ') };
  },

  onStage(e) {
    this.stageIdx = e.currentTarget.dataset.i;
    store.setCourse(this.scheme.id, { stage: this.stageIdx });
    const course = courseOf(this.scheme.id);
    this.setData({ stageIdx: this.stageIdx });
    this.renderStage(course.stages[this.stageIdx]);
  },

  startChallenge() {
    const course = courseOf(this.scheme.id);
    store.startChallenge();
    wx.showToast({ title: `七日挑战开始！今天：${course.challenge[0].label}`, icon: 'none', duration: 2600 });
    this.setData({ challenge: this.challengeVM(course) });
  },

  // ---- 阶段视图模型 ----
  renderStage(st) {
    if (st.kind === 'rootTable') return this.vmRootTable(st);
    if (st.kind === 'keys') return this.vmKeys(st);
    if (st.kind === 'drill') return this.vmDrill(st);
    if (st.kind === 'mistakes') return this.vmMistakes(st);
    this.setData({
      vm: { kind: 'practice', name: st.name, body: st.body, mode: (st.pools || []).join('+') + (st.seq ? '@' + st.seq : '') },
      keyDetail: '', heat: {},
    });
  },

  vmMistakes(st) {
    const n = store.getMistakes(this.scheme.id).length;
    this.setData({ vm: { kind: 'mistakes', name: st.name, body: st.body.replace('{n}', String(n)), n }, keyDetail: '', heat: {} });
  },

  vmKeys(st) {
    store.markCourseSeen();
    if (st.view === 'heat') {
      this.setData({
        vm: { kind: 'heat', name: st.name, body: st.body },
        heat: this.heatMap(), keyDetail: '',
      });
      return;
    }
    if (st.view === 'roots') {
      this.setData({
        vm: { kind: 'roots', name: st.name, body: st.body, letters: true, groups: this.chipGroups(st.groups) },
        heat: {}, keyDetail: '点击任意键或下方字母，查看该字母的字根、辅助字形与例字。',
      });
      this._letters = st.letters || {};
      return;
    }
    // map：键位全景
    const spec = Object.entries(this.scheme.SM_NAME || {});
    const specLine = spec.length
      ? `翘舌声母换位见朱砂描边键（${this.scheme.name}：${spec.map(([k, v]) => `${v}→${k.toUpperCase()}`).join('、')}）。`
      : '全拼的码就是拼音本身，键位即标准键盘。';
    this.setData({
      vm: { kind: 'map', name: `${this.scheme.name}键位全景`, body: st.body || `大字是物理键位，小字是该键在当前方案下承载的韵母。${specLine}点击任意键查看说明。` },
      heat: {}, keyDetail: '',
    });
  },

  vmRootTable(st) {
    const course = courseOf(this.scheme.id);
    this.setData({
      vm: { kind: 'roots', name: st.name, body: `${st.sub || ''} ${st.body || ''}`.trim(), letters: false, groups: this.chipGroups(course.zones), note: '本方案无五阶课程、无间隔重复操练，也不入七日挑战——先认字根，再自由练习。' },
      heat: {}, keyDetail: '点击任意键或下方键位，查看键上字根与例字。',
    });
    this._roots = course.roots || {};
  },

  chipGroups(groups) {
    return (groups || []).map(g => ({
      label: g.label, desc: g.desc || '',
      keys: g.keys.map(k => {
        const lab = this.scheme.layout.keyLabel(k);
        return { key: k, main: lab.main, sub: lab.sub || '' };
      }),
    }));
  },

  heatMap() {
    const ks = store.getKeyStats(this.scheme.id);
    const heat = {};
    for (const [k, [hit, err]] of Object.entries(ks)) {
      const lv = heatLevel(hit, err);
      if (lv) heat[k] = lv;
    }
    return heat;
  },

  // ---- 交互 ----
  onMapKey(e) {
    const ch = (e.detail && e.detail.key) || (e.currentTarget && e.currentTarget.dataset.key);
    const vm = this.data.vm;
    if (!vm) return;
    if (vm.kind === 'heat') {
      wx.navigateTo({ url: `/pages/practice/practice?mode=weak:${ch}` });
      return;
    }
    if (vm.kind === 'map') {
      const lab = this.scheme.layout.keyLabel(ch);
      const spec = this.scheme.layout.specialOf(ch);
      this.setData({ keyDetail: lab.title || [spec ? `声母 ${spec}` : '', lab.sub ? `韵母 ${lab.sub}` : ''].filter(Boolean).join('｜') || `键 ${lab.main}` });
      return;
    }
    if (vm.kind === 'roots') this.pickRoot(ch);
  },

  onChipKey(e) { this.onMapKey({ detail: { key: e.currentTarget.dataset.key } }); },

  pickRoot(ch) {
    const vm = this.data.vm;
    const info = vm.letters ? (this._letters || {})[ch] : (this._roots || {})[ch];
    if (!info) {
      this.setData({ keyDetail: ch === 'z' ? 'Z 学习键 · 不参与取码' : `键 ${ch.toUpperCase()}` });
      return;
    }
    const ex = (info.ex || []).map(w => {
      const c = this.scheme.codeOf({ word: w });
      return `${w}${c ? '（' + c + '）' : ''}`;
    }).join('、');
    const lines = [];
    if (vm.letters) {
      const lab = this.scheme.layout.keyLabel(ch);
      lines.push(`${lab.main} · ${info.name}${info.cat ? `（${info.cat}类）` : ''}`);
      if (info.note) lines.push(info.note);
      if (info.forms) lines.push(`辅助字形：${info.forms}`);
    } else {
      lines.push(`${ch.toUpperCase()} · ${info.zone}区${info.pos}位`);
      lines.push(`键上字根：${info.roots}`);
    }
    if (ex) lines.push(`例字（码随当前方案派生）：${ex}`);
    this.setData({ keyDetail: lines.join('\n') });
  },

  // ---- 操练（kind='drill'）----
  vmDrill(st) {
    const due = store.srsDueKeys(this.scheme.id);
    const unitName = st.unit === 'syllable' ? '音节' : st.unit === 'letter' ? '字母' : '键';
    const groups = [];
    if (st.unit === 'syllable') {
      groups.push({ label: '', keys: (st.items || []).map(syl => ({ id: syl, main: syl.toUpperCase(), sub: '', due: due.includes(syl) })) });
    } else if (st.unit === 'symbol' || st.unit === 'letter') {
      for (const g of st.groups || []) {
        groups.push({
          label: g.label,
          keys: g.keys.map(k => {
            const lab = this.scheme.layout.keyLabel(k);
            return { id: k, main: lab.main, sub: lab.sub || '', due: due.includes(k) };
          }),
        });
      }
    } else {
      const byKey = {};
      for (const [ym, k] of Object.entries(this.scheme.YM || {})) (byKey[k] ||= []).push(ym);
      const keys = [...this.scheme.layout.ROWS.join(''), ...this.scheme.layout.extraKeys];
      const flat = [];
      for (const k of keys) {
        const yms = byKey[k] || [];
        if (!yms.length && !this.scheme.layout.specialOf(k)) continue;
        flat.push({ id: k, main: k === ';' ? ';' : k.toUpperCase(), sub: yms.join('/') || '声母位', due: due.includes(k) });
      }
      groups.push({ label: '', keys: flat });
    }
    this.setData({
      vm: { kind: 'drill', name: st.name, body: st.body, dueCount: due.length, unitName, groups, empty: !groups.some(g => g.keys.length) },
      heat: {}, keyDetail: '',
    });
    this._drillStage = st;
  },

  drillDue() {
    const due = store.srsDueKeys(this.scheme.id);
    if (!due.length) return;
    this.goDrill(due[0], due);
  },

  drillUnit(e) { this.goDrill(e.currentTarget.dataset.id); },

  goDrill(first, seq) {
    getApp().drill = { st: this._drillStage, first, seq };
    wx.navigateTo({ url: '/pages/practice/practice?mode=finaldrill' });
  },

  // ---- 直达按钮 ----
  goStagePractice(e) { wx.navigateTo({ url: `/pages/practice/practice?mode=${e.currentTarget.dataset.mode}` }); },
  goMistakes() { wx.navigateTo({ url: '/pages/practice/practice?mode=mistakes' }); },
  goFree() { wx.navigateTo({ url: '/pages/practice/practice?mode=chars' }); },
  retryPack() { this.onShow(); },
});
