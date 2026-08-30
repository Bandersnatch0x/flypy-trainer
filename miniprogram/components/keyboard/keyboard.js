// 自绘键盘组件：行数据由页面按当前方案 layout 构建传入；
// 高亮/按下/错闪四态由属性驱动，击键事件回抛页面。
Component({
  properties: {
    rows: { type: Array, value: [] },        // [[{key, main, sub, special}], ...]
    curKey: { type: String, value: '' },     // 当前步高亮
    nextKey: { type: String, value: '' },    // 下一步预亮
    pressedKey: { type: String, value: '' }, // 命中按压
    errKey: { type: String, value: '' },     // 错按红闪
    heat: { type: Object, value: {} },       // 错键热力：{键: 0-3 级}
  },
  methods: {
    onTap(e) {
      const key = e.currentTarget.dataset.key;
      if (key) this.triggerEvent('key', { key });
    },
  },
});
