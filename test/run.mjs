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
import { SCHEMES, getScheme, DEFAULT_SCHEME } from '../js/schemes.js';
import { store, migrate } from '../js/store.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
}

const fly = SCHEMES.flypy, mspy = SCHEMES.mspy, sogou = SCHEMES.sogou, abc = SCHEMES.abc,
  zrm = SCHEMES.ziranma, qp = SCHEMES.quanpin, zy = SCHEMES.zhuyin, jp = SCHEMES.jyutping,
  cj = SCHEMES.cangjie, qk = SCHEMES.quick, wb = SCHEMES.wubi86, sk = SCHEMES.stroke;
const code = (scheme, py) => scheme.codeOf({ word: '测', py });

// ---- 1. 方案接口完整性（§3.1）----
eq('默认方案仍为小鹤', DEFAULT_SCHEME, 'flypy');
eq('注册表 12 方案（+五笔画，#11）', Object.values(SCHEMES).length, 12);
for (const s of Object.values(SCHEMES)) {
  eq(`${s.id} 接口七件齐`, ['id', 'name', 'paradigm', 'codeOf', 'planOf', 'layout', 'activate'].every(k => s[k] !== undefined), true);
  eq(`${s.id} paradigm 随范式`, s.paradigm, ['cangjie', 'quick', 'wubi86', 'stroke'].includes(s.id) ? 'shape' : 'phonetic');
  eq(`${s.id} layout.ROWS 存在`, Array.isArray(s.layout.ROWS), true);
  eq(`${s.id} keyLabel 函数`, typeof s.layout.keyLabel, 'function');
  eq(`${s.id} specialOf 函数`, typeof s.layout.specialOf, 'function');
  if (s.id === 'zhuyin') {
    eq('zhuyin activate 挂 zhuyin-tones 包（带调数据依赖，§2）', s.packId, 'zhuyin');
  } else if (s.id === 'jyutping') {
    eq('jyutping activate 挂 jyutping-tones 包（带调数据依赖，#10 §2.4）', s.packId, 'jyutping');
  } else if (s.id === 'cangjie' || s.id === 'quick') {
    eq(`${s.id} activate 挂 cangjie5 包（字表查询，§2）`, s.packId, 'cangjie5');
  } else if (s.id === 'wubi86') {
    eq('wubi86 activate 挂 wubi86 包（字表查询，§2）', s.packId, 'wubi86');
  } else if (s.id === 'stroke') {
    eq('stroke activate 挂 stroke 包（字表查询，#11 §3.2）', s.packId, 'stroke');
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
const { PACKS, loadPack, packState, packMeta, bindPack, lookupChars, prefetchPacks, __resetForTest } = packs;

// -- 工件：四份版本化紧凑 {字: 码}，内嵌出处与许可；速成/全拼/自然码无包 --
const packDir = new URL('../data/packs/', import.meta.url);
const readPack = (f) => JSON.parse(fs.readFileSync(new URL(f, packDir), 'utf8'));
const wubiPack = readPack('wubi86.v1.json');
const cangPack = readPack('cangjie5.v1.json');
const zhuyPack = readPack('zhuyin-tones.v1.json');
const jyutPack = readPack('jyutping-tones.v1.json');
const strokePack = readPack('stroke.v1.json');
const entriesOf = (p) => Object.keys(p).filter(k => !k.startsWith('_'));
eq('packs 目录恰有六份版本化 JSON', fs.readdirSync(packDir).filter(f => f.endsWith('.json')).sort(),
  ['cangjie5.v1.json', 'jyutping-tones.v1.json', 'stroke.v1.json', 'wubi86-course.v1.json', 'wubi86.v1.json', 'zhuyin-tones.v1.json']);
for (const [name, p] of [['wubi86', wubiPack], ['cangjie5', cangPack], ['zhuyin-tones', zhuyPack], ['stroke', strokePack]]) {
  eq(`${name} _meta 出处`, typeof p._meta.source === 'string' && p._meta.source.length > 0, true);
  eq(`${name} _meta 许可`, p._meta.license, 'LGPL-3.0');
  eq(`${name} _meta 上游指纹`, /^[0-9a-f]{64}$/.test(p._meta.upstreamSha256), true);
}
// stroke 截包（#11 验收 8）：GB2312 6,763 字、raw ≤150KB、署名义务
eq('stroke raw ≤150KB（验收 8 预算）', fs.statSync(new URL('stroke.v1.json', packDir)).size <= 150 * 1024, true);
eq('stroke = GB2312 6,763 常用字', entriesOf(strokePack).length, 6763);
eq('stroke 条数与 _meta 一致', entriesOf(strokePack).length, strokePack._meta.entries);
eq('stroke 键皆单 CJK 字', entriesOf(strokePack).every(w => [...w].length === 1 && /[\u4E00-\u9FFF]/.test(w)), true);
eq('stroke 码域 hspnz、码长 ≤84', entriesOf(strokePack).every(w => /^[hsnpz]{1,84}$/.test(strokePack[w])), true);
eq('stroke 简体实测全命中（飞/龙/语/说/鹤/练 抽样）', [strokePack['飞'], strokePack['龙'], strokePack['语'], strokePack['说'], strokePack['鹤'], strokePack['练']],
  ['zpn', 'hppzn', 'nzhszhszh', 'nznpszhpz', 'nzpsnhhhshpznzh', 'zzhhzzpn']);
eq('stroke _meta 署 LGPL + 「數位發展部, CNS11643」（验收 8）',
  strokePack._meta.license === 'LGPL-3.0' && strokePack._meta.attribution.includes('數位發展部, CNS11643'), true);
eq('stroke _meta 笔顺底本声明在案（方/火/必 类微差）',
  typeof strokePack._meta.baseText === 'string' && /方\/火\/必/.test(strokePack._meta.baseText), true);
// jyutping-tones：CC-BY-4.0 署名义务（#10 验收 1）
eq('jyutping-tones _meta 出处（带调字表）', jyutPack._meta.source.includes('jyut6ping3.chars.dict.yaml'), true);
eq('jyutping-tones _meta 许可 CC-BY-4.0', jyutPack._meta.license, 'CC-BY-4.0');
eq('jyutping-tones _meta 上游指纹（字/词两表）', /^[0-9a-f]{64}$/.test(jyutPack._meta.upstreamSha256) && /^[0-9a-f]{64}$/.test(jyutPack._meta.upstreamWordsSha256), true);
eq('jyutping-tones _meta CanCLID 署名', jyutPack._meta.attribution.includes('CanCLID'), true);
eq('jyutping-tones raw ≤500KB（验收 1 预算）', fs.statSync(new URL('jyutping-tones.v1.json', packDir)).size <= 500 * 1024, true);
eq('jyutping-tones 条数与 _meta 一致', entriesOf(jyutPack).length, jyutPack._meta.entries);
const wbCoursePack = readPack('wubi86-course.v1.json');
eq('PACKS 登记课程拆解包', PACKS['wubi86-course'] && PACKS['wubi86-course'].url, '/data/packs/wubi86-course.v1.json');
eq('wubi86-course 出货条目数与 _meta 一致', entriesOf(wbCoursePack).length, wbCoursePack._meta.entries);
eq('wubi86-course 出货仅 human', entriesOf(wbCoursePack).every(w => wbCoursePack[w].src === 'human'), true);
eq('wubi86-course 两层口径在案', !!(wbCoursePack._meta.caliber && wbCoursePack._meta.caliber.code && wbCoursePack._meta.caliber.decomp), true);
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
// jyutping-tones：简繁桥后以简体为键、内置池字词全覆盖（#10 验收 2/6）
eq('jyutping-tones 以简体为键覆盖内置池全部字词', uniqItems.every(e => typeof jyutPack[e.w] === 'string'), true);
eq('jyutping 值 = 逐字带调音节（1–6 调）', uniqItems.every(e => {
  const syls = (jyutPack[e.w] || '').split(' ');
  return syls.length === [...e.w].length && syls.every(s => /^[a-z]+[1-6]$/.test(s));
}), true);
eq('jyutping 已知条目（桥 + 择读 + 词表变调）', [jyutPack['你'], jyutPack['是'], jyutPack['中国'], jyutPack['什么'], jyutPack['广州']],
  ['nei5', 'si6', 'zung1 gwok3', 'sam6 mo1', 'gwong2 zau1']);
eq('jyutping 单字阶题量 ≥400（桥 ∩ 内置池，验收 2 下限）', POOL.chars.filter(({ w }) => typeof jyutPack[w] === 'string').length >= 400, true);
eq('jyutping 池字六调全覆盖（验收 2）', (() => {
  const tones = new Set(POOL.chars.map(({ w }) => jyutPack[w]).filter(Boolean).map(t => +t.slice(-1)));
  return [...tones].sort();
})(), [1, 2, 3, 4, 5, 6]);
// 简繁桥工件：自写映射小表 + 一对多/多音字审核清单（验收 6）
const jpS2t = JSON.parse(fs.readFileSync(new URL('../tools/jyutping/s2t.json', import.meta.url), 'utf8'));
const jpS2tEntries = Object.keys(jpS2t).filter(k => !k.startsWith('_'));
eq('简繁桥映射小表自写且逐条可审（池字集口径）', jpS2tEntries.length >= 200 && Object.values(jpS2t).every(v => typeof v === 'string' || v == null || typeof v === 'object'), true);
eq('简繁桥映射值皆在带调字表可查（桥可执行）', (() => {
  const zhuyLike = Object.keys(jyutPack).filter(k => !k.startsWith('_'));
  return jpS2tEntries.filter(s => POOL.chars.some(({ w }) => w === s)).every(s => zhuyLike.includes(s));
})(), true);
eq('jyutping _meta 桥统计在案', jyutPack._meta.bridge.mapped >= 200 && Array.isArray(jyutPack._meta.bridge.missing), true);
const jpReview = fs.readFileSync(new URL('../tools/jyutping/bridge-review.md', import.meta.url), 'utf8');
eq('审核清单：一对多择主流字形留单（发→發）', jpReview.includes('发 → 發'), true);
eq('审核清单：撞车字折转留单（广→廣/惊→驚）', jpReview.includes('广 → 廣') && jpReview.includes('惊 → 驚'), true);
eq('审核清单：多音字择读留单', jpReview.includes('中 → zung1') && jpReview.includes('只 → zi2'), true);
eq('审核清单：词级逐字拼接清单在案', jpReview.includes('词级逐字拼接清单'), true);

// -- 装载器：内存缓存 / 并发去重 / 失败重试 / 未就绪可重试 / 不阻塞其它方案 --
let fetchLog = [];
let fetchImpl = null;
globalThis.fetch = async (url) => { fetchLog.push(String(url)); return fetchImpl(String(url)); };
const jsonRes = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, clone() { return this; } });

__resetForTest(); fetchLog = [];
fetchImpl = () => jsonRes({ _meta: { id: 'cangjie5', license: 'LGPL-3.0' }, 日: 'a', 月: 'b' });
const tab1 = await loadPack('cangjie5');
eq('loadPack 跳过 _meta 键', tab1, { 日: 'a', 月: 'b' });
eq('packMeta 另存出处头', packMeta('cangjie5'), { id: 'cangjie5', license: 'LGPL-3.0' });
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
const { COURSES, courseOf, syllablesOf, confusKeys, confusEndsMatch, stageModes, challengeMatch, setWubiCourseReady } = await import('../js/courses.js');

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
eq('zhuyin 阶 0 键位科普事实（˙在7/ㄢ在0/ㄦ挂-/ㄥ在底行//调键 6 3 4 7，P2）', (() => {
  const b = zyCourse.stages[0].body;
  return [b.includes('˙（7）'), b.includes('ㄢ（8/9/0）'), b.includes('ㄦ挂在「-」'), b.includes('「/」承载ㄥ'), b.includes('6/3/4/7')];
})(), [true, true, true, true, true]);
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

// ---- v4 #10：粤拼方案（SPEC-0004 §2，验收 1–7）----
const jpm = await import('../js/jyutping.js');
const { keysOfToned: jpKeysOf, planOfToned: jpPlanOf, planUnitAt: jpUnitAt, JP_TONE_KEYS: JP_TK } = jpm;

// -- 六调键位：阴调单键 / 阳调双键（官方 algebra 先例）--
eq('六调键 1→v 2→x 3→q / 4→vv 5→xx 6→qq', [JP_TK[1], JP_TK[2], JP_TK[3], JP_TK[4], JP_TK[5], JP_TK[6]],
  ['v', 'x', 'q', 'vv', 'xx', 'qq']);

// -- 派生：字母串即键序 + 尾缀 1–6 → v/x/q（×2）；入声随韵尾（≥12 用例，验收 3/30）--
const JP_CASES = [
  ['si1', 'siv'], ['si2', 'six'], ['si3', 'siq'], ['si4', 'sivv'], ['si5', 'sixx'], ['si6', 'siqq'],
  ['sik1', 'sikv'], ['sek3', 'sekq'], ['sik6', 'sikqq'], // 入声随韵尾（色/錫/食，官方例）
  ['nei5', 'neixx'], ['hou2', 'houx'], ['gwok3', 'gwokq'], ['mung4', 'mungvv'], ['faat3', 'faatq'],
];
for (const [toned, want] of JP_CASES) eq(`粤拼派生 ${toned}`, jpKeysOf(toned), want);
eq('粤拼派生：无调不可派生', jpKeysOf('nei'), null);
eq('粤拼派生：调 7 非法', jpKeysOf('nei7'), null);
eq('粤拼派生：非法字母串', jpKeysOf('zz9'), null);
eq('粤拼拼写不含 q/v/x（调键零冲突的事实基础）', [...jpm.JP_SM_KEYS, ...jpm.JP_YM_KEYS].every(k => !'qvx'.includes(k)), true);

// -- plan：阳调双键 = 单一连击单元（验收 4 的 plan 面）--
eq('粤拼 plan 阴调收尾单键单元', jpPlanOf('sik1').at(-1), { key: 'v', label: 'V', note: '阴平 · 声调 1', role: 'tone' });
eq('粤拼 plan 阳调收尾单一单元（span=2 + note 同键连按两下）', jpPlanOf('si6').at(-1),
  { key: 'q', label: 'QQ', note: '阳去 · 同键连按两下', role: 'tone', span: 2 });
eq('粤拼 plan 字母键 role=ym', jpPlanOf('nei5').slice(0, 2).map(k => k.role), ['ym', 'ym']);
eq('粤拼 plan 不可派生 → null', jpPlanOf('zz9'), null);
// plan 单元寻址（span 感知）：双敲两键位皆指向同一单元
const pSikqq = jpPlanOf('sik6');
eq('planUnitAt：双敲首键位命中调单元', jpUnitAt(pSikqq, 3), { unit: pSikqq.at(-1), index: 3, start: 3 });
eq('planUnitAt：双敲次键位仍命中同一单元', jpUnitAt(pSikqq, 4).unit, pSikqq.at(-1));
eq('planUnitAt：越界返回 null', jpUnitAt(pSikqq, 5), null);
eq('planUnitAt：无 span 单元行为不变', jpUnitAt(jpPlanOf('si1'), 2).unit.key, 'v');

// -- 方案层：带调数据依赖 + 码/提示/布局（验收 3）--
eq('jyutping 表未就绪 → 不出题（懒加载接缝）', jp.codeOf({ word: '你' }), null);
jp.table = Object.fromEntries(Object.entries(jyutPack).filter(([k]) => !k.startsWith('_')));
eq('jyutping.codeOf 单字阴调', jp.codeOf({ word: '中' }), 'zungv');
eq('jyutping.codeOf 单字阳调（双敲）', [jp.codeOf({ word: '时' }), jp.codeOf({ word: '我' }), jp.codeOf({ word: '是' })],
  ['sivv', 'ngoxx', 'siqq']);
eq('jyutping.codeOf 词组 = 逐音节键序连打', jp.codeOf({ word: '中国' }), 'zungvgwokq');
eq('jyutping.codeOf 缺字 → null（取题过滤）', jp.codeOf({ word: '龘' }), null);
eq('jyutping.displayOf = 带调粤拼串', [jp.displayOf({ word: '中国' }), jp.displayOf({ word: '你' })], ['zung1 gwok3', 'nei5']);
const pJp = jp.planOf('zungvgwokq', { word: '中国' });
eq('jyutping plan 扁平键序（词组 10 键位）', pJp.keys.map(k => k.key), ['z', 'u', 'n', 'g', 'v', 'g', 'w', 'o', 'k', 'q']);
eq('jyutping plan roles（字母=ym、调键收尾）', [...new Set(pJp.keys.map(k => k.role))], ['ym', 'tone']);
eq('jyutping plan groups（len 按击键数，双敲计 2）', pJp.groups, [{ syl: 'zung1', start: 0, len: 5 }, { syl: 'gwok3', start: 5, len: 5 }]);
const pJpY = jp.planOf('siqq', { word: '是' });
eq('jyutping plan 阳调双敲呈现为单一单元（勿拆两单元，验收 4）', [pJpY.keys.length, pJpY.keys.at(-1).note], [3, '阳去 · 同键连按两下']);
jp.table = null;
eq('jyutping 表撤载 → 不出题', jp.codeOf({ word: '你' }), null);

// -- 布局：标准 26 键零布局，调键键帽标注（验收 3/7）--
jp.table = Object.fromEntries(Object.entries(jyutPack).filter(([k]) => !k.startsWith('_')));
eq('jyutping 26 键无附键', jp.layout.ROWS.join('').length + jp.layout.extraKeys.length, 26);
eq('jyutping 调键键帽角标（单敲/双敲同键）', [jp.layout.keyLabel('v').sub, jp.layout.keyLabel('x').sub, jp.layout.keyLabel('q').sub],
  ['调1/4', '调2/5', '调3/6']);
eq('jyutping 调键 title 讲透双敲', jp.layout.keyLabel('q').title.includes('同键连按两下') && jp.layout.keyLabel('v').title.includes('阳平调 4'), true);
eq('jyutping 字母键角标一层（无小字，移动端角标纪律预留）', [...'abcdefghijklmnoprstuw'].every(k => jp.layout.keyLabel(k).sub === ''), true);
eq('jyutping specialOf 全空（无描边键）', [...'abcdefghijklmnopqrstuvwxyz'].every(k => jp.layout.specialOf(k) === ''), true);

// -- 课程五阶（§2.5，验收 5）--
const jpCourse = courseOf('jyutping');
eq('jyutping 恰五阶且形态齐', [jpCourse.stages.length, jpCourse.stages.map(s => s.kind)],
  [5, ['keys', 'drill', 'practice', 'practice', 'mistakes']]);
eq('jyutping 阶 0 = 26 键键位图认知', jpCourse.stages[0].kind === 'keys' && jpCourse.stages[0].view === 'map' && jpCourse.stages[0].sub.includes('26 键'), true);
eq('jyutping 阶 0 六调辨义讲透（阴阳映射 + 入声 + 选 q/v/x 之因）', (() => {
  const b = jpCourse.stages[0].body;
  return [b.includes('调 1 阴平按 v'), b.includes('阳调同键连按两下'), b.includes('入声音节以 -p/-t/-k 收尾'),
    b.includes('不含这三个字母'), b.includes('sikv=色') && b.includes('sikqq=食')];
})(), [true, true, true, true, true]);
const jpDrill = jpCourse.stages[1];
eq('jyutping 阶 1 = 符号操练（SRS 单元=字母键+调键，§7 推断 3）', jpDrill.kind === 'drill' && jpDrill.unit === 'symbol', true);
eq('jyutping 阶 1 分组：声母 17 → 韵母 11 → 六调键 3 收尾', jpDrill.groups.map(g => g.keys.length), [17, 11, 3]);
eq('jyutping 阶 1 调键组单列双敲提示', jpDrill.groups[2].label.includes('阳调同键双敲') && jpDrill.groups[2].keys, ['v', 'x', 'q']);
eq('jyutping SRS 单元 = 22 拼写字母键 + 3 调键（声韵组共享 6 键，并集 25；唯 r 不入粤拼键位）', (() => {
  const ks = jpDrill.groups.flatMap(g => g.keys);
  const uniq = new Set(ks);
  return uniq.size === 25 && ks.length === 31 && !uniq.has('r');
})(), true);
eq('jyutping 阶 2 = 单字带调', jpCourse.stages[2].pools, ['chars']);
eq('jyutping 阶 3 = 单字深化（词表不截取裁定直陈，码长升序）', [jpCourse.stages[3].pools, jpCourse.stages[3].seq, jpCourse.stages[3].body.includes('首版不截取')],
  [['chars'], 'len', true]);
eq('jyutping 阶 4 = 错词本', jpCourse.stages[4].kind, 'mistakes');
eq('jyutping stageModes：阶 3 = chars@len（与阶 2 模式名可区分）', [stageModes(jpCourse.stages[2]), stageModes(jpCourse.stages[3])], [['chars'], ['chars@len']]);
// confus：调对（物理键直给），两侧皆可取题（真实带调表 + 内置池）
eq('jyutping 易混对皆调对（键直给）', jpCourse.confus.every(p => p.role === 'tone' && Array.isArray(p.keys)), true);
const jpBase = [...POOL.chars, ...POOL.words2].map(({ w, p }) => ({ word: w, py: p }));
for (const pair of jpCourse.confus) {
  const touch = (k) => jpBase.filter(e => {
    const c = jp.codeOf(e);
    return c && jp.planOf(c, e).keys.some(pk => pk.key === k && pk.role === 'tone');
  }).length;
  eq(`jyutping 易混对 ${pair.label} 可取题`, pair.keys.every(k => touch(k) > 0), true);
}
// 七日挑战谓词可判定（验收 5）
eq('jyutping 挑战七条齐', jpCourse.challenge.length, 7);
eq('jyutping 挑战 D2=调键操练', challengeMatch(jpCourse.challenge[1].match, 'finaldrill', jpCourse), true);
eq('jyutping 挑战 D3=单字带调', challengeMatch(jpCourse.challenge[2].match, 'chars', jpCourse) && !challengeMatch(jpCourse.challenge[2].match, 'chars@len', jpCourse), true);
eq('jyutping 挑战 D4=单字深化（@len 模式可区分）', challengeMatch(jpCourse.challenge[3].match, 'chars@len', jpCourse) && !challengeMatch(jpCourse.challenge[3].match, 'chars', jpCourse), true);
eq('jyutping 挑战 D5=声调对抗（confus 前缀）', challengeMatch(jpCourse.challenge[4].match, 'confus:2', jpCourse), true);
jp.table = null;

// -- syllablesOf 余例 --
eq('syllablesOf 连写串切分', syllablesOf('zhongguo'), ['zhong', 'guo']);
eq('syllablesOf 空', syllablesOf(''), []);

// ---- v4 #11：五笔画方案（SPEC-0004 §3，验收 8–12、26–30）----
const SK_TABLE = Object.fromEntries(Object.entries(strokePack).filter(([k]) => !k.startsWith('_')));

// -- 懒加载接缝：表未就绪不出题 --
eq('stroke 表未就绪 → 不出题', sk.codeOf({ word: '一' }), null);
sk.table = SK_TABLE;

// -- 单字查表出码（≥12 用例，全部与 pack 实值核对；验收 30）--
const SK_CASES = [
  ['一', 'h'], ['乙', 'z'], ['人', 'pn'], ['大', 'hpn'], ['中', 'szhs'], ['打', 'hzhhz'],
  ['小', 'zpn'], ['飞', 'zpn'], ['龙', 'hppzn'], ['土', 'hsh'], ['士', 'hsh'], ['方', 'nhzp'],
  ['火', 'nppn'], ['必', 'nznnp'], ['语', 'nzhszhszh'], ['说', 'nznpszhpz'], ['鹤', 'nzpsnhhhshpznzh'], ['练', 'zzhhzzpn'],
];
for (const [w, c] of SK_CASES) eq(`stroke.codeOf(${w})`, sk.codeOf({ word: w }), c);

// -- 多字词/缺字 → null 被取题过滤（验收 9）--
eq('stroke 二字词 → null（取题仅单字，§3.4）', sk.codeOf({ word: '中国', py: 'zhong guo' }), null);
eq('stroke 三字词 → null', sk.codeOf({ word: '王彬宇' }), null);
eq('stroke 整句 → null', sk.codeOf({ word: '中华人民共和国' }), null);
eq('stroke 表外字 → null（取题过滤）', sk.codeOf({ word: '龘' }), null);
eq('stroke 空条目 → null', sk.codeOf({}), null);
eq('stroke 形码只按 word 查表（§3.3）', sk.codeOf({ word: '一', py: '', srcCode: 'zzz', srcScheme: 'flypy' }), 'h');
eq('内置二字词池在五笔画下全被过滤（验收 9）', POOL.words2.filter(({ w }) => sk.codeOf({ word: w })).length, 0);
eq('内置字池 500 字全部可出五笔画题（单字题量 = GB2312 ∩ 池，验收 10）', POOL.chars.every(({ w }) => !!SK_TABLE[w]), true);

// -- plan = 逐笔展开：label = 笔画名（全提示即笔顺教学本身，验收 10）--
const pDa = sk.planOf('hzhhz', { word: '打' });
eq('stroke plan 扁平键序', pDa.keys.map(k => k.key), ['h', 'z', 'h', 'h', 'z']);
eq('stroke plan label = 笔画名', pDa.keys.map(k => k.label), ['横', '折', '横', '横', '折']);
eq('stroke plan role=root（形码易混对同机制）', pDa.keys.every(k => k.role === 'root'), true);
eq('stroke plan groups 空', pDa.groups, []);

// -- 布局：26 键复用，仅 h/s/p/n/z 点亮；角标康熙笔画字形（验收 9/12）--
eq('stroke 26 键无附键', sk.layout.ROWS.join('').length + sk.layout.extraKeys.length, 26);
eq('stroke 五键角标 = 康熙笔画字形 ⼀⼁⼃⼂⼄', ['h', 's', 'p', 'n', 'z'].map(k => sk.layout.keyLabel(k).sub), ['⼀', '⼁', '⼃', '⼂', '⼄']);
eq('stroke 五键 title 讲透归类规则（提归横/点归捺/带转折归折）', [sk.layout.keyLabel('h').title.includes('提归横'), sk.layout.keyLabel('n').title.includes('点归捺'), sk.layout.keyLabel('z').title.includes('带转折')], [true, true, true]);
eq('stroke 余 21 键暗面（无角标）', [...'abcdefgijklmoqrtuvwxy'].every(k => sk.layout.keyLabel(k).sub === ''), true);
eq('stroke specialOf 全空（五键皆取码，无描边键）', [...'abcdefghijklmnopqrstuvwxyz'].every(k => sk.layout.specialOf(k) === ''), true);

// -- 引擎零改动断言（验收 9）：仅用既有接口，渲染/引擎层零方案分支 --
const appSrc = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
eq('引擎零改动：app.js 零「stroke」方案分支（引号方案 id 全无）', !appSrc.includes("'stroke'") && !appSrc.includes('"stroke"'), true);
eq('引擎零改动：stroke 仅挂既有接口（无第三范式）', [sk.paradigm, typeof sk.codeOf, typeof sk.planOf, typeof sk.layout, typeof sk.activate], ['shape', 'function', 'function', 'object', 'function']);

// -- 课程五阶（§3.3，验收 10）--
const skCourse = courseOf('stroke');
eq('stroke 恰五阶且形态齐', [skCourse.stages.length, skCourse.stages.map(s => s.kind)],
  [5, ['keys', 'drill', 'practice', 'practice', 'mistakes']]);
eq('stroke 阶 0 = 五键认知（map 视图）', skCourse.stages[0].kind === 'keys' && skCourse.stages[0].view === 'map', true);
eq('stroke 阶 0 归类规则讲透（提归横/点归捺/带转折归折 + 康熙字形角标）', (() => {
  const b = skCourse.stages[0].body;
  return [b.includes('提归横'), b.includes('点归捺'), b.includes('带转折的笔画一律归折'), b.includes('⼀⼁⼃⼂⼄')];
})(), [true, true, true, true]);
const skDrill = skCourse.stages[1];
eq('stroke 阶 1 = 五键操练（symbol 单元，五键一组，全站最轻）', skDrill.kind === 'drill' && skDrill.unit === 'symbol' && skDrill.groups.length === 1, true);
eq('stroke 阶 1 组 = 五笔画键 hspnz', skDrill.groups[0].keys, ['h', 's', 'p', 'n', 'z']);
eq('stroke 阶 2 = 笔顺操练（chars@len：先少笔后多笔）', [skCourse.stages[2].pools, skCourse.stages[2].seq, stageModes(skCourse.stages[2])], [['chars'], 'len', ['chars@len']]);
eq('stroke 阶 2 文案体现码长分布（1–29 截集 / 1–84 全表 / 峰 10 笔）', (() => {
  const b = skCourse.stages[2].body;
  return [b.includes('1–29'), b.includes('1–84'), b.includes('10 笔')];
})(), [true, true, true]);
eq('stroke 阶 3 = 长字节奏（无词阶，直陈「词 = 逐字连打」）', [skCourse.stages[3].pools, skCourse.stages[3].body.includes('词 = 逐字连打')], [['chars'], true]);
eq('stroke 阶 3 无码长排序、模式名与阶 2 可区分', [stageModes(skCourse.stages[3]), skCourse.stages[3].seq], [['chars'], undefined]);
eq('stroke 阶 4 = 错词本', skCourse.stages[4].kind, 'mistakes');

// -- confus：底本差字（人工抽检标注）+ 形近字对（验收 11）--
eq('stroke 五易混对：底本差字 方/火/必 + 形近对 土/士、己/已', skCourse.confus.map(p => p.label),
  ['方 · 底本有差', '火 · 底本有差', '必 · 底本有差', '土/士 · 形近同码', '己/已 · 形近同码']);
eq('stroke 底本差字皆有人工抽检标注（验收 11）', skCourse.confus.slice(0, 3).every(p => (p.note || '').includes('人工抽检在案')), true);
eq('stroke 形近对码同（土/士 皆 hsh、己/已 皆 zhz）', [SK_TABLE['土'] === SK_TABLE['士'], SK_TABLE['己'] === SK_TABLE['已']], [true, true]);
eq('stroke 必 底本差异实例在案（上游异序 nznpn）', skCourse.confus[2].note.includes('nznpn') && SK_TABLE['必'] === 'nznnp', true);
eq('stroke 易混对键皆在五键域且 role 直给', skCourse.confus.every(p => p.role === 'root' && p.keys.every(k => 'hsnpz'.includes(k))), true);
const skBase = [...POOL.chars, ...POOL.words2].map(({ w, p }) => ({ word: w, py: p }));
for (const pair of skCourse.confus) {
  const touch = (k) => skBase.filter(e => {
    const c = sk.codeOf(e);
    return c && sk.planOf(c, e).keys.some(pk => pk.key === k && pk.role === 'root');
  }).length;
  eq(`stroke 易混对 ${pair.label} 可取题`, pair.keys.every(k => touch(k) > 0), true);
}

// -- 七日挑战谓词可判定（验收 10）--
eq('stroke 挑战七条齐', skCourse.challenge.length, 7);
eq('stroke 挑战 D2 = 五键操练', challengeMatch(skCourse.challenge[1].match, 'finaldrill', skCourse), true);
eq('stroke 挑战 D3 = 笔顺操练（chars@len 可区分）', challengeMatch(skCourse.challenge[2].match, 'chars@len', skCourse) && !challengeMatch(skCourse.challenge[2].match, 'chars', skCourse), true);
eq('stroke 挑战 D4 = 长字节奏（chars 可区分）', challengeMatch(skCourse.challenge[3].match, 'chars', skCourse) && !challengeMatch(skCourse.challenge[3].match, 'chars@len', skCourse), true);
eq('stroke 挑战 D5 = confus 前缀', challengeMatch(skCourse.challenge[4].match, 'confus:2', skCourse), true);
sk.table = null;
eq('stroke 表撤载 → 不出题', sk.codeOf({ word: '一' }), null);

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

// -- 布局：25 键角标字根全列 + Z 学习键单列（#13 M3：键帽不再用两字 tag）--
eq('wubi 键帽主显字母/角标字根全列', wb.layout.keyLabel('g'),
  { main: 'G', sub: '王 戋 五 一', title: '五笔 86 · 横区1位 · 键上字根：王 戋 五 一' });
eq('wubi 键帽全列长于两字摘要（F）', wb.layout.keyLabel('f').sub, '土 士 二 干 十 寸 雨');
eq('wubi 25 键角标皆为该键 roots 全列', Object.keys(WB_ROOTS).every((k) => wb.layout.keyLabel(k).sub === WB_ROOTS[k].roots), true);
eq('wubi 键帽 title 保全量（截断兜底）', Object.keys(WB_ROOTS).every((k) => wb.layout.keyLabel(k).title.includes(WB_ROOTS[k].roots)), true);
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

// -- 课程形态（SPEC-0004 §5.5 / #13 M3）：真包出货后默认五阶；setWubiCourseReady(false) 可回落降级 --
eq('wubi 默认可回落降级形态', (() => {
  setWubiCourseReady(false);
  const d = courseOf('wubi86');
  const got = [d.form, d.noChallenge, d.stages.length];
  setWubiCourseReady(true);
  return got;
})(), ['rootTable', true, 1]);
const wbCourse = courseOf('wubi86');
eq('wubi 就绪翻转完整五阶（降级 form 字段去除）', [wbCourse.form, wbCourse.noChallenge, wbCourse.stages.length], [undefined, undefined, 5]);
eq('wubi 五阶形态齐（字根认知/拆字操练/单字拆打/词组/易错）', wbCourse.stages.map(s => s.kind), ['keys', 'drill', 'practice', 'practice', 'mistakes']);
eq('wubi 认知阶无对应会话模式（视图阶不出题）', stageModes(wbCourse.stages[0]), []);
eq('wubi 入七日挑战（谓词七条 + 副标在案）', [wbCourse.challenge.length, wbCourse.challengeSub.length > 0], [7, true]);
eq('courseOf 五笔不回落小鹤', courseOf('wubi86').scheme, 'wubi86');
eq('wubi 课程进度读默认空态', store.getCourse('wubi86'), { stage: 0 });

// -- 取题仅单字：内置池语义（出题过滤在引擎 codeOf 层）--
eq('内置二字词池在五笔下全被过滤', POOL.words2.filter(({ w }) => wb.codeOf({ word: w })).length, 0);
eq('内置高频字池 500 字全部可出五笔题', POOL.chars.every(({ w }) => !!WB_TABLE[w]), true);

// -- 命名边界：站内文案零商标性字样（通称「五笔 86」；署名面在 licenses 页，豁免）--
const jsFiles = fs.readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
const scanned = ['index.html', ...jsFiles].map(f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
const mpProductFiles = fs.readdirSync(new URL('../miniprogram/pages/', import.meta.url), { recursive: true })
  .filter(f => f.endsWith('.wxml')).map(f => 'miniprogram/pages/' + f);
const productCopy = ['index.html', ...mpProductFiles].map(f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
eq('命名边界：站内零「五笔字型/王码」', /五笔字型|王码/.test(scanned), false);
eq('命名边界：产品面零上游名称', /CanCLID|rime-cantonese/.test(productCopy), false);
eq('命名边界：方案名即通称', [wb.id, wb.name, Object.values(SCHEMES).find(s => s.id === 'wubi86').name], ['wubi86', '五笔 86', '五笔 86']);

// ---- v3 #7：方案库 UI 数据模型（SPEC-0003 §5.1/§5.2/§5.4/§5.5，验收条目 17/20 的纯逻辑面）----
const sui = await import('../js/schemes-ui.js');

// -- 三层分组：旗舰小鹤顶层 + 音码组（7）+ 形码组（4），合计 12 卡无重复（条目 17 / #10 追加末位 / #11 形码组首位）--
eq('旗舰 = 小鹤', sui.FLAGSHIP_ID, 'flypy');
const groupIds = sui.GROUPS.flatMap(g => g.ids);
eq('方案库恰 12 卡（旗舰 1 + 组内 11，无重复）', new Set([sui.FLAGSHIP_ID, ...groupIds]).size === 12 && groupIds.length === 11, true);
eq('12 卡覆盖注册表全部方案', Object.keys(SCHEMES).every(id => id === sui.FLAGSHIP_ID || groupIds.includes(id)), true);
eq('音码组次序：自然码/微软/搜狗/智能ABC → 全拼 → 注音 → 粤拼（追加末位，§7 推断 2）',
  sui.GROUPS[0].ids, ['ziranma', 'mspy', 'sogou', 'abc', 'quanpin', 'zhuyin', 'jyutping']);
eq('形码组次序：五笔画（首位，入门叙事 #11）→ 仓颉 → 速成 → 五笔 86',
  sui.GROUPS[1].ids, ['stroke', 'cangjie', 'quick', 'wubi86']);
eq('分组科普行（§5.1 文案）', [sui.GROUPS[0].blurb, sui.GROUPS[1].blurb],
  ['音码 · 码即读音（全拼、五种双拼、注音、粤拼）', '形码 · 码即字形（五笔画、仓颉、速成、五笔）']);
eq('速成卡与仓颉卡相邻（互注前提，T5-D5）', sui.GROUPS[1].ids.indexOf('quick') - sui.GROUPS[1].ids.indexOf('cangjie'), 1);
// 命名边界（#10 验收 28）：粤拼产品文案（课程/卡片/分组）零上游仓名与机构名，署名只在 _meta 与 licenses
const jpProductCopy = JSON.stringify([courseOf('jyutping'), sui.CARD_FEATURES.jyutping, sui.GROUPS, sui.schemeHelpOf(SCHEMES.jyutping)]);
eq('命名边界：粤拼产品文案零 CanCLID/rime-cantonese', /CanCLID|rime-cantonese|CanCLID/.test(jpProductCopy), false);
// 命名边界（#11 验收 28）：五笔画产品文案（课程/卡片/科普）零上游仓名与机构名
const skProductCopy = JSON.stringify([courseOf('stroke'), sui.CARD_FEATURES.stroke, sui.schemeHelpOf(SCHEMES.stroke)]);
eq('命名边界：五笔画产品文案零 rime/CNS11643/數位發展部', /rime|CNS11643|數位|CanCLID/.test(skProductCopy), false);

// -- 卡片元数据：十二卡皆有一句话特点；关键文案按规格（条目 17）--
eq('十二卡皆备一句话特点', Object.keys(SCHEMES).every(id => typeof sui.CARD_FEATURES[id] === 'string' && sui.CARD_FEATURES[id].length > 0), true);
eq('自然码特点 = 与微软差 3 处（T4）', sui.CARD_FEATURES.ziranma, '与微软双拼仅差 3 处');
eq('注音特点 = 41 键大千布局 · 声调成字（T4）', sui.CARD_FEATURES.zhuyin, '41 键大千布局 · 声调成字');
eq('粤拼卡文案自拟（一句话特点，§8 缺口 1）', sui.CARD_FEATURES.jyutping, '六声调辨义 · 阴调单键、阳调同键双敲');
eq('速成卡互注文案（§5.1）', sui.CARD_FEATURES.quick, '速成 = 仓颉首尾二码，节奏更快');
eq('仓颉卡回指速成（互注双向，§5.1 / P4）', sui.CARD_FEATURES.cangjie.includes('速成'), true);
eq('五笔画卡文案 = 五键打字 · 形码第一步（#11 §3.4）', sui.CARD_FEATURES.stroke, '五键打字 · 形码第一步');

// -- 状态行：课程形态标签 + 五笔灰调标签（条目 17 / T5-D6；#13 后课程面已五阶，卡文案翻转留收尾轨）--
eq('课程形态：五阶课程（双拼/仓颉/速成/五笔画/注音/粤拼/五笔 86）', ['flypy', 'mspy', 'zhuyin', 'jyutping', 'stroke', 'cangjie', 'quick', 'wubi86'].map(sui.courseFormOf),
  ['五阶课程', '五阶课程', '五阶课程', '五阶课程', '五阶课程', '五阶课程', '五阶课程', '五阶课程']);
eq('课程形态：全拼 = 提速课程', sui.courseFormOf('quanpin'), '提速课程');
eq('五笔灰调标签文案已翻转（去「暂无五阶课程」）', sui.cardTagOf('wubi86'), '');
eq('余方案无灰调标签', Object.keys(SCHEMES).filter(id => id !== 'wubi86').every(id => sui.cardTagOf(id) === ''), true);

// -- 变化面：形码隐藏二字词/多字词/整句（条目 20 纯逻辑面，§5.4）--
eq('形码隐藏三模式（五笔画/仓颉/速成）', ['stroke', 'cangjie', 'quick'].every(id =>
  JSON.stringify(sui.hiddenModesFor(SCHEMES[id])) === JSON.stringify(['words2', 'words34', 'sentences'])), true);
eq('五笔放宽二字词、仍藏多字词与整句', sui.hiddenModesFor(SCHEMES.wubi86), ['words34', 'sentences']);
eq('音码不隐藏（双拼/全拼/注音/粤拼）', ['flypy', 'quanpin', 'zhuyin', 'jyutping'].every(id => sui.hiddenModesFor(SCHEMES[id]).length === 0), true);

// -- 切回态卡片摘要（条目 21 三态 1：课程第 N 阶 · 错词 X 条；五笔无课程阶不显课程段）--
store.addMistake('flypy', { word: '双拼', py: 'shuang pin', errPos: 0 });
store.addMistake('flypy', { word: '继续', py: 'ji xu', errPos: 1 });
store.addMistake('ziranma', { word: '测试', py: 'ce shi', errPos: 1 });
eq('小鹤摘要 = 课程第 5 阶 · 错词 2 条', sui.progressSummary('flypy'), '课程第 5 阶 · 错词 2 条');
eq('自然码摘要 = 课程第 1 阶 · 错词 1 条', sui.progressSummary('ziranma'), '课程第 1 阶 · 错词 1 条');
eq('五笔摘要含课程段（#13 升级五阶，默认阶 0 → 第 1 阶）', sui.progressSummary('wubi86'), '课程第 1 阶');

// -- 科普 details 块按方案数据驱动（§5.1 末段 / T5-D7）--
eq('小鹤科普：翘舌换位自方案表派生（zh→V/ch→I/sh→U）', sui.schemeHelpOf(SCHEMES.flypy).body.includes('zh 在 <b>V</b>') && sui.schemeHelpOf(SCHEMES.flypy).body.includes('按两下'), true);
eq('微软科普：o 引导零声母话术', sui.schemeHelpOf(SCHEMES.mspy).body.includes('O 引导'), true);
eq('全拼科普 = 码即拼音', sui.schemeHelpOf(SCHEMES.quanpin).summary, '什么是全拼？');
eq('注音标科普 = 声调成字', sui.schemeHelpOf(SCHEMES.zhuyin).body.includes('声调键'), true);
eq('粤拼科普 = 六调键收尾 + 零冲突之因', sui.schemeHelpOf(SCHEMES.jyutping).summary === '什么是粤拼？' && sui.schemeHelpOf(SCHEMES.jyutping).body.includes('不含 q、v、x'), true);
eq('形码科普 = 字形拆解 + 仅单字取题（仓颉）', sui.schemeHelpOf(SCHEMES.cangjie).body.includes('字形') && sui.schemeHelpOf(SCHEMES.cangjie).body.includes('仅单字'), true);
eq('五笔科普含词组 2+2', sui.schemeHelpOf(SCHEMES.wubi86).body.includes('2+2'), true);
eq('五笔卡文案已翻转', sui.CARD_FEATURES.wubi86, '五区字根 · 拆字逐步引导 · 词组 2+2');
eq('五笔画科普 = 五键 + 归类规则 + 形码第一步阶梯', sui.schemeHelpOf(SCHEMES.stroke).summary === '什么是五笔画？'
  && sui.schemeHelpOf(SCHEMES.stroke).body.includes('点归捺、提归横、带转折的笔画一律归折')
  && sui.schemeHelpOf(SCHEMES.stroke).body.includes('形码的第一步'), true);

// ---- v4 #13：五笔 86 全课程——引擎与课程面（SPEC-0004 §5.4–5.5，issue #13 轨道 B）----
// 夹具包开发：真包由轨道 A 管线产出（形态 {roots, keys, kind?, id?, note?, src}），本轨以夹具注入。
const wbFixture = JSON.parse(fs.readFileSync(new URL('fixture/wubi86-course.fixture.json', import.meta.url), 'utf8'));
const { planOfWubi, wubiWordCode, firstKeyOfWubi, rootNameOf, idNoteOf, fallbackPlanOf, bindWubiCourse } = wbm;
const wbFxEntries = Object.entries(wbFixture).filter(([k]) => !k.startsWith('_'));
const WB_FX_TABLE = Object.fromEntries(wbFxEntries);

// -- 夹具形状（§5.4 schema 紧凑形）--
eq('夹具条目皆带拆解三件（字根形序列/根键全码/人工定稿）',
  wbFxEntries.every(([, e]) => Array.isArray(e.roots) && e.roots.length > 0 && /^[a-y]{2,4}$/.test(e.keys) && e.src === 'human'), true);
eq('夹具特型封闭在案（键名/单笔画/成字字根，§5.3 R3）',
  [...new Set(wbFxEntries.map(([, e]) => e.kind).filter(Boolean))].sort(), ['单笔画', '成字字根', '键名']);
eq('夹具识别码条目自洽（键 = 末笔区 × 结构位，§5.3 R2）', (() => {
  const ZONE = { 1: 'gfd', 2: 'hjk', 3: 'tre', 4: 'yui', 5: 'nbv' };
  return wbFxEntries.filter(([, e]) => e.id).every(([, e]) =>
    e.keys.endsWith(e.id.key) && e.id.key === ZONE[e.id.last][e.id.struct - 1]);
})(), true);
eq('夹具与码表包一致（R1：包内最短码 = 全码或其前缀；一级简码例外）',
  wbFxEntries.every(([ch, e]) => WB_TABLE[ch] && (WB_TABLE[ch] === e.keys || e.keys.startsWith(WB_TABLE[ch]) || WB_TABLE[ch].length === 1)), true);
eq('夹具 rootNames 皆变体形（不覆盖正形）',
  Object.entries(wbFixture._meta.rootNames).every(([v]) => !Object.values(WB_ROOTS).some(r => r.roots.split(/\s+/).includes(v) && r.name === v)), true);

eq('课程字首码取拆解全码（我：T，不取一级简码 Q）', firstKeyOfWubi({ word: '我' }, WB_FX_TABLE, 'q'), 't');
const WB_WORD_CASES = [
  ['中国', 'khlg'], ['日子', 'jjbb'], ['日月', 'jjee'], ['子女', 'bbvv'], ['同学', 'mgip'],
  ['我国', 'trlg'], ['土地', 'fffb'], ['学好', 'ipvb'], ['和好', 'tkvb'], ['十一', 'fggg'],
  ['同一', 'mggg'], ['国土', 'lgff'], ['中日', 'khjj'], ['打字', 'rspb'], ['明月', 'jeee'], ['女王', 'vvgg'],
];
for (const [w, c] of WB_WORD_CASES) eq(`2+2 词码 ${w}`, wubiWordCode(w, WB_FX_TABLE), c);
eq('2+2：字不在课程池 → null（出题过滤接缝）', wubiWordCode('中龙', WB_FX_TABLE), null);
eq('2+2：非二字词 → null（三字及以上缓议，§1）', [wubiWordCode('王', WB_FX_TABLE), wubiWordCode('中国土', WB_FX_TABLE)], [null, null]);
eq('2+2：无表 → null', wubiWordCode('中国', null), null);

// -- 字根名映射与识别码注记料（§5.4/§5.5）--
eq('变体形经 rootNames 映射（扌→手/氵→水/⺌→兴字头）',
  ['扌', '氵', '⺌'].map(s => rootNameOf(s, wbFixture._meta.rootNames)), ['手', '水', '兴字头']);
eq('正形不经映射（日/十 原样）', [rootNameOf('日', wbFixture._meta.rootNames), rootNameOf('十', wbFixture._meta.rootNames)], ['日', '十']);
eq('识别码注记 = 末笔 · 结构（§5.5 例：末笔横 · 左右）',
  [idNoteOf({ last: 1, struct: 1 }), idNoteOf({ last: 2, struct: 2 }), idNoteOf({ last: 4, struct: 3 }), idNoteOf({ last: 5, struct: 1 })],
  ['末笔横 · 左右', '末笔竖 · 上下', '末笔捺 · 杂合', '末笔折 · 左右']);
eq('识别码注记兼容字符串区位（真包 id.last 为 "1"）',
  idNoteOf({ last: '1', struct: '1', key: 'g' }), '末笔横 · 左右');

// -- planOf 双形态：未注入保持 §4.2 兜底 --
eq('未注入：五笔 plan 保持 §4.2 兜底（role=码键、label=大写字母）',
  wb.planOf('khk', { word: '中' }), fallbackPlanOf('khk'));

// -- 注入口：夹具注入（收尾轨接真包）--
const wbBaseFns = { codeOf: wb.codeOf, planOf: wb.planOf };
bindWubiCourse(wb, wbFixture);
eq('注入口挂课程表与变体名表', [Object.keys(wb.courseTable).length, wb.rootNames['扌']], [wbFxEntries.length, '手']);

// -- 课程字全码档：逐步引导（① 日 J ② 月 E ③ 识别码 G，§5.5）--
eq('planOfWubi 直调：明全码 = 日 J / 月 E / 识别码 G',
  planOfWubi('jeg', { word: '明' }, WB_FX_TABLE, wbFixture._meta.rootNames).keys.map(k => `${k.label} ${k.key.toUpperCase()}`),
  ['日 J', '月 E', '识别码 G G']);
eq('识别码步注记（末笔横 · 左右）与字根步注记（键位话术料）', (() => {
  const ks = wb.planOf('jeg', { word: '明' }).keys;
  return [ks[2].note, ks[0].note, ks.map(k => k.role)];
})(), ['末笔横 · 左右', '键 J', ['root', 'root', 'root']]);
eq('变体形根经映射出字根名（打：扌→手，识别码 H 末笔竖 · 左右）',
  wb.planOf('rsh', { word: '打' }).keys.map(k => k.label), ['手', '丁', '识别码 H']);
eq('planOfWubi 直调：我全码四根（变体形 扌→手）',
  planOfWubi('trnt', { word: '我' }, WB_FX_TABLE, wbFixture._meta.rootNames).keys.map(k => k.label), ['丿', '手', '乙', '丿']);
eq('键名全码逐步（日 = 键名 · 同键连按四下）', (() => {
  const p = wb.planOf('jjjj', { word: '日' });
  return [p.keys.map(k => k.label), p.keys[0].note, p.keys[1].note];
})(), [['日', '日', '日', '日'], '键名 · 同键连按 4 下', '键 J']);
eq('成字字根逐步（十：键 + 首笔横 + 末笔竖）',
  wb.planOf('fgh', { word: '十' }).keys.map(k => k.label), ['十', '首笔横', '末笔竖']);
eq('单笔画全码（一：键键 + 笔画代码 ll）',
  wb.planOf('ggll', { word: '一' }).keys.map(k => k.label), ['一', '一', '笔画代码', '笔画代码']);

// -- 简码档：简码级与全码附注（我：一级简码 Q，全码 TRNT，§5.5）--
eq('简码附注：一级简码不合首根键（我=q 而全码 trnt）', (() => {
  const p = wb.planOf('q', { word: '我' });
  return [p.keys.map(k => k.label), p.keys[0].note];
})(), [['一级简码 Q'], '全码 TRNT']);
eq('简码附注：合首根前缀（和=t：字根步 + 一级简码，全码 TKG）',
  wb.planOf('t', { word: '和' }).keys[0], { key: 't', label: '禾', note: '键 T · 一级简码，全码 TKG', role: 'root' });
eq('简码附注：二级前缀（明=je：末步带全码注）',
  wb.planOf('je', { word: '明' }).keys[1].note, '键 E · 二级简码，全码 JEG');
eq('简码附注：键名简码（王=ggg → 全码 GGGG）',
  wb.planOf('ggg', { word: '王' }).keys[2].note, '全码 GGGG');
eq('简码档经包码真值（包内最短码直入）', [wb.codeOf({ word: '这' }), wb.planOf('p', { word: '这' }).keys[0].label], ['p', '一级简码 P']);

// -- 非课程字保持 §4.2 兜底（双形态分流）--
eq('注入后非课程字仍 §4.2 兜底（键：role=码键）', wb.planOf('qvfp', { word: '键' }), fallbackPlanOf('qvfp'));
eq('注入后导入单字兜底不变', wb.planOf('abc', { word: '龘' }), fallbackPlanOf('abc'));

// -- codeOf 放宽：课程池二字词可出题（§3.4 对 wubi86 的放宽）--
eq('注入后二字词取题 = 2+2 词码', wb.codeOf({ word: '中国', py: 'zhong guo' }), 'khlg');
eq('注入后单字取题不变（码权威仍在码表包）', [wb.codeOf({ word: '明' }), wb.codeOf({ word: '我' })], ['je', 'q']);
eq('词中任一字不在课程池 → 不可出题', wb.codeOf({ word: '中龙' }), null);
eq('三字及以上维持仅单字纪律', [wb.codeOf({ word: '王彬宇' }), wb.codeOf({ word: '中华人民共和国' })], [null, null]);
eq('词 plan 键序 = 2+2 词码', wb.planOf('khlg', { word: '中国' }).keys.map(k => k.key), ['k', 'h', 'l', 'g']);
eq('词 plan 步骤 = 各字前两拆解（role=root）', wb.planOf('khlg', { word: '中国' }).keys.map(k => k.label), ['口', '丨', '囗', '王']);
eq('词 plan groups 标字界', wb.planOf('khlg', { word: '中国' }).groups,
  [{ word: '中', start: 0, len: 2 }, { word: '国', start: 2, len: 2 }]);
eq('内置词池经放宽后可出题者皆双字在课程池', (() => {
  const got = POOL.words2.filter(({ w }) => wb.codeOf({ word: w }));
  return got.length > 0 && got.every(({ w }) => [...w].every(ch => !!wb.courseTable[ch]));
})(), true);

// -- 课程五阶结构（§5.5 数据面）--
eq('wubi 阶 0 = 字根认知（roots 视图 + 五区叙事）',
  [wbCourse.stages[0].kind, wbCourse.stages[0].view, wbCourse.stages[0].body.includes('五区')], ['keys', 'roots', true]);
eq('wubi 阶 0 分组 = 五区 × 五键（区位号只进组文案助记）',
  [wbCourse.stages[0].groups.map(g => g.keys.length), wbCourse.stages[0].groups.map(g => g.label)],
  [[5, 5, 5, 5, 5], ['横区 · 区位 11–15', '竖区 · 区位 21–25', '撇区 · 区位 31–35', '捺区 · 区位 41–45', '折区 · 区位 51–55']]);
eq('wubi 阶 0 letters = WB_ROOTS 映射（25 键、Z 不入）',
  Object.keys(wbCourse.stages[0].letters).sort().join(''), 'abcdefghijklmnopqrstuvwxy');
eq('wubi 阶 0 letters 与总表同源（键名/字根形清单/例字）',
  Object.entries(WB_ROOTS).every(([k, r]) => {
    const L = wbCourse.stages[0].letters[k];
    return L.name === r.name && L.forms === r.roots && L.ex === r.ex && L.note.includes(`${r.zone}区${r.pos}位`);
  }), true);
const wbDrill = wbCourse.stages[1];
eq('wubi 阶 1 = 拆字操练（wbkey 单元，Z 不入）', [wbDrill.kind, wbDrill.unit], ['drill', 'wbkey']);
eq('wubi 阶 1 SRS 单元 = 25 码键',
  wbDrill.groups.flatMap(g => g.keys).sort().join(''), 'abcdefghijklmnopqrstuvwxy');
eq('wubi 阶 1 供字根形反查键（「字根形在哪键」反表）', [wbDrill.roots['王'], wbDrill.roots['日'], wbDrill.roots['已']], ['g', 'j', 'n']);
eq('wubi 阶 2 = 单字拆打（chars@len，先简字后满码）',
  [stageModes(wbCourse.stages[2]), wbCourse.stages[2].body.includes('末笔 · 结构')], [['chars@len'], true]);
eq('wubi 阶 3 = 词组真词出题（words2 池 + 2+2 口径文案）',
  [stageModes(wbCourse.stages[3]), wbCourse.stages[3].body.includes('前两键连打') && wbCourse.stages[3].body.includes('KHLG')],
  [['words2'], true]);
eq('wubi 阶 3 与阶 2 模式名可区分', stageModes(wbCourse.stages[2]).concat(stageModes(wbCourse.stages[3])), ['chars@len', 'words2']);
eq('wubi 阶 4 = 错词本', wbCourse.stages[4].kind, 'mistakes');

// -- confus 形近字根对：供给形状 + 两侧课程字可取题（夹具注入态）--
eq('wubi 易混对皆形近字根对（role 直给 + 辨形注记）',
  wbCourse.confus.every(p => p.role === 'root' && p.keys.length === 2 && p.note), true);
eq('wubi 易混对键皆在 25 码键域且跨键',
  wbCourse.confus.every(p => p.keys[0] !== p.keys[1] && p.keys.every(k => 'abcdefghijklmnopqrstuvwxy'.includes(k))), true);
eq('wubi 易混对四对（日/目、禾/木、刀/力、儿/几）',
  wbCourse.confus.map(p => p.label), ['日/目 · 形近字根', '禾/木 · 形近字根', '刀/力 · 形近字根', '儿/几 · 形近字根']);
for (const pair of wbCourse.confus) {
  const touch = (k) => wbFxEntries.filter(([ch]) => {
    const c = WB_TABLE[ch];
    return c && wb.planOf(c, { word: ch }).keys.some(u => u.key === k && u.role === 'root');
  }).length;
  eq(`wubi 易混对 ${pair.label} 两侧课程字可取题`, pair.keys.every(k => touch(k) > 0), true);
}

// -- 七日挑战谓词可判定 --
eq('wubi 挑战七条齐且标签可判', [wbCourse.challenge.length, wbCourse.challenge.every(i => i.tag && i.label)], [7, true]);
eq('wubi 挑战 D1 any 谓词', challengeMatch(wbCourse.challenge[0].match, 'chars', wbCourse), true);
eq('wubi 挑战 D2 = 拆字操练', challengeMatch(wbCourse.challenge[1].match, 'finaldrill', wbCourse), true);
eq('wubi 挑战 D3 = 单字拆打（@len 可区分）',
  challengeMatch(wbCourse.challenge[2].match, 'chars@len', wbCourse) && !challengeMatch(wbCourse.challenge[2].match, 'chars', wbCourse), true);
eq('wubi 挑战 D4 = 词组 words2', challengeMatch(wbCourse.challenge[3].match, 'words2', wbCourse) && !challengeMatch(wbCourse.challenge[3].match, 'chars', wbCourse), true);
eq('wubi 挑战 D5 = confus 前缀', challengeMatch(wbCourse.challenge[4].match, 'confus:1', wbCourse), true);
eq('wubi 挑战 D6/D7 = sprint/mixed',
  challengeMatch(wbCourse.challenge[5].match, 'sprint', wbCourse) && challengeMatch(wbCourse.challenge[6].match, 'mixed', wbCourse), true);

// -- 撤注入：回落降级形态语义（不污染后续断言）--
wb.codeOf = wbBaseFns.codeOf; wb.planOf = wbBaseFns.planOf; delete wb.courseTable; delete wb.rootNames;
eq('撤注入后回落 §4.2 兜底与仅单字纪律',
  [wb.planOf('khk', { word: '中' }).keys[0].role, wb.codeOf({ word: '中国' })], ['码键', null]);

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
eq('SW CACHE 串与发布版本同步（v0.0.4）', cacheName, 'helian-v0.0.4');
const shellKeys = [...cacheStores.get(cacheName).keys()];
eq('packs.js / licenses.html / courses.js / zhuyin.js / jyutping.js / cangjie.js / wubi.js 入 SHELL', ['/js/packs.js', '/licenses.html', '/js/courses.js', '/js/zhuyin.js', '/js/jyutping.js', '/js/cangjie.js', '/js/wubi.js'].every(u => shellKeys.includes(u)), true);
eq('#7 新视图 js/css 入 SHELL（审计-§8 纪律）', ['/js/schemes-ui.js', '/css/schemes.css'].every(u => shellKeys.includes(u)), true);
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
