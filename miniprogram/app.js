// 鹤练小程序入口：一次性幂等迁移（§3.6）必须早于任何读取
const { migrate } = require('./utils/store.js');

App({
  onLaunch() {
    const r = migrate();
    if (r === 'data') {
      wx.showToast({ title: '历史本地数据已归入小鹤双拼名下', icon: 'none' });
    }
  },
});
