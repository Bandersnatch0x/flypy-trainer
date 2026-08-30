// 导入页：聊天文件选取（chooseMessageFile）+ 词表集市订阅（随包）+ 自定义词单。
// 解析全部复用 web 版 parsers（sniffAndParse/parsePlain/mergeEntries），文件仅本机解析。
const { sniffAndParse, parsePlain, mergeEntries } = require('../../utils/parsers.js');
const { store } = require('../../utils/store.js');
const { getScheme } = require('../../utils/schemes.js');

const MARKET = [
  { file: 'programming', name: '编程术语', path: '../../data/wordpacks/programming.json' },
  { file: 'idioms', name: '常用成语', path: '../../data/wordpacks/idioms.json' },
];

Page({
  data: {},

  onShow() { this.render(); },

  render() {
    const libs = store.getLibs();
    const subs = store.getSubs();
    this.setData({
      libs: libs.map(l => ({ name: l.name, time: new Date(l.addedAt).toLocaleString('zh-CN'), n: l.entries.length })),
      market: MARKET.map(p => ({
        file: p.file, name: p.name,
        subbed: subs.includes(p.file) && libs.some(l => l.name === `集市·${p.name}`),
      })),
      poolLen: store.getPool().length,
      isShape: getScheme(store.getSettings().scheme || 'flypy').paradigm === 'shape',
    });
  },

  pickFile() {
    wx.chooseMessageFile({
      count: 5,
      type: 'file',
      // 不限后缀：四种格式（txt/csv/xlsx 文本导出/词库 yaml）靠嗅探识别（§D1.3）
      success: (res) => {
        const lines = [];
        const fsm = wx.getFileSystemManager();
        for (const f of res.tempFiles) {
          let text;
          try { text = fsm.readFileSync(f.path, 'utf8'); }
          catch { lines.push({ name: f.name, bad: true, msg: '读取失败' }); continue; }
          const r = sniffAndParse(f.name, text);
          if (!r.entries.length) {
            lines.push({ name: f.name, bad: true, msg: `未识别出有效词条（按 ${r.format} 尝试）` });
            continue;
          }
          const { entries, dropped } = mergeEntries([r.entries]);
          const res2 = store.addLib(f.name, entries);
          if (!res2.ok) { lines.push({ name: f.name, bad: true, msg: '存储已满，删除旧词库后重试' }); continue; }
          lines.push({
            name: f.name,
            msg: `${r.format} · 读入 ${r.entries.length} 条，去重后 ${entries.length} 条入库` +
              (dropped ? ` · ${dropped} 条无法切分拼音且无可用码未入库` : '') + ` · 练习池现有 ${res2.kept} 条`,
          });
        }
        lines.push({ note: true, msg: '形码方案（仓颉/速成/五笔 86）仅取导入词中的单字出题，多字词不取题。' });
        lines.push({ note: true, msg: '文件仅在你的设备内解析，未上传任何服务器。' });
        this.setData({ report: lines });
        this.render();
      },
      fail: () => {},
    });
  },

  subscribe(e) {
    const file = e.currentTarget.dataset.file;
    const p = MARKET.find(x => x.file === file);
    const subs = store.getSubs();
    if (subs.includes(file)) return;
    const pack = require(p.path);
    const { entries } = mergeEntries([pack.entries.map(({ w, p: py }) => ({ word: w, py, weight: 5 }))]);
    const r = store.addLib(`集市·${p.name}`, entries);
    if (r.ok) {
      store.setSubs([...subs, file]);
      const shapeNote = this.data.isShape ? ' · 形码仅取导入词中的单字' : '';
      wx.showToast({ title: `已订阅「${p.name}」，${entries.length} 条入库${shapeNote}`, icon: 'none', duration: 2600 });
      this.render();
    } else wx.showToast({ title: '存储已满，先删除旧词库', icon: 'none' });
  },

  onCustomInput(e) { this._custom = e.detail.value; },

  addCustom() {
    const text = (this._custom || '').trim();
    if (!text) return;
    const r = parsePlain(text);
    if (!r.entries.length) { wx.showToast({ title: '未解析出有效词条（格式：词 拼音）', icon: 'none' }); return; }
    const old = store.getLibs().find(l => l.name === '自定义词单');
    const { entries } = mergeEntries([...(old ? [old.entries] : []), r.entries]);
    store.removeLib('自定义词单');
    const res = store.addLib('自定义词单', entries);
    wx.showToast({ title: res.ok ? `自定义词单入库 ${entries.length} 条` : '存储已满', icon: 'none' });
    this._custom = '';
    this.setData({ custom: '' });
    this.render();
  },

  removeLib(e) {
    store.removeLib(e.currentTarget.dataset.name);
    this.render();
  },

  clearAll() {
    wx.showModal({
      title: '清空全部导入词库？', content: '集市订阅记录保留，可重新订阅。',
      success: (res) => { if (res.confirm) { store.clearPool(); this.render(); } },
    });
  },

  // ---- 数据备份（§D3：统一 JSON 备份，兼作「删小程序即丢」自救通道）----
  exportBackup() {
    const bk = store.exportBackup();
    const path = `${wx.env.USER_DATA_PATH}/helian_backup.json`;
    try { wx.getFileSystemManager().writeFileSync(path, JSON.stringify(bk), 'utf8'); }
    catch { wx.showToast({ title: '备份写入失败', icon: 'none' }); return; }
    wx.shareFileMessage({
      filePath: path,
      fileName: `helian_backup_${new Date().toISOString().slice(0, 10)}.json`,
      success: () => wx.showToast({ title: '已发送备份文件', icon: 'success' }),
      fail: () => wx.showToast({ title: '备份已生成，转发取消', icon: 'none' }),
    });
  },

  importBackup() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const f = res.tempFiles[0];
        let bk;
        try { bk = JSON.parse(wx.getFileSystemManager().readFileSync(f.path, 'utf8')); }
        catch { wx.showToast({ title: '不是有效的备份文件', icon: 'none' }); return; }
        const r = store.applyBackup(bk);
        if (!r.ok) { wx.showToast({ title: '备份格式不符（需鹤练 v1 备份）', icon: 'none' }); return; }
        wx.showToast({ title: `备份已恢复，${r.count} 项数据`, icon: 'success' });
        this.render();
      },
      fail: () => {},
    });
  },
});
