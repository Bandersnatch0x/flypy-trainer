// 引擎接缝测试：node test/run.mjs
import { keyPlan, toFly, toFlyPhrase, splitPinyin, SYLLABLES, entryCode } from '../js/flypy.js';
import { parseUserdb, parseDictYaml, parseCustomPhrase, parsePlain, sniffAndParse, mergeEntries, weightedSample } from '../js/parsers.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
}

// ---- 1. 小鹤映射（42+ 用例，移植自本地页验证集）----
const cases = [
  ['shuang', 'ul'], ['pin', 'pb'], ['zhong', 'vs'], ['guo', 'go'], ['shi', 'ui'],
  ['chi', 'ii'], ['zhi', 'vi'], ['ang', 'ah'], ['ai', 'ad'], ['ei', 'ew'],
  ['ao', 'ac'], ['ou', 'oz'], ['an', 'aj'], ['en', 'ef'], ['eng', 'eg'], ['er', 'er'],
  ['a', 'aa'], ['o', 'oo'], ['e', 'ee'], ['ju', 'jv'], ['qu', 'qv'], ['xu', 'xv'],
  ['yu', 'yv'], ['jue', 'jt'], ['xuan', 'xr'], ['luan', 'lr'], ['guan', 'gr'],
  ['shuan', 'ur'], ['chuang', 'il'], ['zhuang', 'vl'], ['qiong', 'qs'], ['xiong', 'xs'],
  ['niao', 'nn'], ['liang', 'll'], ['huang', 'hl'], ['kuai', 'kk'], ['hui', 'hv'],
  ['gui', 'gv'], ['shui', 'uv'], ['mian', 'mm'], ['jian', 'jm'], ['qian', 'qm'],
  ['biao', 'bn'], ['xiao', 'xn'], ['liu', 'lq'], ['niu', 'nq'], ['yue', 'yt'],
  ['nve', 'nt'], ['lve', 'lt'], ['nv', 'nv'], ['lv', 'lv'], ['yin', 'yb'], ['ying', 'yk'],
  ['wai', 'wd'], ['wei', 'ww'], ['zhei', 'vw'], ['shei', 'uw'],
];
for (const [py, code] of cases) eq(`toFly(${py})`, toFly(py), code);
eq('phrase', toFlyPhrase('shuang pin'), 'ulpb');

// ---- 2. 全拼切分（贪心 + 回溯）----
eq('split zhongguo', splitPinyin('zhongguo'), ['zhong', 'guo']);
eq('split xian（最长匹配）', splitPinyin('xian'), ['xian']);
eq('split xiane 贪心定案', splitPinyin('xiane'), ['xian', 'e']);
eq('split jixu', splitPinyin('jixu'), ['ji', 'xu']);
eq('split bad', splitPinyin('zzz'), null);
eq('split empty', splitPinyin(''), null);
eq('syllable table size ok', SYLLABLES.size > 380, true);

// ---- 3. entryCode ----
eq('entryCode from py', entryCode({ word: '双拼', py: 'shuang pin' }), 'ulpb');
eq('entryCode direct code', entryCode({ word: '好', code: 'HC' }), 'hc');
eq('entryCode nothing', entryCode({ word: '嗯' }), '');

// ---- 4. 解析器 ----
const userdb = 'jixu \u7ee7\u7eed\u0001c=12990 d=12990 t=150\nzhongguo \u4e2d\u56fd\u0001c=800 d=800 t=140\nbadline\ndaima code\u0001c=5 d=5 t=1\n';
const ru = parseUserdb(userdb);
eq('userdb count', ru.entries.length, 2);
eq('userdb weight', ru.entries[0].weight, 12990);
eq('userdb py 切分', ru.entries[0].py, 'ji xu');
const ru2 = parseUserdb('ulpb \u7ee7\u7eed\u0001c=9 d=9 t=9\n');
eq('userdb 双拼码快照路径', ru2.entries[0].code, 'ulpb');
eq('userdb sniff', sniffAndParse('x.userdb.txt', userdb).format, ru.format);

const dyaml = '---\nname: t\n...\n\u7ee7\u7eed ji xu 99\n\u4e2d\u56fd zhong guo\nbadline\n';
const rd = parseDictYaml(dyaml);
eq('yaml count', rd.entries.length, 2);
eq('yaml weight', rd.entries[0].weight, 99);

const cp = '\u738b\u5f6c\u5b87 wby 99\nmwt=\u6ca1\u95ee\u9898\n';
const rc = parseCustomPhrase(cp);
eq('cp count', rc.entries.length, 2);
eq('cp code', rc.entries[0].code, 'wby');
eq('cp eq form', rc.entries[1].code, 'mwt');

const plain = '\u53cc\u62fc shuang pin 5\n\u7b80\u5355 jian dan\n\u65e0\u62fc\u97f3\n';
const rp = parsePlain(plain);
eq('plain count', rp.entries.length, 2);
eq('plain py', rp.entries[0].py, 'shuang pin');

// ---- 5. 合并去重 ----
const merged = mergeEntries([[{ word: '\u7ee7\u7eed', py: 'ji xu', code: '', weight: 10 }], [{ word: '\u7ee7\u7eed', py: 'ji xu', code: '', weight: 5 }, { word: '\u574f', py: 'zz', code: '', weight: 9 }]]);
eq('merge dedup weight', merged.entries.find(e => e.word === '\u7ee7\u7eed').weight, 15);
eq('merge splitFails', merged.splitFails, 1);
eq('merge code computed', merged.entries[0].code, 'jixv');

// ---- 6. 加权抽题不放回 ----
const pool = Array.from({ length: 50 }, (_, i) => ({ word: 'w' + i, py: '', code: 'ab', weight: i + 1 }));
const sample = weightedSample(pool, 50);
eq('sample no-repeat', new Set(sample.map(e => e.word)).size, 50);
eq('sample cap', weightedSample(pool, 999).length, 50);
const heavy = weightedSample([{ word: 'a', code: 'aa', weight: 1e9 }, { word: 'b', code: 'bb', weight: 1 }], 1, () => 0.5);
eq('sample weighted', heavy[0].word, 'a');


// ---- 7. 多方案映射（译自 rime-ice algebra）----
import * as SC from '../js/schemes.js';
const m = SC.getScheme('mspy'), sg = SC.getScheme('sogou'), ab = SC.getScheme('abc');
eq('mspy shuang', m.toFly('shuang'), 'ud');
eq('mspy pin', m.toFly('pin'), 'pn');
eq('mspy zhong', m.toFly('zhong'), 'vs');
eq('mspy ying(分号键)', m.toFly('ying'), 'y;');
eq('mspy an 零声母 o 前缀', m.toFly('an'), 'oj');
eq('mspy ai 零声母 o 前缀', m.toFly('ai'), 'ol');
eq('mspy ju→jv', m.toFly('ju'), 'jy');
eq('mspy chuang', m.toFly('chuang'), 'id');
eq('sogou shuang', sg.toFly('shuang'), 'ud');
eq('sogou ming(分号键)', sg.toFly('ming'), 'm;');
eq('sogou pin', sg.toFly('pin'), 'pn');
eq('sogou zhong', sg.toFly('zhong'), 'vs');
eq('sogou ying', sg.toFly('ying'), 'y;');
eq('sogou an 零声母', sg.toFly('an'), 'oj');
eq('sogou ai 零声母', sg.toFly('ai'), 'ol');
eq('sogou ju→jv', sg.toFly('ju'), 'jy');
eq('sogou chuang', sg.toFly('chuang'), 'id');
eq('sogou guo', sg.toFly('guo'), 'go');
eq('sogou chang', sg.toFly('chang'), 'ih');
eq('sogou luan', sg.toFly('luan'), 'lr');
eq('abc shuang', ab.toFly('shuang'), 'vt');
eq('abc pin', ab.toFly('pin'), 'pc');
eq('abc zhong', ab.toFly('zhong'), 'as');
eq('abc an 零声母 o 前缀', ab.toFly('an'), 'oj');
eq('abc ai 零声母', ab.toFly('ai'), 'ol');
eq('abc ming', ab.toFly('ming'), 'my');
eq('abc chuang', ab.toFly('chuang'), 'et');
eq('abc jue(ue→m)', ab.toFly('jue'), 'jm');
eq('abc yue', ab.toFly('yue'), 'ym');
eq('scheme list 4 项', SC.SCHEME_LIST.length, 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
