// 我的：功能入口 + 关于 + 隐私口径（无账号、无上传）
const { getScheme } = require('../../utils/schemes.js');
const { store } = require('../../utils/store.js');

Page({
  data: {},

  onShow() {
    const s = store.getSettings();
    this.setData({ schemeName: getScheme(s.scheme || 'flypy').name });
  },

  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }); },
  goPractice() { wx.navigateTo({ url: '/pages/practice/practice?mode=chars' }); },

  onShareAppMessage() {
    return { title: '鹤练 · 双拼打字练习', path: '/pages/home/home' };
  },
});
