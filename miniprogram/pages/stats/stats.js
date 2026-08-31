// 统计页：跨方案聚合连练/时长；PB 与徽章按方案过滤（§3.6）。
// 准确率曲线以条形近似（小程序无内联 SVG），日历/热力图与设计稿一致。
const { getScheme, SCHEMES } = require('../../utils/schemes.js');
const { store } = require('../../utils/store.js');
const { buildRows, streakOf, heatLevel } = require('../../utils/ui.js');

// 历史最长连练回扫窗口（天）。徽章阈值最高 7 天，一年足够覆盖。
const STREAK_SCAN_DAYS = 400;

// 历史最长连练：从今天向前逐日扫窗口。键一律由日期算术 + toDateString() 生成，
// 不回头解析 toDateString() 的产物 —— iOS 解析不了 "Mon Aug 31 2026" 这类格式。
function maxStreakFromDays(days) {
  let best = 0, cur = 0;
  const d = new Date();
  for (let i = 0; i < STREAK_SCAN_DAYS; i++) {
    if (days[d.toDateString()]) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
    d.setDate(d.getDate() - 1);
  }
  return best;
}

function computeBadges(sessions, streak, days, libsLen) {
  const keys = sessions.reduce((a, s) => a + s.total, 0);
  const bestStreak = Math.max(streak, maxStreakFromDays(days));
  return [
    ['首练', sessions.length >= 1, '完成第一次练习'],
    ['百词', keys >= 200, '累计 100 词'],
    ['千键', keys >= 1000, '累计 1000 键'],
    ['七日连练', bestStreak >= 7, '连续 7 天'],
    ['冲刺 80', sessions.some(s => s.mode === 'sprint' && s.kpm >= 80), '冲刺 80 键/分'],
    ['满分一轮', sessions.some(s => s.acc === 100 && s.total >= 20), '整轮零失误'],
    ['藏书', libsLen >= 1, '导入或订阅词库'],
  ];
}

Page({
  // 首帧默认值：keyboard 组件的 rows/heat 有类型约束，缺省会触发类型不兼容告警。
  data: { kbRows: [], heat: {} },

  onShow() {
    store.flushKeys();
    const settings = store.getSettings();
    const scheme = getScheme(settings.scheme || 'flypy');
    const sessions = store.getSessions();
    const mine = sessions.filter(s => (s.scheme || 'flypy') === scheme.id);
    const tot = sessions.reduce((a, s) => { a.secs += s.secs; a.keys += s.total; return a; }, { secs: 0, keys: 0 });
    const streak = streakOf(sessions);
    const days = store.getDays();

    // 365 天日历（跨方案聚合）
    const cal = [];
    const now = new Date();
    for (let i = 364; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const rec = days[d.toDateString()];
      cal.push({ lv: !rec ? 0 : rec.keys < 50 ? 1 : rec.keys < 150 ? 2 : 3 });
    }

    // 错键热力（按方案隔离）
    const ks = store.getKeyStats(scheme.id);
    const heat = {};
    const heatInfo = [];
    for (const [k, [hit, err]] of Object.entries(ks)) {
      if (!hit) continue;
      const lv = heatLevel(hit, err);
      if (lv) heat[k] = lv;
      heatInfo.push({ k: k.toUpperCase(), hit, err, rate: Math.round((err / hit) * 100) });
    }
    heatInfo.sort((a, b) => (b.err / b.hit) - (a.err / a.hit));

    // 准确率条（近 40 会话）
    const pts = sessions.slice(-40);
    const bars = pts.map(s => ({ h: Math.max(4, s.acc), good: s.acc >= 95 }));

    this.sessions = sessions;
    const limit = this.data.showAll ? 100 : 25;
    this.setData({
      schemeName: scheme.name,
      totMin: Math.round(tot.secs / 60),
      pbKpm: mine.reduce((a, s) => Math.max(a, s.kpm), 0),
      pbAcc: mine.reduce((a, s) => Math.max(a, s.acc), 0),
      streak,
      badges: computeBadges(mine, streak, days, store.getLibs().length).map(([name, got, desc]) => ({ name, got, desc })),
      cal,
      kbRows: buildRows(scheme),
      heat,
      heatTop: heatInfo.filter(x => x.err).slice(0, 5),
      bars,
      sparkNote: pts.length < 2 ? '完成两个会话后这里显示准确率曲线' : '',
      list: sessions.slice(-limit).reverse().map(s => ({
        time: new Date(s.ts).toLocaleString('zh-CN'),
        schemeName: getScheme(s.scheme || 'flypy').name,
        mode: s.mode.split('@')[0],
        acc: s.acc, kpm: s.kpm, secs: s.secs,
      })),
      totalCount: sessions.length,
      hasMore: sessions.length > 25 && !this.data.showAll,
      empty: !sessions.length,
    });
  },

  toggleMore() {
    this.setData({
      showAll: true,
      hasMore: false,
      list: (this.sessions || store.getSessions()).slice(-100).reverse().map(s => ({
        time: new Date(s.ts).toLocaleString('zh-CN'),
        schemeName: getScheme(s.scheme || 'flypy').name,
        mode: s.mode.split('@')[0],
        acc: s.acc, kpm: s.kpm, secs: s.secs,
      })),
    });
  },

  onHeatKey(e) {
    wx.navigateTo({ url: `/pages/practice/practice?mode=weak:${e.detail.key}` });
  },
});
