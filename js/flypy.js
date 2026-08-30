// 拼音基元：小鹤键位表 + 音节切分 + 全拼合法音节表。
// v3：编码派生一律走方案注册表（js/schemes.js 的 codeOf/planOf），本文件不再提供双轨编码函数。

export const YM = {
  iu: 'q', ei: 'w', uan: 'r', er: 'r', ue: 't', ve: 't', un: 'y', uo: 'o', ie: 'p',
  ong: 's', iong: 's', ing: 'k', uai: 'k', ai: 'd', en: 'f', eng: 'g', iang: 'l',
  uang: 'l', ang: 'h', ian: 'm', an: 'j', ou: 'z', a: 'a', o: 'o', e: 'e', i: 'i',
  u: 'u', v: 'v', ia: 'x', ua: 'x', ao: 'c', ui: 'v', in: 'b', iao: 'n',
};

export const SM_KEYS = { zh: 'v', ch: 'i', sh: 'u' };
export const SM_NAME = { v: 'zh', i: 'ch', u: 'sh' };

export function normalizeSyllable(s) {
  return s.toLowerCase().replace(/ü/g, 'v').trim();
}

export function splitSyllable(syl) {
  for (const sm of ['zh', 'ch', 'sh']) {
    if (syl.startsWith(sm)) return [sm, syl.slice(2)];
  }
  const m = syl.match(/^([bpmfdtnlgkhjqxzcsryw])(.*)$/);
  if (m && m[2]) return [m[1], m[2]];
  return [null, syl];
}

// ---- 全拼合法音节表（无声调）----
const SYL = ('a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ' +
  'ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu ' +
  'chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao ' +
  'de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo e ei en eng er ' +
  'fa fan fang fei fen feng fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai ' +
  'guan guang gui gun guo ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang ' +
  'hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang ' +
  'kao ke ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei leng ' +
  'li lia lian liang liao lie lin ling liu lo long lou lu luan lue lun luo ma mai man mang mao ' +
  'me mei men meng mi mian miao mie min ming miu mo mou mu na nai nan nang nao ne nei nen neng ' +
  'ni nian niang niao nie nin ning niu nong nou nu nuan nve nun nuo o ou pa pai pan pang pao ' +
  'pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao qie qin qing qiong ' +
  'qiu qu quan que qun ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo sa sai san ' +
  'sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai ' +
  'shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan tang tao te tei teng ' +
  'ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei wen weng wo wu xi xia ' +
  'xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao ye yi yin ying yo ' +
  'yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe ' +
  'zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu ' +
  'zuan zui zun zuo').split(' ');
// 常见字母形式补全 + §6 裁定补齐项（nv/kei/cei/sei/nue；m/n/ng 等叹词音节风险高不收）
for (const s of ['lv', 'lve', 'nve', 'nv', 'yu', 'kei', 'cei', 'sei', 'nue']) if (!SYL.includes(s)) SYL.push(s);
export const SYLLABLES = new Set(SYL);

// 贪心最长匹配 + 回溯；失败返回 null
export function splitPinyin(code) {
  const s = String(code || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return null;
  const memo = new Map();
  const solve = (i) => {
    if (i === s.length) return [];
    if (memo.has(i)) return memo.get(i);
    let res = null;
    for (let len = Math.min(6, s.length - i); len >= 1; len--) {
      const part = s.slice(i, i + len);
      if (SYLLABLES.has(part)) {
        const rest = solve(i + len);
        if (rest) { res = [part, ...rest]; break; }
      }
    }
    memo.set(i, res);
    return res;
  };
  return solve(0);
}
