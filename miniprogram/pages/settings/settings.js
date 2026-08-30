// 设置：提示档/显示开关/键盘通道/重置（=web 版 §设置 + 小程序特有的键盘通道与错键惩罚）
const { getScheme } = require('../../utils/schemes.js');
const { store } = require('../../utils/store.js');

Page({
  data: {},

  onShow() {
    const s = store.getSettings();
    const scheme = getScheme(s.scheme || 'flypy');
    this.setData({
      hintLevel: s.hintLevel || 'full',
      showPy: s.showPy !== false,
      showCode: s.showCode !== false,
      hlKeys: s.hlKeys !== false,
      sound: !!s.sound,
      keyImpact: s.keyImpact !== false,
      wrongPunish: !!s.wrongPunish,
      keyboardMode: s.keyboardMode === 'system' ? 'system' : 'vkb',
      schemeLabel: `${scheme.name} · ${scheme.paradigm === 'shape' ? '形码' : '音码'}`,
    });
  },

  patch(key, val) {
    const s = store.getSettings();
    s[key] = val;
    store.setSettings(s);
  },

  onHint(e) { this.patch('hintLevel', e.currentTarget.dataset.v); this.setData({ hintLevel: e.currentTarget.dataset.v }); },
  onPy(e) { this.patch('showPy', e.detail.value); this.setData({ showPy: e.detail.value }); },
  onCode(e) { this.patch('showCode', e.detail.value); this.setData({ showCode: e.detail.value }); },
  onHl(e) { this.patch('hlKeys', e.detail.value); this.setData({ hlKeys: e.detail.value }); },
  onSound(e) { this.patch('sound', e.detail.value); this.setData({ sound: e.detail.value }); },
  onImpact(e) { this.patch('keyImpact', e.detail.value); this.setData({ keyImpact: e.detail.value }); },
  onPunish(e) { this.patch('wrongPunish', e.detail.value); this.setData({ wrongPunish: e.detail.value }); },
  onKbMode(e) {
    const v = e.currentTarget.dataset.v === '1' ? 'system' : 'vkb';
    this.patch('keyboardMode', v);
    this.setData({ keyboardMode: v });
  },

  goSchemes() { wx.navigateTo({ url: '/pages/schemes/schemes' }); },

  resetAll() {
    wx.showModal({
      title: '重置全部本地数据？',
      content: '词库、统计、错词本都会清空，且不可恢复。',
      confirmColor: '#FF1744',
      success: (res) => {
        if (!res.confirm) return;
        store.resetAll();
        wx.showToast({ title: '已重置', icon: 'success' });
        this.onShow();
      },
    });
  },
});
