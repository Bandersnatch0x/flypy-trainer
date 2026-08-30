// 错词本：按当前方案重派展示码（不存码快照，§3.6）；强化练习 / 清空 / Rime 导出。
const { getScheme, SCHEMES } = require('../../utils/schemes.js');
const { store } = require('../../utils/store.js');

Page({
  data: {},

  onShow() { this.render(); },

  render() {
    const settings = store.getSettings();
    this.scheme = getScheme(settings.scheme || 'flypy');
    const mk = store.getMistakes(this.scheme.id);
    this.setData({
      schemeName: this.scheme.name,
      empty: !mk.length,
      list: mk.slice(0, 60).map(m => ({
        word: m.word,
        shown: this.scheme.codeOf({ word: m.word, py: m.py, srcCode: m.srcCode, srcScheme: m.srcScheme }) || m.py || '—',
        n: m.n,
      })),
    });
  },

  train() { wx.navigateTo({ url: '/pages/practice/practice?mode=mistakes' }); },

  clear() {
    wx.showModal({
      title: '清空错词本？', content: `清空「${this.scheme.name}」的错词记录。`,
      success: (res) => { if (res.confirm) { store.clearMistakes(this.scheme.id); this.render(); } },
    });
  },

  // Rime 自定义短语导出：码恒为小鹤双拼；写本机文件后经微信分享发出
  exportRime() {
    const fly = SCHEMES.flypy;
    const mk = store.getMistakes(this.scheme.id);
    const custom = store.getLibs().find(l => l.name === '自定义词单');
    const lines = ['# Rime 自定义短语（鹤练导出 · 固定小鹤码）',
      '# 格式：词<TAB>码<TAB>权重；放入 rime 配置并挂载 custom_phrase',
      '# 注：导出码恒为小鹤双拼，与你当前练习方案无关'];
    const seen = new Set();
    for (const e of [...mk, ...(custom?.entries || [])]) {
      const code = fly.codeOf(e);
      if (!code || seen.has(e.word)) continue;
      seen.add(e.word);
      lines.push(`${e.word}\t${code}\t1`);
    }
    if (lines.length <= 3) { wx.showToast({ title: '没有可导出的词条', icon: 'none' }); return; }
    const filePath = `${wx.env.USER_DATA_PATH}/helian_rime_phrase.txt`;
    try {
      wx.getFileSystemManager().writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
    } catch {
      wx.showToast({ title: '导出失败', icon: 'none' });
      return;
    }
    wx.shareFileMessage({
      filePath,
      fileName: 'helian_rime_phrase.txt',
      success: () => {},
      fail: () => wx.showToast({ title: '分享取消或失败', icon: 'none' }),
    });
  },
});
