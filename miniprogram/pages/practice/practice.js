// 练习页：引擎快照 → 渲染；自绘键盘 + 系统键盘双通道输入（设置 keyboardMode）。
const { getScheme } = require('../../utils/schemes.js');
const { store } = require('../../utils/store.js');
const engine = require('../../utils/engine.js');
const { PACKS } = require('../../utils/packs.js');
const { courseOf } = require('../../utils/courses.js');
const { hiddenModesFor } = require('../../utils/schemes-ui.js');
const { buildRows, streakOf, MODES } = require('../../utils/ui.js');
const { planUnitAt } = require('../../utils/jyutping.js');

function charStatesOf(word, plan, pos, total) {
  const groups = (plan && plan.groups) || [];
  const chars = [...String(word)];
  const out = [];
  if (groups.length === chars.length) {
    for (let i = 0; i < chars.length; i++) {
      const g = groups[i];
      const st = pos >= g.start + g.len ? 'done' : (pos >= g.start ? 'cur' : 'wait');
      out.push({ ch: chars[i], st });
    }
  } else {
    const doneCount = total ? Math.floor((pos / total) * chars.length) : 0;
    chars.forEach((ch, i) => out.push({ ch, st: i < doneCount ? 'done' : (i === doneCount ? 'cur' : 'wait') }));
  }
  return out;
}

Page({
  data: {
    modes: [], mode: 'chars',
    active: false, emptyMsg: '', packMissing: false,
    charStates: [], py: '', display: '', codeChars: [],
    fb: '', steps: [], prog: 0,
    timeStr: '0:00', speed: '0', acc: '100%', combo: 0,
    curKey: '', nextKey: '', pressedKey: '', errKey: '',
    kbRows: [], keyboardMode: 'vkb', sysFocus: false,
    soundOn: false, showCode: true, wrongPunish: false, keyImpact: true,
    result: null,
  },

  onLoad(opts) {
    this.pendingMode = opts.mode || 'chars';
    this.pendingDrill = getApp().drill || null; // 课程页操练入口：{st, first, seq}
    if (this.pendingDrill) this.pendingMode = 'finaldrill';
    this.timer = null;
  },

  onShow() {
    const settings = store.getSettings();
    const schemeId = settings.scheme || 'flypy';
    if (this.scheme && this.scheme.id === schemeId && this._shown) {
      this.setData({
        soundOn: !!settings.sound, showCode: settings.showCode !== false,
        wrongPunish: !!settings.wrongPunish, keyImpact: settings.keyImpact !== false,
        keyboardMode: settings.keyboardMode === 'system' ? 'system' : 'vkb',
        sysFocus: settings.keyboardMode === 'system',
      });
      if (this.data.active) this.render();
      return;
    }
    this.init(schemeId);
  },

  onUnload() { if (this.timer) clearInterval(this.timer); },
  onHide() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  async init(schemeId) {
    this._shown = true;
    const settings = store.getSettings();
    this.scheme = getScheme(schemeId);
    engine.setScheme(this.scheme);
    engine.setToast(t => wx.showToast({ title: t, icon: 'none' }));
    let packMissing = false;
    if ((this.scheme.packId && !this.scheme.table) || (this.scheme.coursePackId && !this.scheme.courseReady)) {
      wx.showLoading({ title: `正在准备${PACKS[this.scheme.packId].name}…` });
      try { await this.scheme.activate(); } catch { packMissing = true; }
      wx.hideLoading();
    }
    this.setData({
      kbRows: buildRows(this.scheme),
      packMissing,
      soundOn: !!settings.sound, showCode: settings.showCode !== false,
      wrongPunish: !!settings.wrongPunish, keyImpact: settings.keyImpact !== false,
      keyboardMode: settings.keyboardMode === 'system' ? 'system' : 'vkb',
      sysFocus: settings.keyboardMode === 'system',
      schemeName: this.scheme.name,
    });
    this.buildModes();
    this.start(this.pendingMode || 'chars');
  },

  buildModes() {
    const hidden = hiddenModesFor(this.scheme); // 形码隐藏二字词/多字词/整句（§5.4）
    const list = [];
    for (const m of MODES) {
      if (hidden.includes(m.mode)) continue;
      list.push(m);
      if (m.mode === 'mixed') { // 易混对插在混练后
        courseOf(this.scheme.id).confus.forEach((pair, i) => {
          list.push({ mode: `confus:${i}`, label: `易混 ${pair.label}` });
        });
      }
    }
    if (this.pendingMode && this.pendingMode.startsWith('weak:') && !list.some(m => m.mode === this.pendingMode)) {
      list.push({ mode: this.pendingMode, label: `弱键 ${this.pendingMode.slice(5).toUpperCase()}` });
    }
    this.setData({ modes: list });
  },

  onMode(e) { this.start(e.currentTarget.dataset.mode); },

  start(mode) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    let r;
    if (mode === 'finaldrill' && this.pendingDrill) {
      const d = this.pendingDrill;
      this.pendingDrill = null;
      getApp().drill = null;
      r = engine.startDrill(d.st, d.first, d.seq);
    } else {
      r = engine.startSession(mode);
    }
    if (r.status !== 'ok') {
      this.setData({ mode, active: false, result: null, emptyMsg: this.emptyMsg(r.status), fb: '', curKey: '', nextKey: '', prog: 0 });
      return;
    }
    this.setData({ mode, active: true, result: null, emptyMsg: '' });
    this.render();
    this.timer = setInterval(() => this.tick(), 500);
  },

  emptyMsg(status) {
    const mode = this.data.mode;
    if (this.scheme.packId && !this.scheme.table) return `${PACKS[this.scheme.packId].name}未就绪 —— 稍后可点按重试`;
    if (mode === 'personal' && status === 'filtered' && this.scheme.id === 'zhuyin') return '导入词暂无声调数据 —— 注音按词级声调表出题；可切回拼音方案练导入词';
    if (mode === 'personal') return '还没有导入词库 —— 去「导入」页添加你的词库，或换别的模式';
    if (mode.startsWith('weak:')) return '该键还没有练习数据 —— 先练几轮';
    if (mode === 'mistakes') return '错词本是空的 —— 先去练一轮';
    if (status === 'filtered' && this.scheme.paradigm === 'shape') return `${this.scheme.name}仅取单字出题 —— 多字词与整句不取题，换个模式试试`;
    return '这个模式在当前方案下暂无可练内容 —— 换别的模式试试';
  },

  retryPack() { this.init(this.scheme.id); },

  // ---- 输入通道 ----
  onKey(e) { this.handlePress(e.detail.key); },

  onSysInput(e) {
    const v = e.detail.value || '';
    for (const ch of v) this.handlePress(ch);
    return ''; // 清空隐藏输入，保持逐字符捕获
  },

  onSysBlur() { this.setData({ sysFocus: false }); },
  refocusSys() { if (this.data.keyboardMode === 'system') this.setData({ sysFocus: true }); },

  handlePress(ch) {
    const r = engine.press(ch);
    if (!r) return;
    if (r.ok) {
      this.setData({ pressedKey: this.data.keyImpact ? ch : '', errKey: '', fb: '' });
      if (this.data.keyImpact) setTimeout(() => { if (this.data.pressedKey === ch) this.setData({ pressedKey: '' }); }, 90);
      if (r.sessionDone) { this.showResult(r.result); return; }
      this.render();
    } else {
      if (this.data.keyImpact) wx.vibrateShort({ type: 'light', fail: () => {} });
      this.setData({ errKey: ch, fb: r.feedback });
      setTimeout(() => { if (this.data.errKey === ch) this.setData({ errKey: '' }); }, 130);
      if (r.cleared) this.render(); else this.renderMetrics();
    }
    if (this.data.keyboardMode === 'system') this.setData({ sysFocus: true });
  },

  // ---- 渲染 ----
  render() {
    const snap = engine.snapshot();
    if (!snap.active) return;
    const it = snap.current;
    const settings = store.getSettings();
    const hl = (settings.hintLevel || 'full') !== 'none' && settings.hlKeys !== false;
    const at = planUnitAt(snap.planKeys, snap.pos);
    const curUnit = at && at.unit;
    const nxtUnit = at && snap.planKeys[at.index + 1];
    this.setData({
      charStates: charStatesOf(it.word, it.plan, snap.pos, snap.expected.length),
      py: it.py.replace(/\s+/g, ' '),
      display: it.display,
      word: it.word,
      codeChars: [...snap.expected].map((c, i) => ({ ch: c.toUpperCase(), st: i < snap.pos ? 'done' : (i === snap.pos ? 'cur' : 'wait') })),
      steps: snap.planKeys.map(k => k.note ? `${k.label}（${k.note}）` : k.label),
      curKey: hl && curUnit ? curUnit.key : '',
      nextKey: hl && nxtUnit && (!curUnit || nxtUnit.key !== curUnit.key) ? nxtUnit.key : '',
      combo: snap.combo,
      prog: this.data.mode === 'sprint' ? this.data.prog : Math.round((snap.idx / snap.queueLength) * 100),
      done: this.data.mode === 'sprint' ? String(snap.doneWords) : `${snap.idx}/${snap.queueLength}`,
      timeStr: this.data.mode === 'sprint' ? `0:${engine.SPRINT_SECS}` : this.data.timeStr,
    });
    this.renderMetrics();
  },

  renderMetrics() {
    const snap = engine.snapshot();
    this.setData({ acc: snap.acc + '%', combo: snap.combo });
  },

  tick() {
    const snap = engine.snapshot();
    if (!snap.active) return;
    const total = snap.correctKeys + snap.wrongKeys;
    if (this.data.mode === 'sprint') {
      const left = engine.sprintLeft();
      this.setData({
        timeStr: `0:${String(left).padStart(2, '0')}`,
        prog: Math.round(((engine.SPRINT_SECS - left) / engine.SPRINT_SECS) * 100),
      });
      if (left <= 0) { this.showResult(engine.timeUp()); return; }
      if (snap.startTime) this.setData({ speed: String(Math.round(total / ((Date.now() - snap.startTime) / 60000))) });
    } else if (snap.startTime) {
      const el = Math.floor((Date.now() - snap.startTime) / 1000);
      this.setData({
        timeStr: `${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`,
        speed: String(Math.round(total / ((Date.now() - snap.startTime) / 60000))),
      });
    }
  },

  showResult(result) {
    if (!result) return;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.setData({
      result,
      active: false,
      curKey: '', nextKey: '',
      resTime: `${Math.floor(result.secs / 60)}:${String(result.secs % 60).padStart(2, '0')}`,
    });
  },

  again() { this.start(this.data.mode); },

  endSession() {
    const snap = engine.snapshot();
    if (snap.active && snap.startTime) { this.showResult(engine.finish()); return; }
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
  },

  // ---- fn 行开关 ----
  toggleCode() {
    const s = store.getSettings();
    s.showCode = !(s.showCode !== false);
    store.setSettings(s);
    this.setData({ showCode: s.showCode });
  },
  toggleSound() {
    const s = store.getSettings();
    s.sound = !s.sound;
    store.setSettings(s);
    this.setData({ soundOn: s.sound });
  },
  togglePunish() {
    const s = store.getSettings();
    s.wrongPunish = !s.wrongPunish;
    store.setSettings(s);
    this.setData({ wrongPunish: s.wrongPunish });
    wx.showToast({ title: s.wrongPunish ? '错键整段清空：开' : '错键标红续打', icon: 'none' });
  },
  toggleKbMode() {
    const s = store.getSettings();
    s.keyboardMode = s.keyboardMode === 'system' ? 'vkb' : 'system';
    store.setSettings(s);
    this.setData({ keyboardMode: s.keyboardMode, sysFocus: s.keyboardMode === 'system' });
  },

  goHome() { wx.switchTab({ url: '/pages/home/home' }); },

  // ---- 分享：原生转发 + canvas 2d 海报存相册（§D1.2）----
  onShareAppMessage() {
    const r = this.data.result;
    const name = this.scheme ? this.scheme.name : '双拼';
    return r
      ? { title: `鹤练 · ${name}一轮：准确率 ${r.acc}%，${r.kpm} 键/分`, path: '/pages/home/home' }
      : { title: '鹤练 · 双拼打字练习', path: '/pages/home/home' };
  },

  savePoster() {
    const r = this.data.result;
    if (!r) return;
    wx.createSelectorQuery().select('#posterCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = res && res[0] && res[0].node;
        if (!node) { wx.showToast({ title: '画布初始化失败', icon: 'none' }); return; }
        this.drawPoster(node, r);
        wx.canvasToTempFilePath({
          canvas: node,
          success: (tmp) => this.savePosterFile(tmp.tempFilePath),
          fail: () => wx.showToast({ title: '海报生成失败', icon: 'none' }),
        });
      });
  },

  // 复刻 web js/share.js 绘制；去掉外链文案，尺寸与配色一致
  drawPoster(canvas, r) {
    canvas.width = 900; canvas.height = 500;
    const x = canvas.getContext('2d');
    x.fillStyle = '#101014'; x.fillRect(0, 0, 900, 500);
    x.strokeStyle = 'rgba(255,255,255,0.08)'; x.lineWidth = 2; x.strokeRect(24, 24, 852, 452);
    x.fillStyle = '#D96C4F'; x.beginPath(); x.arc(70, 84, 10, 0, 7); x.fill();
    x.fillStyle = '#EDEDEF'; x.font = '44px serif';
    x.fillText('鹤练', 96, 100);
    x.fillStyle = '#8B8B93'; x.font = '20px sans-serif';
    x.fillText(`${this.scheme.name} · ${new Date().toLocaleDateString('zh-CN')}`, 96, 136);
    x.fillStyle = '#EDEDEF'; x.font = '120px monospace';
    x.fillText(`${r.acc}%`, 70, 300);
    x.fillStyle = '#8B8B93'; x.font = '22px sans-serif';
    x.fillText('准确率', 70, 340);
    x.fillStyle = '#7FA98C'; x.font = '72px monospace';
    x.fillText(`${r.kpm}`, 400, 292);
    x.fillStyle = '#8B8B93'; x.font = '22px sans-serif';
    x.fillText('键/分', 400, 340);
    x.fillStyle = '#EDEDEF'; x.font = '72px monospace';
    x.fillText(`${r.words}`, 620, 292);
    x.fillStyle = '#8B8B93'; x.font = '22px sans-serif';
    x.fillText(`词 · ${Math.floor(r.secs / 60)}分${r.secs % 60}秒`, 620, 340);
    const streak = streakOf();
    x.fillStyle = '#8B8B93'; x.font = '20px sans-serif';
    x.fillText(streak ? `已连续练习 ${streak} 天 · 鹤练小程序` : '鹤练小程序', 70, 430);
  },

  // 隐私授权（相册项）→ 保存；拒绝后引导去设置页开启
  savePosterFile(path) {
    const doSave = () => wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (e) => this.albumDenied(e),
    });
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({ success: doSave, fail: () => this.albumDenied({ errMsg: 'privacy deny' }) });
    } else {
      doSave();
    }
  },

  albumDenied(e) {
    const msg = (e && e.errMsg) || '';
    if (msg.includes('auth deny') || msg.includes('authorize') || msg.includes('privacy')) {
      wx.showModal({
        title: '需要相册权限',
        content: '保存海报需要允许「保存到相册」，去设置页开启？',
        confirmText: '去设置',
        success: (res) => { if (res.confirm) wx.openSetting(); },
      });
    } else {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
