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
  zrm = SCHEMES.ziranma, qp = SCHEMES.quanpin;
const code = (scheme, py) => scheme.codeOf({ word: '测', py });

// ---- 1. 方案接口完整性（§3.1）----
eq('默认方案仍为小鹤', DEFAULT_SCHEME, 'flypy');
eq('注册表 6 方案', SCHEME_LIST.length, 6);
for (const s of Object.values(SCHEMES)) {
  eq(`${s.id} 接口七件齐`, ['id', 'name', 'paradigm', 'codeOf', 'planOf', 'layout', 'activate'].every(k => s[k] !== undefined), true);
  eq(`${s.id} paradigm=phonetic`, s.paradigm, 'phonetic');
  eq(`${s.id} layout.ROWS 存在`, Array.isArray(s.layout.ROWS), true);
  eq(`${s.id} keyLabel 函数`, typeof s.layout.keyLabel, 'function');
  eq(`${s.id} specialOf 函数`, typeof s.layout.specialOf, 'function');
  eq(`${s.id} activate 立即就绪`, await s.activate(), undefined);
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
eq('SW CACHE 串随版本 bump', cacheName, 'helian-v0.0.4');
const shellKeys = [...cacheStores.get(cacheName).keys()];
eq('packs.js 与 licenses.html 入 SHELL', ['/js/packs.js', '/licenses.html'].every(u => shellKeys.includes(u)), true);
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
