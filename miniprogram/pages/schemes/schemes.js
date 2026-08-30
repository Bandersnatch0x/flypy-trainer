// 方案库：旗舰大卡 + 音码/形码分组（§5.1 纯逻辑复用 schemes-ui；卡面在 wxml 重建）。
// 切换即改 settings.scheme；带包方案切换时惰性接载（随包分发，恒就绪）。
const { SCHEMES } = require('../../utils/schemes.js');
const { store } = require('../../utils/store.js');
const { GROUPS, CARD_FEATURES, courseFormOf, cardTagOf, progressSummary, FLAGSHIP_ID } = require('../../utils/schemes-ui.js');
const { paradigmTags } = require('../../utils/ui.js');

function cardOf(id, curId) {
  const s = SCHEMES[id];
  return {
    id, name: s.name, tags: paradigmTags(s),
    feat: CARD_FEATURES[id],
    form: courseFormOf(id),
    grayTag: cardTagOf(id),
    summary: progressSummary(id),
    dataState: s.packId ? '随包内置 ✓' : '无需下载',
    isCur: id === curId,
    degraded: false,
  };
}

Page({
  data: {},

  onShow() {
    const curId = store.getSettings().scheme || 'flypy';
    this.setData({
      flagship: cardOf(FLAGSHIP_ID, curId),
      groups: GROUPS.map(g => ({
        title: g.title, blurb: g.blurb,
        cards: g.ids.map(id => cardOf(id, curId)),
      })),
    });
  },

  async applyScheme(e) {
    const id = e.currentTarget.dataset.id;
    const s = store.getSettings();
    s.scheme = id;
    store.setSettings(s);
    const sc = SCHEMES[id];
    if (sc.packId && !sc.table) {
      wx.showLoading({ title: '正在准备资料包…' });
      try { await sc.activate(); } catch { /* 随包分发极少失败；练习页会再兜底 */ }
      wx.hideLoading();
    }
    wx.showToast({ title: `已切换：${sc.name}`, icon: 'none' });
    this.onShow();
    if (id === 'wubi86') wx.switchTab({ url: '/pages/course/course' }); // 五笔入口直达字根总表页（tab 页）
    else wx.navigateTo({ url: '/pages/practice/practice?mode=chars' });
  },
});
