// 首页：模式选择 + 概览卡 + 易混对抗 + 词表集市入口（设计稿 02）
const { getScheme } = require('../../utils/schemes.js');
const { store } = require('../../utils/store.js');
const { courseOf } = require('../../utils/courses.js');
const { hiddenModesFor } = require('../../utils/schemes-ui.js');
const { streakOf, MODES } = require('../../utils/ui.js');

Page({
  data: {},

  onShow() {
    const settings = store.getSettings();
    const scheme = getScheme(settings.scheme || 'flypy');
    const sessions = store.getSessions();
    const mine = sessions.filter(s => (s.scheme || 'flypy') === scheme.id);
    const hidden = hiddenModesFor(scheme);
    const pbKpm = mine.reduce((a, s) => Math.max(a, s.kpm), 0);
    const streak = streakOf(sessions);
    this.setData({
      schemeName: scheme.name,
      streak,
      pbKpm,
      mistakes: store.getMistakes(scheme.id).length,
      modes: MODES.filter(m => !hidden.includes(m.mode)),
      confus: courseOf(scheme.id).confus.map((p, i) => ({ i, label: p.label })),
      isShape: scheme.paradigm === 'shape',
    });
  },

  go(e) {
    wx.navigateTo({ url: `/pages/practice/practice?mode=${e.currentTarget.dataset.mode}` });
  },

  goConfus(e) {
    wx.navigateTo({ url: `/pages/practice/practice?mode=confus:${e.currentTarget.dataset.i}` });
  },

  goSchemes() { wx.navigateTo({ url: '/pages/schemes/schemes' }); },
  goImport() { wx.navigateTo({ url: '/pages/import/import' }); },
});
