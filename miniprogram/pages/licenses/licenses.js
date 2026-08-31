// 数据来源与许可：LGPL-3.0 / CC-BY-4.0 义务的包内履行页。
// 小程序不能跳转外部网页（web-view 需业务域名白名单，个人主体不支持），
// 因此声明必须随包内置，不能只指向网页版出处页。
// 内容与 web 端 licenses.html 同源，改动须两处同步。

/** 上游出处与许可。license 为空表示自写数据、无外部许可负担。 */
const SOURCES = [
  {
    title: '五笔 86 字码表',
    license: 'LGPL-3.0',
    upstream: 'https://github.com/rime/rime-wubi',
    body: '来源 rime/rime-wubi 之 wubi86.dict.yaml。码表源流为极点五笔码表（JidianWubi table，Wozy 制，Google 词频）。改动：截取 GB2312 6,763 常用字、去词组与构词列、一字数码取词频最高者。「五笔字型」「王码」为注册商标，站内以通称「五笔 86」指称，不作商标性使用。',
  },
  {
    title: '五笔 86 课程拆解',
    license: '',
    upstream: '',
    body: '拆解标注为自写教学口径（自有版权），键位归属是编码标准的公有事实。构建期参照 aardio/wubi-lex（MIT）、kfcd/chaizi（CC BY 3.0）与跨表码表，仅用于校验，不随包分发其原数据。课程包与字码表分离：练习出码仍以字码表为准。',
  },
  {
    title: '仓颉五代单字码表',
    license: 'LGPL-3.0',
    upstream: 'https://github.com/rime/rime-cangjie',
    body: '来源 rime/rime-cangjie 之 cangjie5.base.dict.yaml。仓库许可 LGPL-3.0，dict 文件头另标 GPL 双重声明，按仓库许可处理并原样保留头部声明；单字码表源自仓颉之友《五倉世紀》（www.chinesecj.com），构词码惜缘制、佛振修订。仓颉输入法体系公有——朱邦复先生 1982 年公开弃权。改动：同字取正码、舍 x 前缀「难字简码」，部首字形与标点不入包。速成码不另出包，由本表首尾二码运行时派生（官方 rime-quick 同款做法，LGPL-3.0）。',
  },
  {
    title: '注音带调数据',
    license: 'LGPL-3.0',
    upstream: 'https://github.com/rime/rime-terra-pinyin',
    body: '来源 rime/rime-terra-pinyin 之 terra_pinyin.dict.yaml。改动：仅截取内置练习池字词的带调拼音；多音字按池内读音选读；terra 未收简体「吗/们」，取其传统形「嗎/們」之声调。terra 为大陆普通话审音，与台湾正音有零星差异，教学场景可接受。',
  },
  {
    title: '粤拼带调数据',
    license: 'CC-BY-4.0',
    upstream: 'https://github.com/rime/rime-cantonese',
    body: '来源 rime-cantonese（CanCLID 粤语计算语言学基础建设组）之 jyut6ping3.chars.dict.yaml（带调单字表）与 jyut6ping3.words.dict.yaml（词级声调参照）。义务：署名。改动：保留 chars 源表全量单字，构建期简繁桥补内置池简体 alias 与词级条目；多音字按池内词境择主流读并留审核清单；地名表 jyut6ping3.maps 为 ODbL，不采用以规避 share-alike；懒音/模糊音容错不启用，教学取正音。',
  },
  {
    title: '五笔画笔顺码表',
    license: 'LGPL-3.0',
    upstream: 'https://github.com/rime/rime-stroke',
    body: '来源 rime/rime-stroke 之 stroke.dict.yaml（方案名「五筆畫」）。授权链：主码表源自 CNS11643 中文标准交换码全字库（數位發展部, CNS11643，Kunki Chou 整理），政府资料开放授权条款（与 CC-BY-4.0 兼容，条件：注明出处）；附码表源自北大中文论坛（孙海峰、徐孟罗、唐捺之、谢振斌诸君整理）；超集扩充数据（至 Ext J）来自宋天。改动：截取 GB2312 6,763 常用字、去重出条目。笔顺底本为 CNS11643（台标），与大陆规范笔顺在少数字（方、火、必 一类）存在微差；课程与练习一律从底本。',
  },
  {
    title: '未使用外部数据的方案',
    license: '',
    upstream: '',
    body: '小鹤/微软/搜狗/智能ABC/自然码/全拼的键位映射是自写表——键位布局属客观方法事实，按 ADR-0005 先例从公开方案代数规则反推自写，不复制上游文件，无许可负担。内置练习词池为自建数据。',
  },
];

/** 许可证全文地址，供长按复制。 */
const LICENSE_URLS = [
  { name: 'LGPL-3.0', url: 'https://www.gnu.org/licenses/lgpl-3.0.html' },
  { name: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
];

const THANKS =
  '感谢 Rime 输入法生态（佛振及诸位维护者）、各上游码表制作者、CanCLID 粤语计算语言学基础建设组（粤拼带调数据，CC-BY-4.0），以及 數位發展部, CNS11643 中文标准交换码全字库（五笔画笔顺码表主码表，政府资料开放授权）的长期开放工作。';

Page({
  data: { sources: SOURCES, licenseUrls: LICENSE_URLS, thanks: THANKS },

  /** 小程序内无法打开外链，改为点按复制到剪贴板。 */
  copyUrl(e) {
    const { url } = e.currentTarget.dataset;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' }),
    });
  },
});
