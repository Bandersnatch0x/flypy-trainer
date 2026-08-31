// 我的：功能入口 + 关于 + 隐私口径（无账号、无上传）
const { getScheme } = require('../../utils/schemes.js');
const { store } = require('../../utils/store.js');

Page({
  data: {},

  onShow() {
    const s = store.getSettings();
    this.setData({
      schemeName: getScheme(s.scheme || 'flypy').name,
      hasPrivacyContract: typeof wx.openPrivacyContract === 'function',
    });
  },

  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }); },
  goPractice() { wx.navigateTo({ url: '/pages/practice/practice?mode=chars' }); },

  // 隐私指引一律走 wx.openPrivacyContract 打开后台已备案那份：
  // 自写副本会与备案版本漂移，审核按不一致处理。基础库过低时隐藏入口。
  openPrivacy() {
    if (typeof wx.openPrivacyContract !== 'function') return;
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '暂时打不开，请稍后重试', icon: 'none' }),
    });
  },

  onShareAppMessage() {
    return { title: '鹤练 · 双拼打字练习', path: '/pages/home/home' };
  },
});
