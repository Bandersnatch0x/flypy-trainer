// 引擎接缝测试：node test/run.mjs（改接方案注册表，SPEC-0003 §3.1 入口唯一）
// localStorage 桩（迁移/存储测试用）——须在任何 store 调用前就位
const storeMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (storeMap.has(k) ? storeMap.get(k) : null),
  setItem: (k, v) => { storeMap.set(k, String(v)); },
  removeItem: (k) => { storeMap.delete(k); },
  clear: () => { storeMap.clear(); },
  get length() { return storeMap.size; },
  key: (i) => [...storeMap.keys()][i] ?? null,
};

import { splitPinyin, SYLLABLES } from '../js/flypy.js';
import { parseUserdb, parseDictYaml, parseCustomPhrase, parsePlain, sniffAndParse, mergeEntries, weightedSample } from '../js/parsers.js';
import { SCHEMES, getScheme, SCHEME_LIST, DEFAULT_SCHEME } from '../js/schemes.js';
import { store, migrate } from '../js/store.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
}

const fly = SCHEMES.flypy, mspy = SCHEMES.mspy, sogou = SCHEMES.sogou, abc = SCHEMES.abc,
  zrm = SCHEMES.ziranma, qp = SCHEMES.quanpin, zy = SCHEMES.zhuyin,
  cj = SCHEMES.cangjie, qk = SCHEMES.quick, wb = SCHEMES.wubi86;
const code = (scheme, py) => scheme.codeOf({ word: '测', py });

// ---- 1. 方案接口完整性（§3.1）----
eq('默认方案仍为小鹤', DEFAULT_SCHEME, 'flypy');
eq('注册表 10 方案（+五笔 86 降级形态，#6）', SCHEME_LIST.length, 10);
for (const s of Object.values(SCHEMES)) {
  eq(`${s.id} 接口七件齐`, ['id', 'name', 'paradigm', 'codeOf', 'planOf', 'layout', 'activate'].every(k => s[k] !== undefined), true);
  eq(`${s.id} paradigm 随范式`, s.paradigm, ['cangjie', 'quick', 'wubi86'].includes(s.id) ? 'shape' : 'phonetic');
  eq(`${s.id} layout.ROWS 存在`, Array.isArray(s.layout.ROWS), true);
  eq(`${s.id} keyLabel 函数`, typeof s.layout.keyLabel, 'function');
  eq(`${s.id} specialOf 函数`, typeof s.layout.specialOf, 'function');
  if (s.id === 'zhuyin') {
    eq('zhuyin activate 挂 zhuyin-tones 包（带调数据依赖，§2）', s.packId, 'zhuyin');
  } else if (s.id === 'cangjie' || s.id === 'quick') {
    eq(`${s.id} activate 挂 cangjie5 包（字表查询，§2）`, s.packId, 'cangjie5');
  } else if (s.id === 'wubi86') {
    eq('wubi86 activate 挂 wubi86 包（字表查询，§2）', s.packId, 'wubi86');
  } else {
    eq(`${s.id} activate 立即就绪`, await s.activate(), undefined);
  }
}
eq('getScheme 兜底小鹤', getScheme('nope').id, 'flypy');

// ---- 2. 小鹤映射（57 用例，移植自本地页验证集；经注册表 codeOf）----
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
for (const [py, c] of cases) eq(`flypy.codeOf(${py})`, code(fly, py), c);
eq('flypy 词组', fly.codeOf({ word: '双拼', py: 'shuang pin' }), 'ulpb');
eq('flypy srcCode 直用', fly.codeOf({ word: '王彬宇', srcCode: 'WBY', srcScheme: 'flypy' }), 'wby');
eq('flypy 无 py 无 srcCode → null', fly.codeOf({ word: '嗯' }), null);
eq('flypy 它方案 srcCode 不直用', fly.codeOf({ word: '王', srcCode: 'abc', srcScheme: 'cangjie' }), null);

// ---- 3. plan 扁平键序（§3.2）----
const pShuang = fly.planOf('ul', { word: '双', py: 'shuang' });
eq('flypy plan keys 扁平', pShuang.keys.map(k => k.key), ['u', 'l']);
eq('flypy plan roles', pShuang.keys.map(k => k.role), ['sm', 'ym']);
eq('flypy plan label 话术料', pShuang.keys[0].note, '声母 sh');
eq('flypy plan groups', pShuang.groups, [{ syl: 'shuang', start: 0, len: 2 }]);
eq('flypy 词组 plan 键数=4', fly.planOf('ulpb', { word: '双拼', py: 'shuang pin' }).keys.length, 4);
eq('零声母单韵母 plan 两键同键', fly.planOf('aa', { word: '啊', py: 'a' }).keys.map(k => k.key), ['a', 'a']);

// ---- 4. 全拼切分（贪心 + 回溯）----
eq('split zhongguo', splitPinyin('zhongguo'), ['zhong', 'guo']);
eq('split xian（最长匹配）', splitPinyin('xian'), ['xian']);
eq('split xiane 贪心定案', splitPinyin('xiane'), ['xian', 'e']);
eq('split jixu', splitPinyin('jixu'), ['ji', 'xu']);
eq('split luan（§6 修复）', splitPinyin('luan'), ['luan']);
eq('split nv（§6 修复）', splitPinyin('nv'), ['nv']);
eq('split nvlan 变长切分', splitPinyin('nvlan'), ['nv', 'lan']);
eq('split bad', splitPinyin('zzz'), null);
eq('split empty', splitPinyin(''), null);
eq('音节表无 lvan 赝品', SYLLABLES.has('lvan'), false);
eq('音节表含 nv/luan', SYLLABLES.has('nv') && SYLLABLES.has('luan'), true);
eq('补齐项 kei/cei/sei/nue', ['kei', 'cei', 'sei', 'nue'].every(s => SYLLABLES.has(s)), true);
eq('syllable table size ok', SYLLABLES.size > 380, true);

// ---- 5. §6-③ 单韵母：zeroDouble 按方案开关 ----
eq('mspy 啊=oa', code(mspy, 'a'), 'oa');
eq('mspy 哦=oo', code(mspy, 'o'), 'oo');
eq('mspy 鹅=oe', code(mspy, 'e'), 'oe');
eq('sogou 啊=oa', code(sogou, 'a'), 'oa');
eq('sogou 鹅=oe', code(sogou, 'e'), 'oe');
eq('abc 啊=oa', code(abc, 'a'), 'oa');
eq('abc 鹅=oe', code(abc, 'e'), 'oe');
eq('flypy 啊=aa（小鹤保留按两下）', code(fly, 'a'), 'aa');
eq('mspy 爱=ol（o 引导非单韵母）', code(mspy, 'ai'), 'ol');

// ---- 6. 微软/搜狗/智能ABC（经注册表）----
eq('mspy shuang', code(mspy, 'shuang'), 'ud');
eq('mspy pin', code(mspy, 'pin'), 'pn');
eq('mspy zhong', code(mspy, 'zhong'), 'vs');
eq('mspy ying(分号键)', code(mspy, 'ying'), 'y;');
eq('mspy an 零声母 o 前缀', code(mspy, 'an'), 'oj');
eq('mspy ju→jy', code(mspy, 'ju'), 'jy');
eq('mspy chuang', code(mspy, 'chuang'), 'id');
eq('sogou shuang', code(sogou, 'shuang'), 'ud');
eq('sogou ming(分号键)', code(sogou, 'ming'), 'm;');
eq('sogou zhong', code(sogou, 'zhong'), 'vs');
eq('sogou guo', code(sogou, 'guo'), 'go');
eq('sogou luan', code(sogou, 'luan'), 'lr');
eq('abc shuang', code(abc, 'shuang'), 'vt');
eq('abc pin', code(abc, 'pin'), 'pc');
eq('abc zhong', code(abc, 'zhong'), 'as');
eq('abc ming', code(abc, 'ming'), 'my');
eq('abc chuang', code(abc, 'chuang'), 'et');
eq('abc jue(ue→m)', code(abc, 'jue'), 'jm');

// ---- 7. 自然码（≥12 用例；零特例注册，§3.1 / T4-Q7/Q8）----
// 与微软差 3 处：ing 挂 Y（微软挂 ;）、ü 归 v（微软归 y）、er 原样（微软 or）
eq('zrm ying（ing 在 Y）', code(zrm, 'ying'), 'yy');
eq('zrm lv（ü 归 v）', code(zrm, 'lv'), 'lv');
eq('zrm er 原样', code(zrm, 'er'), 'er');
eq('zrm vs mspy 差 ying', code(mspy, 'ying'), 'y;');
eq('zrm vs mspy 差 lv', code(mspy, 'lv'), 'ly');
eq('zrm vs mspy 差 er', code(mspy, 'er'), 'or');
// jqxy 双收规范式全取 v
eq('zrm ju→jv', code(zrm, 'ju'), 'jv');
eq('zrm qu→qv', code(zrm, 'qu'), 'qv');
eq('zrm xu→xv', code(zrm, 'xu'), 'xv');
eq('zrm yu→yv', code(zrm, 'yu'), 'yv');
eq('zrm jue→jt', code(zrm, 'jue'), 'jt');
// 零声母首字母引导
eq('zrm ai→al', code(zrm, 'ai'), 'al');
eq('zrm an→aj', code(zrm, 'an'), 'aj');
eq('zrm ang→ah', code(zrm, 'ang'), 'ah');
eq('zrm ao→ak', code(zrm, 'ao'), 'ak');
eq('zrm ei→ez', code(zrm, 'ei'), 'ez');
eq('zrm en→ef', code(zrm, 'en'), 'ef');
eq('zrm eng→eg', code(zrm, 'eng'), 'eg');
eq('zrm ou→ob', code(zrm, 'ou'), 'ob');
// 单韵母按两下、常规音节与微软同键位
eq('zrm 啊=aa', code(zrm, 'a'), 'aa');
eq('zrm 哦=oo', code(zrm, 'o'), 'oo');
eq('zrm 鹅=ee', code(zrm, 'e'), 'ee');
eq('zrm shuang', code(zrm, 'shuang'), 'ud');
eq('zrm pin', code(zrm, 'pin'), 'pn');
eq('zrm zhong', code(zrm, 'zhong'), 'vs');
eq('zrm luan', code(zrm, 'luan'), 'lr');
eq('zrm 无分号附键', zrm.layout.extraKeys, []);

// ---- 8. 全拼（≥12 用例；码=拼音派生，变长键序）----
eq('qp 啊', code(qp, 'a'), 'a');
eq('qp 哦', code(qp, 'o'), 'o');
eq('qp 鹅', code(qp, 'e'), 'e');
eq('qp nv（§6）', qp.codeOf({ word: '女', py: 'nv' }), 'nv');
eq('qp luan（§6）', qp.codeOf({ word: '乱', py: 'luan' }), 'luan');
eq('qp shuang', code(qp, 'shuang'), 'shuang');
eq('qp zhongguo 多音节', qp.codeOf({ word: '中国', py: 'zhong guo' }), 'zhongguo');
eq('qp 码=拼音连写', qp.codeOf({ word: '双拼', py: 'shuang pin' }), 'shuangpin');
eq('qp 无 py → null', qp.codeOf({ word: '嗯' }), null);
eq('qp srcCode 不直用（无形码表前）', qp.codeOf({ word: '王', srcCode: 'wby', srcScheme: 'flypy' }), null);
eq('qp plan 变长 8 键', qp.planOf('zhongguo', { word: '中国', py: 'zhong guo' }).keys.length, 8);
eq('qp plan groups', qp.planOf('zhongguo', { word: '中国', py: 'zhong guo' }).groups,
  [{ syl: 'zhong', start: 0, len: 5 }, { syl: 'guo', start: 5, len: 3 }]);
eq('qp plan luan 键序', qp.planOf('luan', { word: '乱', py: 'luan' }).keys.map(k => k.key), ['l', 'u', 'a', 'n']);
eq('qp plan 声韵 role', qp.planOf('pin', { word: '拼', py: 'pin' }).keys.map(k => k.role), ['sm', 'ym', 'ym']);
eq('qp 键盘 26 键无附键', qp.layout.ROWS.join('').length + qp.layout.extraKeys.length, 26);

// ---- 9. Entry 规范形与准入矩阵（§3.3）----
const merged = mergeEntries([
  [{ word: '继续', py: 'ji xu', weight: 10 }],
  [
    { word: '继续', py: 'ji xu', weight: 5 },
    { word: '坏', py: 'zz', weight: 9 },
    { word: '王彬宇', srcCode: 'wby', srcScheme: 'flypy', weight: 3 },
    { word: 'hello', py: 'ni hao', weight: 2 },
  ],
]);
eq('merge 权重求和', merged.entries.find(e => e.word === '继续').weight, 15);
eq('merge py 规范化', merged.entries.find(e => e.word === '继续').py, 'ji xu');
eq('merge 不烘焙 code', 'code' in merged.entries.find(e => e.word === '继续'), false);
eq('merge srcCode 通道保留', merged.entries.find(e => e.word === '王彬宇').srcCode, 'wby');
eq('merge 准入拦截数（非CJK+不可切分无码）', merged.dropped, 2);
const m2 = mergeEntries([[{ word: '王彬宇', py: '', code: 'wby', weight: 1 }]]);
eq('旧 code 槽 → srcCode', m2.entries[0].srcCode, 'wby');
eq('旧 code 槽 → srcScheme flypy', m2.entries[0].srcScheme, 'flypy');
eq('准入：有 py → flypy 可题', fly.codeOf({ word: '继续', py: 'ji xu' }), 'jixv');
eq('准入：有 py → mspy 可题', mspy.codeOf({ word: '继续', py: 'ji xu' }), 'jixy');
eq('准入：有 py → 全拼可题', qp.codeOf({ word: '继续', py: 'ji xu' }), 'jixu');
eq('准入：仅 srcCode → 小鹤可题', fly.codeOf(m2.entries[0]), 'wby');
eq('准入：仅 srcCode → 它音码不可题', mspy.codeOf(m2.entries[0]), null);

// ---- 10. 解析器（产出规范形）----
const userdb = 'jixu \u7ee7\u7eed\u0001c=12990 d=12990 t=150\nzhongguo \u4e2d\u56fd\u0001c=800 d=800 t=140\nbadline\ndaima code\u0001c=5 d=5 t=1\n';
const ru = parseUserdb(userdb);
eq('userdb count', ru.entries.length, 2);
eq('userdb weight', ru.entries[0].weight, 12990);
eq('userdb py 切分', ru.entries[0].py, 'ji xu');
eq('userdb 无 code 字段', 'code' in ru.entries[0], false);
const ru2 = parseUserdb('ulpb \u7ee7\u7eed\u0001c=9 d=9 t=9\n');
eq('userdb 双拼码快照 → srcCode', ru2.entries[0].srcCode, 'ulpb');
eq('userdb sniff', sniffAndParse('x.userdb.txt', userdb).format, ru.format);

const dyaml = '---\nname: t\n...\n\u7ee7\u7eed ji xu 99\n\u4e2d\u56fd zhong guo\nbadline\n';
const rd = parseDictYaml(dyaml);
eq('yaml count', rd.entries.length, 2);
eq('yaml weight', rd.entries[0].weight, 99);

const cp = '\u738b\u5f6c\u5b87 wby 99\nmwt=\u6ca1\u95ee\u9898\n';
const rc = parseCustomPhrase(cp);
eq('cp count', rc.entries.length, 2);
eq('cp srcCode', rc.entries[0].srcCode, 'wby');
eq('cp eq form srcCode', rc.entries[1].srcCode, 'mwt');

const plain = '\u53cc\u62fc shuang pin 5\n\u7b80\u5355 jian dan\n\u65e0\u62fc\u97f3\n';
const rp = parsePlain(plain);
eq('plain count', rp.entries.length, 2);
eq('plain py', rp.entries[0].py, 'shuang pin');

// ---- 11. 加权抽题不放回 ----
const pool = Array.from({ length: 50 }, (_, i) => ({ word: 'w' + i, py: '', weight: i + 1 }));
const sample = weightedSample(pool, 50);
eq('sample no-repeat', new Set(sample.map(e => e.word)).size, 50);
eq('sample cap', weightedSample(pool, 999).length, 50);
const heavy = weightedSample([{ word: 'a', weight: 1e9 }, { word: 'b', weight: 1 }], 1, () => 0.5);
eq('sample weighted', heavy[0].word, 'a');

// ---- 12. 存储：按方案拆键（§3.6）----
store.addKey('flypy', 'a', true);
store.addKey('flypy', 'a', false);
store.addKey('mspy', 'o', true);
store.flushKeys();
const KJ = (k) => JSON.parse(storeMap.get('flypy.v1.' + k)).data;
eq('keystats.flypy 记账', KJ('keystats.flypy').a, [2, 1]);
eq('keystats.mspy 隔离', KJ('keystats.mspy').o, [1, 0]);
eq('getKeyStats 按方案', store.getKeyStats('flypy').a, [2, 1]);

store.addMistake('ziranma', { word: '测试', py: 'ce shi', errPos: 1 });
eq('mistakes.ziranma 无码快照', 'code' in KJ('mistakes.ziranma')[0], false);
eq('mistakes 记 errPos', KJ('mistakes.ziranma')[0].errPos, 1);
eq('mistakes 按方案隔离', store.getMistakes('flypy').length, 0);

store.srsTouch('mspy', 'q', false);
eq('srs.mspy 记账', KJ('srs.mspy').q.box, 1);
eq('srs 按方案隔离', Object.keys(store.getSRS('flypy')).length, 0);

store.setCourse('quanpin', { stage: 2 });
eq('course.quanpin', KJ('course.quanpin'), { stage: 2 });
eq('course 按方案默认 0', store.getCourse('abc'), { stage: 0 });

store.addSession({ ts: Date.now(), mode: 'chars', secs: 5, acc: 100, kpm: 50, total: 20, scheme: 'quanpin', words: 10 });
eq('sessions 带 scheme', KJ('sessions').at(-1).scheme, 'quanpin');
eq('sessions 带 words', KJ('sessions').at(-1).words, 10);

// ---- 13. 迁移：幂等与归属（§3.6 / T2-D10）----
storeMap.clear();
const seed = {
  'flypy.v1.sessions': { v: 1, data: [{ ts: 1, mode: 'chars', secs: 10, acc: 90, kpm: 60, total: 40 }, { ts: 2, mode: 'sprint', secs: 60, acc: 80, kpm: 90, total: 120, scheme: 'mspy' }] },
  'flypy.v1.mistakes': { v: 1, data: [{ word: '双拼', py: 'shuang pin', code: 'ulpb', n: 2, last: 111 }, { word: '王彬宇', py: '', code: 'wby', n: 1, last: 222 }] },
  'flypy.v1.keystats': { v: 1, data: { q: [10, 2] } },
  'flypy.v1.srs': { v: 1, data: { k: { box: 2, due: 0 } } },
  'flypy.v1.course': { v: 1, data: { stage: 2 } },
  'flypy.v1.libs': { v: 1, data: [{ name: 'old', addedAt: 1, entries: [{ word: '继续', py: 'ji xu', code: 'jixv', weight: 5 }, { word: '王彬宇', py: '', code: 'wby', weight: 1 }] }] },
};
for (const [k, v] of Object.entries(seed)) storeMap.set(k, JSON.stringify(v));
eq('首迁返回 data', migrate(), 'data');
eq('迁移 sessions 补 scheme', KJ('sessions')[0].scheme, 'flypy');
eq('迁移 sessions 保留已有 scheme', KJ('sessions')[1].scheme, 'mspy');
eq('迁移 mistakes 弃 code', KJ('mistakes.flypy')[0], { word: '双拼', py: 'shuang pin', n: 2, last: 111 });
eq('迁移 mistakes 空 py 条目保留', KJ('mistakes.flypy')[1].word, '王彬宇');
eq('迁移 keystats 并入', KJ('keystats.flypy'), { q: [10, 2] });
eq('迁移 srs 并入', KJ('srs.flypy'), { k: { box: 2, due: 0 } });
eq('迁移 course 并入', KJ('course.flypy'), { stage: 2 });
eq('迁移 libs 规范形（丢烘焙码，无码者转 srcCode）', KJ('libs')[0].entries,
  [{ word: '继续', py: 'ji xu', weight: 5 }, { word: '王彬宇', py: '', weight: 1, srcCode: 'wby', srcScheme: 'flypy' }]);
eq('迁移标记键', KJ('migrated').to, 'v3');
eq('旧键留档未删', storeMap.has('flypy.v1.mistakes'), true);
eq('迁移后旧键不再被读（mistakes 走新键）', store.getMistakes('flypy').length, 2);
const snap = JSON.stringify([...storeMap.entries()].sort());
eq('二迁返回 null', migrate(), null);
eq('二次启动不重复迁移（数据逐字节不变）', JSON.stringify([...storeMap.entries()].sort()), snap);
eq('迁移后池内词条无 code', store.getPool().every(e => !('code' in e)), true);
eq('迁移后 srcCode 词条可练', fly.codeOf(store.getPool().find(e => e.word === '王彬宇')), 'wby');
// 全新用户路径：无存量，仅打标
storeMap.clear();
eq('新用户迁移返回 fresh', migrate(), 'fresh');
eq('新用户二迁返回 null', migrate(), null);

// ---- v3 #2：data pack 管线（SPEC-0003 §3.5，验收条目 5/6）----
const fs = await import('node:fs');
const { BUILTIN: POOL } = await import('../js/data.js');
const packs = await import('../js/packs.js');
const { PACKS, loadPack, packState, bindPack, lookupChars, prefetchPacks, __resetForTest } = packs;

// -- 工件：三份版本化紧凑 {字: 码}，内嵌出处与许可；速成/全拼/自然码无包 --
const packDir = new URL('../data/packs/', import.meta.url);
const readPack = (f) => JSON.parse(fs.readFileSync(new URL(f, packDir), 'utf8'));
const wubiPack = readPack('wubi86.v1.json');
const cangPack = readPack('cangjie5.v1.json');
const zhuyPack = readPack('zhuyin-tones.v1.json');
const entriesOf = (p) => Object.keys(p).filter(k => !k.startsWith('_'));
eq('packs 目录恰有三份版本化 JSON', fs.readdirSync(packDir).filter(f => f.endsWith('.json')).sort(),
  ['cangjie5.v1.json', 'wubi86.v1.json', 'zhuyin-tones.v1.json']);
for (const [name, p] of [['wubi86', wubiPack], ['cangjie5', cangPack], ['zhuyin-tones', zhuyPack]]) {
  eq(`${name} _meta 出处`, typeof p._meta.source === 'string' && p._meta.source.length > 0, true);
  eq(`${name} _meta 许可`, p._meta.license, 'LGPL-3.0');
  eq(`${name} _meta 上游指纹`, /^[0-9a-f]{64}$/.test(p._meta.upstreamSha256), true);
}
eq('wubi86 = GB2312 6,763 常用字', entriesOf(wubiPack).length, 6763);
eq('wubi86 键皆单字', entriesOf(wubiPack).every(w => [...w].length === 1), true);
eq('wubi86 码域 a–y ≤4 键', entriesOf(wubiPack).every(w => /^[a-y]{1,4}$/.test(wubiPack[w])), true);
eq('wubi86 一级简码抽样', [wubiPack['工'], wubiPack['人'], wubiPack['地'], wubiPack['中']], ['a', 'w', 'f', 'k']);
eq('cangjie5 条数与 _meta 一致', entriesOf(cangPack).length, cangPack._meta.entries);
eq('cangjie5 键皆单 CJK 字', entriesOf(cangPack).every(w => [...w].length === 1 && /[\u3400-\u9FFF]/.test(w)), true);
eq('cangjie5 码域 a–z ≤5 码', entriesOf(cangPack).every(w => /^[a-z]{1,5}$/.test(cangPack[w])), true);
eq('cangjie5 日月金木水火土字母键', [cangPack['日'], cangPack['月'], cangPack['金'], cangPack['木'], cangPack['水'], cangPack['火'], cangPack['土']],
  ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
eq('cangjie5 昌/中抽样', [cangPack['昌'], cangPack['中']], ['aa', 'l']);
eq('速成/全拼/自然码无包', ['quick', 'sucueng', 'quanpin', 'ziranma'].every(id => !PACKS[id]), true);
const poolItems = [...POOL.chars, ...POOL.words2, ...POOL.words34];
const uniqItems = [...new Map(poolItems.map(e => [e.w, e])).values()];
eq('zhuyin-tones 覆盖内置池全部字词', uniqItems.every(e => typeof zhuyPack[e.w] === 'string'), true);
eq('zhuyin 值 = 逐字带调音节（1–5 调）', uniqItems.every(e => {
  const syls = (zhuyPack[e.w] || '').split(' ');
  return syls.length === [...e.w].length && syls.every(s => /^[a-züê]+[1-5]$/.test(s));
}), true);
eq('zhuyin 已知条目', [zhuyPack['北京'], zhuyPack['吗'], zhuyPack['我们']], ['bei3 jing1', 'ma5', 'wo3 men5']);
eq('zhuyin 宽松选音清单在案', Array.isArray(zhuyPack._meta.fallbacks), true);

// -- 装载器：内存缓存 / 并发去重 / 失败重试 / 未就绪可重试 / 不阻塞其它方案 --
let fetchLog = [];
let fetchImpl = null;
globalThis.fetch = async (url) => { fetchLog.push(String(url)); return fetchImpl(String(url)); };
const jsonRes = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, clone() { return this; } });

__resetForTest(); fetchLog = [];
fetchImpl = () => jsonRes({ _meta: { id: 'cangjie5', license: 'LGPL-3.0' }, 日: 'a', 月: 'b' });
const tab1 = await loadPack('cangjie5');
eq('loadPack 跳过 _meta 键', tab1, { 日: 'a', 月: 'b' });
eq('loadPack 就绪态', packState('cangjie5'), 'ready');
await loadPack('cangjie5');
eq('内存缓存命中（不重复下载）', fetchLog.length, 1);

__resetForTest();
let hits = 0;
fetchImpl = async () => { hits++; await new Promise(r => setTimeout(r, 10)); return jsonRes({ 日: 'a' }); };
const [ta, tb] = await Promise.all([loadPack('cangjie5'), loadPack('cangjie5')]);
eq('并发激活在途去重（2 并发 1 次下载）', hits, 1);
eq('并发共享同一表', ta === tb, true);

__resetForTest();
let tries = 0;
fetchImpl = () => (++tries < 3 ? Promise.reject(new Error('net')) : jsonRes({ 日: 'a' }));
eq('失败重试后成功（第 3 次）', await loadPack('cangjie5'), { 日: 'a' });
eq('重试共 3 次', tries, 3);

__resetForTest();
fetchImpl = () => Promise.reject(new Error('offline'));
eq('持续失败抛错', await loadPack('cangjie5').then(() => false, () => true), true);
eq('失败后状态 = error（入口未就绪）', packState('cangjie5'), 'error');
fetchImpl = () => jsonRes({ 日: 'a' });
eq('未就绪不投毒，再激活可就绪', await loadPack('cangjie5'), { 日: 'a' });
eq('未知 pack 拒绝', await loadPack('nope').then(() => false, () => true), true);

__resetForTest();
fetchImpl = () => jsonRes({ _meta: {}, 日: 'a', 月: 'b' });
const cjScheme = bindPack({ id: 'cangjie', name: '仓颉', paradigm: 'shape' }, 'cangjie5');
eq('激活前无表', cjScheme.table, undefined);
await cjScheme.activate();
eq('activate() 接载后逐字查表出码', lookupChars(cjScheme.table, '日月'), 'ab');
eq('lookupChars 缺字返回 null（取题过滤接缝）', lookupChars(cjScheme.table, '日月龘'), null);

__resetForTest();
fetchImpl = (url) => (url.includes('wubi86') ? Promise.reject(new Error('net')) : jsonRes({ 日: 'a' }));
const sA = bindPack({ id: 'a' }, 'wubi86');
const sB = bindPack({ id: 'b' }, 'cangjie5');
const [ra, rb] = await Promise.allSettled([sA.activate(), sB.activate()]);
eq('一包失败不阻塞其它方案', [ra.status, rb.status], ['rejected', 'fulfilled']);
fetchImpl = () => jsonRes({ 工: 'a' });
eq('失败方案重试激活后就绪', await sA.activate().then(t => t['工'], () => 'fail'), 'a');

__resetForTest(); fetchLog = [];
fetchImpl = () => jsonRes({});
eq('prefetch 无 SW 回落直连成功', (await prefetchPacks(['cangjie5'])).ok, true);
eq('prefetch 命中 pack 地址', fetchLog, ['/data/packs/cangjie5.v1.json']);
eq('prefetch 拒绝未知包', (await prefetchPacks(['nope'])).ok, false);

// ---- v3 #3：课程数据化（SPEC-0003 §4.1 / §8 缺口 1，验收条目 9/12）----
const { COURSES, courseOf, syllablesOf, confusKeys, confusEndsMatch, stageModes, challengeMatch } = await import('../js/courses.js');

// -- schema 完整性：每方案一份、恰五阶、形状固定（供 #4/#5 依样产出）--
eq('注册表十方案皆有课程数据', Object.keys(SCHEMES).every(id => COURSES[id] && COURSES[id].scheme === id), true);
for (const c of Object.values(COURSES)) {
  if (c.form === 'rootTable') continue; // 降级形态（五笔 86）形状另断，见 #6 专节
  eq(`${c.scheme} 恰五阶`, c.stages.length, 5);
  eq(`${c.scheme} 阶 kind 合法`, c.stages.every(s => ['keys', 'drill', 'practice', 'mistakes'].includes(s.kind)), true);
  eq(`${c.scheme} 阶名/副标题齐`, c.stages.every(s => s.name && s.sub), true);
  eq(`${c.scheme} 七日挑战七条`, c.challenge.length, 7);
  eq(`${c.scheme} 易混对非空`, c.confus.length > 0, true);
}

// -- 双拼五变体复用骨架：五阶名称/六易混对/挑战谓词语义与硬编码时代等价 --
const flyCourse = courseOf('flypy');
eq('双拼五阶名称保持', flyCourse.stages.map(s => s.name), ['键位认知', '韵母操练', '单字练习', '词组练习', '易错强化']);
eq('双拼五变体共用骨架', ['mspy', 'sogou', 'abc', 'ziranma'].every(id => COURSES[id].stages === COURSES.flypy.stages && COURSES[id].confus === COURSES.flypy.confus), true);
eq('六易混对标签保持', flyCourse.confus.map(p => p.label), ['in/ing', 'an/ang', 'en/eng', 'zh/z', 'ch/c', 'sh/s']);
eq('易混键位对经方案表映射（小鹤 in→b ing→k）', confusKeys(flyCourse.confus[0], fly), ['b', 'k']);
eq('易混翘舌对经声母表（小鹤 zh→v）', confusKeys(flyCourse.confus[3], fly), ['v', 'z']);
eq('挑战谓词 stage1=finaldrill（韵母操练一轮）', challengeMatch(flyCourse.challenge[1].match, 'finaldrill', flyCourse) && !challengeMatch(flyCourse.challenge[1].match, 'chars', flyCourse), true);
eq('挑战谓词 stage2=chars（单字一轮）', challengeMatch(flyCourse.challenge[2].match, 'chars', flyCourse) && !challengeMatch(flyCourse.challenge[2].match, 'words2', flyCourse), true);
eq('挑战谓词 stage3=words2（二字词一轮）', challengeMatch(flyCourse.challenge[3].match, 'words2', flyCourse), true);
eq('挑战谓词 confus 前缀（易混对抗一轮）', challengeMatch(flyCourse.challenge[4].match, 'confus:5', flyCourse), true);
eq('挑战谓词 sprint', challengeMatch(flyCourse.challenge[5].match, 'sprint', flyCourse) && !challengeMatch(flyCourse.challenge[5].match, 'mixed', flyCourse), true);
eq('挑战谓词 mixed/sentences', challengeMatch(flyCourse.challenge[6].match, 'mixed', flyCourse) && challengeMatch(flyCourse.challenge[6].match, 'sentences', flyCourse), true);
eq('挑战 D1 any 谓词', challengeMatch(flyCourse.challenge[0].match, 'chars', flyCourse), true);

// -- 全拼课程（§4.1 全拼列，验收条目 12）--
const qpCourse = courseOf('quanpin');
eq('全拼阶 0 弱键诊断（键位图读热力图）', qpCourse.stages[0].kind === 'keys' && qpCourse.stages[0].view === 'heat', true);
eq('全拼阶 1 音节操练（清单供给，SRS 维度不变）', qpCourse.stages[1].kind === 'drill' && qpCourse.stages[1].unit === 'syllable' && Array.isArray(qpCourse.stages[1].items), true);
eq('全拼音节清单皆合法音节', qpCourse.stages[1].items.every(s => SYLLABLES.has(s)), true);
eq('全拼音节清单无重复', new Set(qpCourse.stages[1].items).size === qpCourse.stages[1].items.length, true);
eq('全拼每音节可从内置字池取题', qpCourse.stages[1].items.every(syl => POOL.chars.some(({ p }) => syllablesOf(p).includes(syl))), true);
eq('全拼阶 2 词组提速 = words2 池', qpCourse.stages[2].pools, ['words2']);
eq('全拼阶 3 长句用内置 words34 与 SENTENCES', [...qpCourse.stages[3].pools].sort(), ['sentences', 'words34']);
eq('全拼阶 4 = 错词本取题', qpCourse.stages[4].kind, 'mistakes');
eq('stageModes 操练阶 = finaldrill', stageModes(qpCourse.stages[1]), ['finaldrill']);
eq('stageModes 练习阶 = pools 以 + 连接', stageModes(qpCourse.stages[3]), ['words34+sentences']);
eq('全拼挑战 D4 命中合并模式名', challengeMatch(qpCourse.challenge[3].match, 'words34+sentences', qpCourse), true);
eq('全拼易混对皆音节尾对', qpCourse.confus.every(p => Array.isArray(p.ends) && p.ends.length === 2), true);
eq('音节尾对匹配前后鼻音', confusEndsMatch('shang', qpCourse.confus[1]) && confusEndsMatch('ban', qpCourse.confus[1]), true);
eq('音节尾对非成员不匹配', confusEndsMatch('shi', qpCourse.confus[1]), false);
eq('ian/iang 对覆盖 jian/jiang', confusEndsMatch('jian', qpCourse.confus[0]) && confusEndsMatch('jiang', qpCourse.confus[0]), true);
eq('非音节尾对返回 null', confusEndsMatch('shi', flyCourse.confus[0]), null);
for (const p of qpCourse.confus) {
  const base = [...POOL.chars, ...POOL.words2];
  const side = (t) => base.filter(e => syllablesOf(e.p).some(s => s.endsWith(t))).length;
  eq(`全拼易混对 ${p.label} 两侧可取题`, side(p.ends[0]) > 0 && side(p.ends[1]) > 0, true);
}

// -- 课程进度 per-scheme（验收条目 9；拆键存储已在 §12 覆盖）--
store.setCourse('flypy', { stage: 3 });
eq('course.flypy 进度', store.getCourse('flypy'), { stage: 3 });
eq('学完小鹤后切全拼进度从阶 0 起', store.getCourse('quanpin'), { stage: 0 });

// -- syllablesOf（音节序列 = 方案无关通货）--
eq('syllablesOf 空格分词', syllablesOf('zhong guo'), ['zhong', 'guo']);

// ---- v3 #4：注音方案（SPEC-0003 §2/§3.2/§4.1/§4.2/§7 条目 13，T4-Q4/Q5/Q6）----
const zym = await import('../js/zhuyin.js');
const { keysOfToned, TONE_KEYS: ZY_TK } = zym;

// -- 大千键位 xlit（T1-§3：keymap_bopomofo 一行 xlit）--
eq('xlit 声符三列 ㄅ1/ㄉ2/ㄓ5', [zym.KEY_OF_ZM['ㄅ'], zym.KEY_OF_ZM['ㄉ'], zym.KEY_OF_ZM['ㄓ']], ['1', '2', '5']);
eq('xlit 介符 ㄧu/ㄨj/ㄩm', [zym.KEY_OF_ZM['ㄧ'], zym.KEY_OF_ZM['ㄨ'], zym.KEY_OF_ZM['ㄩ']], ['u', 'j', 'm']);
eq('xlit 韵符 ㄚ8/ㄝ,/ㄦ-', [zym.KEY_OF_ZM['ㄚ'], zym.KEY_OF_ZM['ㄝ'], zym.KEY_OF_ZM['ㄦ']], ['8', ',', '-']);
eq('xlit 37 符号 ↔ 37 键互逆', Object.keys(zym.KEY_OF_ZM).length === 37 && Object.keys(zym.ZM_OF_KEY).length === 37
  && Object.entries(zym.KEY_OF_ZM).every(([s, k]) => zym.ZM_OF_KEY[k] === s), true);
eq('声调键 ˉ=空格 ˊ=6 ˇ=3 ˋ=4 ˙=7', [ZY_TK[1], ZY_TK[2], ZY_TK[3], ZY_TK[4], ZY_TK[5]], [' ', '6', '3', '4', '7']);

// -- 拼音→注音派生（≥12 用例；例外全枚举：空韵/y-w 头/ü/er/ê/呣/儿化/轻声=调 5）--
const ZY_CASES = [
  ['zhong1', '5j/ '], ['shuang1', 'gj; '], ['pin1', 'qup '], ['hua2', 'cj86'],
  ['liu2', 'xu.6'], ['hui4', 'cjo4'], ['lun2', 'xjp6'], ['yin1', 'up '],
  ['yong4', 'm/4'], ['wu2', 'j6'], ['wei4', 'jo4'], ['yuan2', 'm06'],
  // 空韵（ㄭ 不写韵符）
  ['zhi1', '5 '], ['shi4', 'g4'], ['zi4', 'y4'], ['ri4', 'b4'], ['ci2', 'h6'],
  // y/w 头、ü（含 jqx 后 u）、er、ê、呣、儿化、轻声=调 5
  ['nv3', 'sm3'], ['ju1', 'rm '], ['lve4', 'xm,4'], ['er2', '-6'],
  ['eh1', ', '], ['m1', 'aj '], ['r5', '-7'], ['ma5', 'a87'],
];
for (const [toned, want] of ZY_CASES) eq(`注音派生 ${toned}`, keysOfToned(toned), want);
eq('例外·裸 r 非调 5 不可派生', keysOfToned('r4'), null);
eq('例外·非法音节不可派生', keysOfToned('zz9'), null);
eq('带调包音节全量可派生（课程字集内无死角）', (() => {
  let total = 0, bad = 0;
  for (const [w, v] of Object.entries(zhuyPack)) {
    if (w.startsWith('_')) continue;
    for (const s of v.split(' ')) { total++; if (!keysOfToned(s)) bad++; }
  }
  return [total > 3000, bad];
})(), [true, 0]);

// -- 方案层：带调数据依赖（表未就绪不出题）、码 = 符号键 + 声调键 --
zy.table = { 中: 'zhong1', 华: 'hua2', 中华: 'zhong1 hua2' };
eq('zhuyin.codeOf 单字（调 1 收尾为空格）', zy.codeOf({ word: '中' }), '5j/ ');
eq('zhuyin.codeOf 词组', zy.codeOf({ word: '中华', py: 'zhong hua' }), '5j/ cj86');
eq('zhuyin.displayOf 显注音符号+调号', zy.displayOf({ word: '中华' }), 'ㄓㄨㄥˉ ㄏㄨㄚˊ');
eq('zhuyin 缺字 → null（取题过滤）', zy.codeOf({ word: '龘' }), null);
const zpl = zy.planOf('5j/ ', { word: '中' });
eq('zhuyin plan 扁平键序（声调键收尾）', zpl.keys.map(k => k.key), ['5', 'j', '/', ' ']);
eq('zhuyin plan roles 声/介/韵/调', zpl.keys.map(k => k.role), ['sm', 'jie', 'ym', 'tone']);
eq('zhuyin plan label = 注音符号（错键反馈用）', zpl.keys.map(k => k.label), ['ㄓ', 'ㄨ', 'ㄥ', '空格']);
eq('zhuyin plan groups 带调音节', zpl.groups, [{ syl: 'zhong1', start: 0, len: 4 }]);
zy.table = null;
eq('zhuyin 表未就绪 → 不出题（懒加载接缝）', zy.codeOf({ word: '中' }), null);

// -- 41 键大千布局（含数字行；空格调键由 extraKeys 承载，T4-Q5）--
eq('zhuyin 数字行在 ROWS', zy.layout.ROWS[0], '1234567890-');
eq('zhuyin 41 键位 + 空格调键 = 42 键元', zy.layout.ROWS.join('').length + zy.layout.extraKeys.length, 42);
eq('zhuyin 键帽主显注音符号/角标物理键', zy.layout.keyLabel('1'), { main: 'ㄅ', sub: '1', title: 'ㄅ · 键 1' });
eq('zhuyin 空格键键帽（宽键料）', zy.layout.keyLabel(' '), { main: 'ˉ', sub: '空格', title: '声调一（ˉ）· 空格键' });

// -- 课程五阶（§4.1 注音列：阶 1 声调键收尾；验收条目 13）--
const zyCourse = courseOf('zhuyin');
eq('zhuyin 阶 0 = 41 键键盘图认知', zyCourse.stages[0].kind === 'keys' && zyCourse.stages[0].view === 'map' && zyCourse.stages[0].sub.includes('41 键'), true);
const zyDrill = zyCourse.stages[1];
eq('zhuyin 阶 1 = 符号操练（SRS 单元=符号键）', zyDrill.kind === 'drill' && zyDrill.unit === 'symbol', true);
eq('zhuyin 阶 1 分组规模：声符 21/介符 3/韵符 13/声调键 5', zyDrill.groups.map(g => g.keys.length), [21, 3, 13, 5]);
eq('zhuyin 阶 1 以声调键 5 收尾（无声调不出字）', zyDrill.groups[3].keys, [' ', '6', '3', '4', '7']);
eq('zhuyin 阶 2 单字含调 / 阶 3 词组', [zyCourse.stages[2].pools, zyCourse.stages[3].pools], [['chars'], ['words2']]);
eq('zhuyin 阶 4 = 错词本', zyCourse.stages[4].kind, 'mistakes');
eq('zhuyin 易混对皆物理键直给', zyCourse.confus.every(p => Array.isArray(p.keys) && p.keys.length === 2), true);
eq('zhuyin 挑战谓词 D2=符号操练', challengeMatch(zyCourse.challenge[1].match, 'finaldrill', zyCourse), true);
eq('zhuyin 挑战谓词 D3=单字', challengeMatch(zyCourse.challenge[2].match, 'chars', zyCourse), true);
eq('zhuyin 挑战谓词 D4=词组', challengeMatch(zyCourse.challenge[3].match, 'words2', zyCourse), true);
// 易混对两侧皆可取题（真实带调表 + 内置池）
zy.table = Object.fromEntries(Object.entries(zhuyPack).filter(([k]) => !k.startsWith('_')));
const zyBase = [...POOL.chars, ...POOL.words2].map(({ w, p }) => ({ word: w, py: p }));
for (const pair of zyCourse.confus) {
  const touch = (k) => zyBase.filter(e => {
    const c = zy.codeOf(e);
    return c && zy.planOf(c, e).keys.some(pk => pk.key === k && pk.role === pair.role);
  }).length;
  eq(`zhuyin 易混对 ${pair.label} 两侧可取题`, pair.keys.every(k => touch(k) > 0), true);
}
zy.table = null;

// -- syllablesOf 余例 --
eq('syllablesOf 连写串切分', syllablesOf('zhongguo'), ['zhong', 'guo']);
eq('syllablesOf 空', syllablesOf(''), []);

// ---- v3 #5：仓颉深教样板 + 速成（SPEC-0003 §2/§3.4/§4.1–4.3，验收条目 10/15/16，§8 缺口 2）----
const cjm = await import('../js/cangjie.js');
const { quickOf, CJ_KEYS } = cjm;
const CJ_TABLE = Object.fromEntries(Object.entries(cangPack).filter(([k]) => !k.startsWith('_')));

// -- 懒加载接缝：表未就绪不出题 --
eq('cangjie 表未就绪 → 不出题', cj.codeOf({ word: '日' }), null);
cj.table = CJ_TABLE; qk.table = CJ_TABLE;

// -- 仓颉 codeOf：单字查表出码（≥12 用例，全部与 pack 实值核对）--
const CJ_CASES = [
  ['日', 'a'], ['月', 'b'], ['金', 'c'], ['木', 'd'], ['水', 'e'], ['火', 'f'], ['土', 'g'],
  ['中', 'l'], ['昌', 'aa'], ['明', 'ab'], ['林', 'dd'], ['双', 'ee'], ['学', 'fbnd'],
  ['楚', 'ddnyo'], ['影', 'afhhh'], ['望', 'ybhg'], ['解', 'nbshq'], ['龘', 'ypybp'],
];
for (const [w, c] of CJ_CASES) eq(`cangjie.codeOf(${w})`, cj.codeOf({ word: w }), c);
eq('cangjie 多字词 → null（取题仅单字，§3.4）', cj.codeOf({ word: '中国', py: 'zhong guo' }), null);
eq('cangjie 三字词 → null', cj.codeOf({ word: '王彬宇' }), null);
eq('cangjie 非表字 → null（被取题过滤）', cj.codeOf({ word: '㵘' }), null);
eq('cangjie 空词 → null', cj.codeOf({}), null);
eq('cangjie 形码只按 word 查表（§3.3）', cj.codeOf({ word: '日', py: '', srcCode: 'zzz', srcScheme: 'flypy' }), 'a');

// -- 速成 = 仓颉首尾二码运行时派生（≥12 用例；独立方案身份，零码表）--
const QK_CASES = [
  ['日', 'a'], ['明', 'ab'], ['林', 'dd'], ['双', 'ee'], ['时', 'ai'], ['学', 'fd'],
  ['楚', 'do'], ['影', 'ah'], ['望', 'yg'], ['解', 'nq'], ['真', 'jc'], ['语', 'ir'],
  ['鹤', 'om'], ['练', 'vc'], ['续', 'vk'], ['谢', 'ii'],
];
for (const [w, c] of QK_CASES) eq(`quick.codeOf(${w})`, qk.codeOf({ word: w }), c);
eq('quick 与仓颉同码（1–2 码字）', qk.codeOf({ word: '明' }), cj.codeOf({ word: '明' }));
eq('quick 异于仓颉（≥3 码字取首尾）', [cj.codeOf({ word: '学' }), qk.codeOf({ word: '学' })], ['fbnd', 'fd']);
eq('quick 多字词 → null（取题仅单字）', qk.codeOf({ word: '中国' }), null);
eq('quickOf 纯派生函数', [quickOf('a'), quickOf('ab'), quickOf('adi'), quickOf('afhhh'), quickOf(null)], ['a', 'ab', 'ai', 'ah', null]);
eq('quick 独立方案身份', [qk.id, qk.name, qk.paradigm], ['quick', '速成', 'shape']);
eq('quick 零码表：无独立包，共用 cangjie5', [PACKS.quick, qk.packId], [undefined, 'cangjie5']);

// -- plan = 拆分步骤序列：label=字根名、note=字母（§4.2，验收条目 15）--
const pChu = cj.planOf('ddnyo', { word: '楚' });
eq('cangjie plan 扁平键序', pChu.keys.map(k => k.key), ['d', 'd', 'n', 'y', 'o']);
eq('cangjie plan label = 字根名', pChu.keys.map(k => k.label), ['木', '木', '弓', '卜', '人']);
eq('cangjie plan note = 字母（full 档「字根名+字母」引导料）', pChu.keys[0].note, '字母 D');
eq('cangjie plan role = root', pChu.keys.every(k => k.role === 'root'), true);
eq('quick plan = 首尾二码两步骤', qk.planOf('fd', { word: '学' }).keys.map(k => `${k.label}${k.key}`), ['火f', '木d']);

// -- 布局：键帽主显仓颉字母、角标主字根；X 难 / Z 重 单列（§4.1 阶 0）--
eq('cangjie 键帽主显字母/角标主字根', cj.layout.keyLabel('d'), { main: 'D', sub: '木', title: '仓颉字母 D · 字根木' });
eq('cangjie X/Z 角标', [cj.layout.keyLabel('x').sub, cj.layout.keyLabel('z').sub], ['难', '重']);
eq('cangjie X/Z 描边单列、余键不描边', [cj.layout.specialOf('x'), cj.layout.specialOf('z'), cj.layout.specialOf('d')], ['难', '重', '']);
eq('cangjie 26 键位无附键', cj.layout.ROWS.join('').length + cj.layout.extraKeys.length, 26);
eq('24 字母键 = A–Y 除 X（Z 非取码）', CJ_KEYS, 'abcdefghijklmnopqrstuvwy');

// -- 课程五阶（验收条目 10：两方案全五阶可达）--
const cjCourse = courseOf('cangjie'), qkCourse = courseOf('quick');
eq('cangjie 阶 0 = 字根认知（roots 视图，§8 缺口 2）', cjCourse.stages[0].kind === 'keys' && cjCourse.stages[0].view === 'roots', true);
const rootsGroups = cjCourse.stages[0].groups;
eq('cangjie 阶 0 四类分区 + X/Z 单列', rootsGroups.map(g => g.keys.length), [7, 7, 4, 6, 2]);
eq('cangjie 阶 0 四类和 = 24 字母（不含 x/z）', rootsGroups.slice(0, 4).flatMap(g => g.keys).sort().join(''), CJ_KEYS);
eq('cangjie 阶 0 特殊组 = X 难 / Z 重', rootsGroups[4].keys, ['x', 'z']);
const letters = cjCourse.stages[0].letters;
eq('cangjie 字母表齐（24 字母 + X/Z）', Object.keys(letters).length, 26);
eq('cangjie 例字皆在表内且首码归属该字母', Object.entries(letters).every(([k, v]) =>
  v.special || ((v.ex || []).length > 0 && v.ex.every(w => CJ_TABLE[w] && CJ_TABLE[w][0] === k))), true);
eq('cangjie 字根本字单码 = 其字母（「字根在哪键」一键题的事实基础）', Object.entries(letters).every(([k, v]) =>
  v.special || CJ_TABLE[v.name] === k), true);
eq('cangjie X 不作首码、Z 不入码（公开事实入教学）', letters.x.note.includes('不作首码') && letters.z.note.includes('无一含 z'), true);
// 阶 1：拆字操练，SRS 单元 = 24 仓颉字母（验收条目 16）
const cjDrill = cjCourse.stages[1], qkDrill = qkCourse.stages[1];
eq('cangjie 阶 1 = 拆字操练（letter 单元）', cjDrill.kind === 'drill' && cjDrill.unit === 'letter', true);
eq('cangjie SRS 单元 = 24 仓颉字母（X 不教、Z 非取码）', cjDrill.groups.flatMap(g => g.keys).sort().join(''), CJ_KEYS);
eq('速成复用同一操练骨架（增首尾码速认话术）', qkDrill.unit === 'letter' && qkDrill.groups === cjDrill.groups && qkDrill.sub.includes('首尾码速认'), true);
eq('cangjie 阶 1 供字根字（一键题）', [cjDrill.roots.a, cjDrill.roots.d, cjDrill.roots.y], ['日', '木', '卜']);
// 阶 2：单字拆打，先简字后满码（轮内码长升序）
eq('cangjie 阶 2 = chars 池 + 码长升序选项', [cjCourse.stages[2].pools, cjCourse.stages[2].seq], [['chars'], 'len']);
eq('cangjie 阶 2 会话模式名带 @len', stageModes(cjCourse.stages[2]), ['chars@len']);
eq('quick 阶 2 皆短码无排序（模式名干净）', stageModes(qkCourse.stages[2]), ['chars']);
// 阶 3：词组——尾码锚点（'）包含结构教学；取题仍仅单字（§3.4）
eq('cangjie 阶 3 词组含尾码锚点教学', cjCourse.stages[3].body.includes("'") && cjCourse.stages[3].body.includes('囝'), true);
eq('cangjie 阶 3 取题仍仅单字（词取码规则缓议）', cjCourse.stages[3].pools, ['chars']);
eq('quick 阶 3 = 各字首尾二码连打教学', qkCourse.stages[3].body.includes('首尾二码'), true);
eq('两方案阶 4 = 错词本取题', [cjCourse.stages[4].kind, qkCourse.stages[4].kind], ['mistakes', 'mistakes']);

// -- 易混对：形近字母对供给（物理键直给 + role:'root'），两侧皆可取题 --
eq('cangjie 易混对皆形近字母对', cjCourse.confus.every(p => p.role === 'root' && p.keys.length === 2), true);
const cjBase = POOL.chars.map(({ w, p }) => ({ word: w, py: p }));
for (const pair of cjCourse.confus) {
  const touch = (k) => cjBase.filter(e => {
    const c = cj.codeOf(e);
    return c && cj.planOf(c, e).keys.some(pk => pk.key === k && pk.role === pair.role);
  }).length;
  eq(`cangjie 易混对 ${pair.label} 两侧可取题`, pair.keys.every(k => touch(k) > 0), true);
}
eq('confusKeys 物理键直给不经声韵表', confusKeys(cjCourse.confus[0], cj), ['d', 'j']);

// -- 七日挑战谓词（读课程数据机制复用）--
eq('cangjie 挑战 D2 = 拆字操练', challengeMatch(cjCourse.challenge[1].match, 'finaldrill', cjCourse), true);
eq('cangjie 挑战 D3 = 单字拆打（@len 模式）', challengeMatch(cjCourse.challenge[2].match, 'chars@len', cjCourse) && !challengeMatch(cjCourse.challenge[2].match, 'chars', cjCourse), true);
eq('cangjie 挑战 D4 = 词组阶（chars 热身）', challengeMatch(cjCourse.challenge[3].match, 'chars', cjCourse), true);
eq('quick 挑战 D2/D3 谓词', challengeMatch(qkCourse.challenge[1].match, 'finaldrill', qkCourse) && challengeMatch(qkCourse.challenge[2].match, 'chars', qkCourse), true);

// -- 课程进度 per-scheme（条目 10 配套）--
store.setCourse('flypy', { stage: 4 });
eq('学完小鹤后切仓颉进度从阶 0 起', store.getCourse('cangjie'), { stage: 0 });
eq('速成进度独立于仓颉', store.getCourse('quick'), { stage: 0 });

// -- 内置字集规模与覆盖率：课程字集 = 内置高频字池，皆在 cangjie5 表内 --
eq('内置字池 500 字全部可出仓颉题', POOL.chars.every(({ w }) => !!CJ_TABLE[w]), true);
eq('内置词池用字全部在表（词组教学示例的事实基础）', [...new Set([...POOL.words2, ...POOL.words34].flatMap(({ w }) => [...w]))].every(ch => !!CJ_TABLE[ch]), true);

// ---- v3 #6：五笔 86 降级形态（SPEC-0003 §2/§4.1–4.2，验收条目 11/15）----
const wbm = await import('../js/wubi.js');
const { WB_ROOTS, WB_ZONES } = wbm;
const WB_TABLE = Object.fromEntries(Object.entries(wubiPack).filter(([k]) => !k.startsWith('_')));

// -- 字根总表：25 键 × 键上字根（五区各五键，Z 不参与取码）--
eq('字根总表 25 键 = a–y（Z 不入表）', Object.keys(WB_ROOTS).sort().join(''), 'abcdefghijklmnopqrstuvwxy');
eq('五区 × 五键覆盖 25 码键', WB_ZONES.flatMap(z => z.keys).sort().join(''), 'abcdefghijklmnopqrstuvwxy');
eq('恰五区、每区五键', [WB_ZONES.length, WB_ZONES.every(z => z.keys.length === 5)], [5, true]);
eq('每键皆备键名/字根清单/例字', Object.values(WB_ROOTS).every(r => r.name && r.roots && (r.ex || []).length >= 3), true);
eq('每键皆备区/位/键帽角标（键帽与总表页取数）', Object.values(WB_ROOTS).every(r => r.zone && r.pos >= 1 && r.tag), true);
// 自写表的事实校验：凡在包内的字根/键名/例字，码首键必为该键
eq('键名字皆在表内且首码落该键', Object.entries(WB_ROOTS).every(([k, r]) => WB_TABLE[r.name] && WB_TABLE[r.name][0] === k), true);
eq('键上字根在表内者首码落该键', Object.entries(WB_ROOTS).every(([k, r]) =>
  r.roots.split(/\s+/).every(g => !WB_TABLE[g] || WB_TABLE[g][0] === k)), true);
eq('例字皆在表内且首码落该键', Object.entries(WB_ROOTS).every(([k, r]) =>
  r.ex.every(w => WB_TABLE[w] && WB_TABLE[w][0] === k)), true);

// ---- v3 #6：五笔 86 降级形态（SPEC-0003 §2/§3.4/§4.1/§4.2，验收条目 11/15，issue #6）----

// -- 懒加载接缝：表未就绪不出题 --
eq('wubi 表未就绪 → 不出题', wb.codeOf({ word: '工' }), null);
wb.table = WB_TABLE;

// -- 单字查表出码（≥12 用例，全部与 pack 实值核对）--
const WB_CASES = [
  ['工', 'a'], ['了', 'b'], ['以', 'c'], ['在', 'd'], ['有', 'e'], ['地', 'f'],
  ['一', 'g'], ['上', 'h'], ['不', 'i'], ['是', 'j'], ['中', 'k'], ['国', 'l'],
  ['同', 'm'], ['民', 'n'], ['为', 'o'], ['这', 'p'], ['我', 'q'], ['的', 'r'],
  ['要', 's'], ['和', 't'],
];
for (const [w, c] of WB_CASES) eq(`wubi.codeOf(${w})`, wb.codeOf({ word: w }), c);

// -- 多字词/缺码字 → null 被取题过滤（§3.4）--
eq('wubi 二字词 → null', wb.codeOf({ word: '中国', py: 'zhong guo' }), null);
eq('wubi 三字词 → null', wb.codeOf({ word: '王彬宇' }), null);
eq('wubi 整句 → null', wb.codeOf({ word: '中华人民共和国' }), null);
eq('wubi 缺码字 → null（表外字过滤）', wb.codeOf({ word: '龘' }), null);
eq('wubi 空条目 → null', wb.codeOf({}), null);
eq('wubi 形码只按 word 查表（§3.3）', wb.codeOf({ word: '工', py: '', srcCode: 'zzz', srcScheme: 'flypy' }), 'a');

// -- plan：role='码键' 扁平键序（§4.2 兜底形态）--
const pJian = wb.planOf('qvfp', { word: '键' });
eq('wubi plan 扁平键序', pJian.keys.map(k => k.key), ['q', 'v', 'f', 'p']);
eq('wubi plan role=码键', pJian.keys.every(k => k.role === '码键'), true);
eq('wubi plan label=键名（第 n 步话术料）', pJian.keys.map(k => k.label), ['Q', 'V', 'F', 'P']);
eq('wubi plan groups 空', pJian.groups, []);

// -- 布局：25 键角标字根 + Z 学习键单列 --
eq('wubi 键帽主显字母/角标字根略', wb.layout.keyLabel('g'),
  { main: 'G', sub: '王 一', title: `五笔 86 · 横区1位 · 键上字根：${WB_ROOTS.g.roots}` });
eq('wubi Z 学习键角标与描边', [wb.layout.keyLabel('z').sub, wb.layout.specialOf('z')], ['学习', '学习']);
eq('wubi 取码键不描边', wb.layout.specialOf('g'), '');
eq('wubi 26 键位无附键', wb.layout.ROWS.join('').length + wb.layout.extraKeys.length, 26);

// -- 字根总表数据（事实层自写表，ADR-0005）--
eq('字根总表恰 25 取码键（无 Z）', Object.keys(WB_ROOTS).sort().join(''), 'abcdefghijklmnopqrstuvwxy');
eq('五区各 5 键', WB_ZONES.map(z => z.keys.length), [5, 5, 5, 5, 5]);
eq('五区覆盖 25 键无重复', WB_ZONES.flatMap(z => z.keys).sort().join(''), Object.keys(WB_ROOTS).sort().join(''));
eq('每键字根与例字非空', Object.values(WB_ROOTS).every(r => r.roots && r.ex.length >= 2), true);
eq('例字皆在表内且首码归属该键', Object.entries(WB_ROOTS).every(([k, v]) =>
  v.ex.every(w => WB_TABLE[w] && WB_TABLE[w][0] === k)), true);

// -- 提示兜底形态（§4.2）：该键字根候选表与总表页同源取数 --
eq('wubi rootHint 候选表 = 总表数据', wb.rootHint('g'), `此键字根：${WB_ROOTS.g.roots}`);
eq('wubi rootHint 25 键皆有、Z 无', [...'abcdefghijklmnopqrstuvwxy'].every(k => wb.rootHint(k).startsWith('此键字根：')) && wb.rootHint('z') === '', true);
eq('仓颉无 rootHint（走字根名引导，非兜底形态）', cj.rootHint, undefined);

// -- 课程形态边界（验收条目 11：无课程阶/无 SRS 操练/不入七日挑战）--
const wbCourse = courseOf('wubi86');
eq('wubi 课程形态 = 字根总表页', [wbCourse.form, wbCourse.name, wbCourse.sub], ['rootTable', '字根总表', '25 键 × 键上字根 · 自由练习仅单字']);
eq('wubi 无课程阶', wbCourse.stages, []);
eq('wubi 无易混对供给', wbCourse.confus, []);
eq('wubi 不入七日挑战（谓词空态）', [wbCourse.challenge, wbCourse.challengeSub], [[], '']);
eq('wubi 页面数据挂字根总表（渲染器读课程数据）', [wbCourse.zones === WB_ZONES, wbCourse.roots === WB_ROOTS], [true, true]);
eq('courseOf 五笔不回落小鹤', courseOf('wubi86').scheme, 'wubi86');
eq('wubi 课程进度读默认空态', store.getCourse('wubi86'), { stage: 0 });

// -- 取题仅单字：内置池语义（出题过滤在引擎 codeOf 层）--
eq('内置二字词池在五笔下全被过滤', POOL.words2.filter(({ w }) => wb.codeOf({ word: w })).length, 0);
eq('内置高频字池 500 字全部可出五笔题', POOL.chars.every(({ w }) => !!WB_TABLE[w]), true);

// -- 命名边界：站内文案零商标性字样（通称「五笔 86」；署名面在 licenses 页，豁免）--
const jsFiles = fs.readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
const scanned = ['index.html', ...jsFiles].map(f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
eq('命名边界：站内零「五笔字型/王码」', /五笔字型|王码/.test(scanned), false);
eq('命名边界：方案名即通称', [wb.id, wb.name, SCHEME_LIST.find(s => s.id === 'wubi86').name], ['wubi86', '五笔 86', '五笔 86']);

// -- sw.js 单测（桩环境：classic worker 脚本按模块导入，globals 先就位）--
const swHandlers = {};
globalThis.self = {
  addEventListener: (type, fn) => { (swHandlers[type] ||= []).push(fn); },
  skipWaiting: () => Promise.resolve(),
  clients: { claim: () => Promise.resolve() },
};
const cacheStores = new Map();
globalThis.caches = {
  async open(name) {
    if (!cacheStores.has(name)) cacheStores.set(name, new Map());
    const m = cacheStores.get(name);
    return {
      async addAll(urls) { for (const u of urls) m.set(u, { __shell: u }); },
      async put(req, res) { m.set(typeof req === 'string' ? req : req.url, res); },
      async match(req) { return m.get(typeof req === 'string' ? req : req.url); },
    };
  },
  async keys() { return [...cacheStores.keys()]; },
  async match(req) {
    const k = typeof req === 'string' ? req : req.url;
    for (const m of cacheStores.values()) if (m.has(k)) return m.get(k);
    return undefined;
  },
};
globalThis.location = { origin: 'http://localhost:4173', hostname: 'localhost', href: 'http://localhost:4173/' };
await import('../sw.js');
const runHandler = async (type, ev) => { for (const fn of swHandlers[type] || []) await fn(ev); };

let installP = null;
await runHandler('install', { waitUntil: (p) => { installP = p; } });
await installP;
const cacheName = (await globalThis.caches.keys())[0];
eq('SW CACHE 串随版本 bump', cacheName, 'helian-v0.0.3-dev6');
const shellKeys = [...cacheStores.get(cacheName).keys()];
eq('packs.js / licenses.html / courses.js / zhuyin.js / cangjie.js / wubi.js 入 SHELL', ['/js/packs.js', '/licenses.html', '/js/courses.js', '/js/zhuyin.js', '/js/cangjie.js', '/js/wubi.js'].every(u => shellKeys.includes(u)), true);
eq('pack 不进 SHELL（防 addAll 原子失败）', shellKeys.some(u => u.startsWith('/data/packs/')), false);

const packUrlFull = 'http://localhost:4173/data/packs/cangjie5.v1.json';
let resp = null;
fetchLog = [];
fetchImpl = () => jsonRes({});
cacheStores.get(cacheName).set(packUrlFull, { __hit: true });
await runHandler('fetch', { request: { method: 'GET', url: packUrlFull }, respondWith: (p) => { resp = p; } });
resp = await resp;
eq('pack cache-first：命中直出缓存', resp.__hit, true);
eq('pack cache-first：命中零联网', fetchLog, []);
cacheStores.get(cacheName).delete(packUrlFull);
const freshRes = jsonRes({ fresh: true });
fetchImpl = () => freshRes;
await runHandler('fetch', { request: { method: 'GET', url: packUrlFull }, respondWith: (p) => { resp = p; } });
resp = await resp;
eq('pack 未命中联网一次返回原响应', resp === freshRes, true);
eq('pack 未命中即写入缓存', cacheStores.get(cacheName).has(packUrlFull), true);

let reply = null;
fetchLog = [];
fetchImpl = () => jsonRes({});
await runHandler('message', {
  data: { type: 'prefetch-pack', urls: ['/data/packs/cangjie5.v1.json', '/evil', 'https://evil.com/x', '/js/app.js'] },
  ports: [{ postMessage: (d) => { reply = d; } }],
});
await new Promise(r => setTimeout(r, 20));
eq('message 预下载仅接受 /data/packs/ 同源地址', fetchLog, ['/data/packs/cangjie5.v1.json']);
eq('message 预下载回报成功', reply && reply.ok, true);
eq('message 预下载写入当前 CACHE', cacheStores.get(cacheName).has('/data/packs/cangjie5.v1.json'), true);
reply = null;
await runHandler('message', { data: { type: 'prefetch-pack', urls: ['/evil'] }, ports: [{ postMessage: (d) => { reply = d; } }] });
eq('message 预下载拒绝非 pack 地址', reply && reply.ok, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
