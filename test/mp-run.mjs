// 小程序逻辑层 node 回归：wx shim + 逐层断言（方案码/存储/迁移/包装载/引擎判定）。
// 运行：node test/mp-run.mjs
import { createRequire } from 'module';
import { statSync } from 'node:fs';

const storage = new Map();
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => { storage.set(k, v); },
  removeStorageSync: (k) => { storage.delete(k); },
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  showToast: () => {},
};

const req = createRequire(new URL('../miniprogram/utils/', import.meta.url));
const { SCHEMES, getScheme } = req('./schemes.js');
const { store, migrate } = req('./store.js');
const { loadPack, packState, bindPack, lookupChars, __resetForTest } = req('./packs.js');
const { BUILTIN } = req('./data.js');
const engine = req('./engine.js');

let passed = 0, failed = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log('  ok', name); }
  else { failed++; console.log('FAIL', name, '\n  got :', g, '\n  want:', w); }
}
function ok(name, cond) {
  if (cond) { passed++; console.log('  ok', name); }
  else { failed++; console.log('FAIL', name); }
}

console.log('== 方案码 ==');
eq('flypy 你好→nihc', getScheme('flypy').codeOf({ word: '你好', py: 'ni hao' }), 'nihc');
eq('flypy 单字 你→ni', getScheme('flypy').codeOf({ word: '你', py: 'ni' }), 'ni');
eq('quanpin 你好→nihao', getScheme('quanpin').codeOf({ word: '你好', py: 'ni hao' }), 'nihao');
ok('flypy plan 键数=码长', getScheme('flypy').planOf('nihc', { word: '你好', py: 'ni hao' }).keys.length === 4);
  ok('SCHEMES 十二件套齐（+粤拼、五笔画，v4 同步）', ['flypy', 'mspy', 'sogou', 'abc', 'ziranma', 'quanpin', 'zhuyin', 'jyutping', 'stroke', 'cangjie', 'quick', 'wubi86'].every(id => SCHEMES[id]));

console.log('== 存储 ==');
eq('迁移首跑', migrate(), 'fresh');
eq('迁移二跑', migrate(), null);
const s = store.getSettings();
eq('默认方案', s.scheme, 'flypy');
s.sound = true; store.setSettings(s);
eq('settings 回环', store.getSettings().sound, true);
store.addSession({ ts: Date.now(), mode: 'chars', secs: 60, acc: 95, kpm: 120, total: 120, scheme: 'flypy', words: 20 });
eq('sessions 记一条', store.getSessions().length, 1);
store.addMistake('flypy', { word: '你好', py: 'ni hao', errPos: 2 });
store.addMistake('flypy', { word: '你好', py: 'ni hao', errPos: 3 });
const mk = store.getMistakes('flypy');
eq('错词去重累计', [mk.length, mk[0].n], [1, 2]);
store.srsTouch('flypy', 'c', true);
eq('srs 升盒', store.getSRS('flypy').c.box, 2);
eq('srs 未到期', store.srsDueKeys('flypy').length, 0);
store.addKey('flypy', 'n', true); store.addKey('flypy', 'n', false); store.flushKeys();
eq('键位统计', store.getKeyStats('flypy').n, [2, 1]);

console.log('== 包装载 ==');
await loadPack('zhuyin');
eq('注音包就绪', packState('zhuyin'), 'ready');
await loadPack('wubi86');
const wb = getScheme('wubi86');
await wb.activate();
eq('小程序五笔课程包可读', packState('wubi86-course'), 'ready');
ok('小程序五笔课程表已绑定', !!wb.courseTable && Object.keys(wb.courseTable).length >= 500, true);
ok('五笔查表非空', typeof wb.codeOf({ word: '你', py: 'ni' }) === 'string' && wb.codeOf({ word: '你', py: 'ni' }).length > 0);
eq('五笔键帽角标字根全列', wb.layout.keyLabel('g').sub, '王 戋 五 一');
eq('小程序五笔普通课程字 full plan 可展开', wb.planOf(wb.courseTable['中'].keys, { word: '中' }).keys.map(k => k.key), [...wb.courseTable['中'].keys]);
eq('小程序五笔词阶精确 386 条', BUILTIN.words2.filter(({ w }) => wb.codeOf({ word: w })).length, 386);
eq('小程序教学扩展字不扩大词阶资格', ['集团', '身体', '土地'].map(word => wb.codeOf({ word })), [null, null, null]);
{
  const wbDrill = req('./courses.js').courseOf('wubi86').stages[1];
  engine.setScheme(wb);
  eq('五笔 G 键字根题可开局', engine.startDrill(wbDrill, 'g', ['g']).status, 'ok');
  const roots = [];
  for (let i = 0; i < 4; i++) {
    const snap = engine.snapshot();
    roots.push([snap.current.word, snap.expected, snap.planKeys.length]);
    engine.press(snap.expected);
  }
  eq('五笔 G 键四个字根固定入队且均为单键题', roots,
    [['王', 'g', 1], ['戋', 'g', 1], ['五', 'g', 1], ['一', 'g', 1]]);
}
eq('lookupChars 缺字', lookupChars(wb.table, '龘龘龘龘龘'), null);
await loadPack('cangjie5');
const cj = getScheme('cangjie');
await cj.activate();
ok('仓颉查表非空', typeof cj.codeOf({ word: '你', py: 'ni' }) === 'string');
__resetForTest();

console.log('== 引擎 ==');
const fly = getScheme('flypy');
engine.setScheme(fly);
const toasts = [];
engine.setToast(t => toasts.push(t));

let st = engine.startSession('chars');
eq('chars 开局', st.status, 'ok');
let wrong = 0, done = 0, result = null, presses = 0;
// 故意第一词第一键敲错一次，验证错判分支，随后全对走完 20 词
while (true) {
  const snap = engine.snapshot();
  if (!snap.active) break;
  const code = snap.expected;
  if (presses === 0) {
    const bad = engine.press(code[0] === 'z' ? 'q' : 'z');
    ok('错键反馈', bad && bad.ok === false && /应是/.test(bad.feedback));
    eq('错后位置未动', engine.snapshot().pos, 0);
  }
  for (const ch of code) {
    const r = engine.press(ch);
    presses++;
    if (!r.ok) { wrong++; continue; }
    if (r.wordDone) done++;
    if (r.sessionDone) { result = r.result; break; }
  }
  if (result) break;
}
eq('20 词全完', done, 20);
ok('结算落库', store.getSessions().length === 2 && store.getSessions()[1].words === 20);
ok('结算准确率', result.acc < 100 && result.acc >= 90); // 含 1 次故意错按
ok('错词本已记账', store.getMistakes('flypy').length >= 2);

// 冲刺模式：循环取题 + 时间到结算
st = engine.startSession('sprint');
eq('sprint 开局', st.status, 'ok');
let words = 0, wrapped = false;
for (let i = 0; i < 400; i++) {
  const snap = engine.snapshot();
  if (!snap.active) break;
  if (snap.idx === 0 && words > 0) { wrapped = true; break; } // 已循环回绕
  for (const ch of snap.expected) {
    const r = engine.press(ch);
    if (r.wordDone) words++;
    if (r.sessionDone) break;
  }
}
ok('sprint 有产出', words > 0);
ok('sprint 循环回绕（300 题打完回卷）', wrapped);
const sprintResult = engine.timeUp(); // 倒计时归零由页面调 timeUp 结算
ok('sprint 结算', sprintResult && sprintResult.words === words);

// 空池与过滤态
eq('错词池空态', (() => { store.clearMistakes('quanpin'); engine.setScheme(getScheme('quanpin')); const r = engine.startSession('mistakes'); engine.setScheme(fly); return r.status; })(), 'empty');
{
  const cjs = getScheme('cangjie');
  await cjs.activate();
  engine.setScheme(cjs);
  eq('形码过滤态', engine.startSession('words2').status, 'filtered');
  engine.setScheme(fly);
}

// 错键惩罚：开=整段清空回词首，关=标红续打（默认）
{
  const s = store.getSettings(); s.wrongPunish = true; store.setSettings(s);
  engine.startSession('chars');
  const snap = engine.snapshot();
  engine.press(snap.expected[0]); // 先对一键
  const r = engine.press(snap.expected[0] === 'a' ? 'b' : 'a'); // 再错一键
  ok('错键惩罚·整段清空返回', r.cleared === true);
  ok('错键惩罚·位点回词首', engine.snapshot().pos === 0);
  store.setSettings({ ...store.getSettings(), wrongPunish: false });
  const r2 = engine.press(engine.snapshot().expected[0] === 'a' ? 'b' : 'a');
  ok('标红续打·不清空', r2.cleared === false && engine.snapshot().pos >= 0);
  engine.finish();
}

// 数据备份（§D3）：导出打包全部信封 → 篡改后导入回写
{
  const before = store.getSettings();
  const bk = store.exportBackup();
  ok('备份 v1 信封', bk.v === 1 && bk.data && !!bk.data.settings);
  const s = store.getSettings(); s.showPy = !s.showPy; store.setSettings(s);
  const r = store.applyBackup(bk);
  ok('备份回写计数', r.ok && r.count >= 3);
  eq('备份恢复设置', store.getSettings().showPy, before.showPy);
  ok('非法备份拒收', store.applyBackup({ v: 2 }).ok === false && store.applyBackup(null).ok === false);
}

console.log('== 粤拼（SPEC-0004 §2 小程序同步）==');
{
  const jpm = req('./jyutping.js');
  const jp = getScheme('jyutping');
  const jpRaw = req('../data/packs/jyutping-tones.v1.json');
  const { courseOf, stageModes, challengeMatch } = req('./courses.js');
  const { GROUPS, CARD_FEATURES } = req('./schemes-ui.js');
  const { paradigmTags } = req('./ui.js');

  // 派生基元
  eq('粤拼派生 nei5→neixx（调5双敲）', jpm.keysOfToned('nei5'), 'neixx');
  eq('粤拼派生 sik1→sikv（调1单敲）', jpm.keysOfToned('sik1'), 'sikv');
  eq('粤拼派生 si6→siqq（阳调双敲）', jpm.keysOfToned('si6'), 'siqq');
  eq('粤拼派生 无调→null', jpm.keysOfToned('nei'), null);
  const jpPlan = jpm.planOfToned('si6');
  eq('粤拼 plan 阳调单一单元（span=2 + note）', [jpPlan.at(-1).span, jpPlan.at(-1).note], [2, '阳去 · 同键连按两下']);

  // 包激活与查表
  await loadPack('jyutping');
  eq('粤拼包就绪', packState('jyutping'), 'ready');
  eq('粤拼包全量单字与预算', [jpRaw._meta.sourceChars >= 27000, jpRaw._meta.charEntries >= 27000,
    statSync(new URL('../miniprogram/data/packs/jyutping-tones.v1.json', import.meta.url)).size <= 500 * 1024], [true, true, true]);
  await jp.activate();
  eq('jyutping.codeOf 单字阴调', jp.codeOf({ word: '中' }), 'zungv');
  eq('jyutping.codeOf 词组连打', jp.codeOf({ word: '中国' }), 'zungvgwokq');
  eq('jyutping.displayOf 带调串', jp.displayOf({ word: '中国' }), 'zung1 gwok3');
  const pJp = jp.planOf('zungvgwokq', { word: '中国' });
  eq('jyutping plan groups（双敲计 2）', pJp.groups, [{ syl: 'zung1', start: 0, len: 5 }, { syl: 'gwok3', start: 5, len: 5 }]);
  jp.table['是你'] = 'si6 nei5';
  eq('jyutping 多音节 groups.start 按物理 span 累计', jp.planOf('siqqneixx', { word: '是你' }).groups,
    [{ syl: 'si6', start: 0, len: 4 }, { syl: 'nei5', start: 4, len: 5 }]);
  delete jp.table['是你'];
  eq('jyutping 26 键零布局', jp.layout.ROWS.join('').length + jp.layout.extraKeys.length, 26);
  eq('jyutping 调键角标', [jp.layout.keyLabel('v').sub, jp.layout.keyLabel('x').sub, jp.layout.keyLabel('q').sub], ['调1/4', '调2/5', '调3/6']);

  // 引擎：阳调双敲单元内第二敲出错 → 反馈仍指回同一连击单元（span 感知）
  engine.setScheme(jp);
  const prep = engine.prepareEntry({ word: '是', py: 'shi', weight: 1 });
  ok('粤拼练习池可出题（桥覆盖内置池）', !!prep && prep.code.length > 0);
  let hitDouble = false;
  for (let round = 0; round < 5 && !hitDouble; round++) {
    const s0 = engine.startSession('chars');
    if (s0.status !== 'ok') break;
    while (true) {
      const snap = engine.snapshot();
      if (!snap.active) break;
      const dbl = snap.planKeys.findIndex(k => k.span === 2);
      if (dbl >= 0) {
        const start = snap.planKeys.slice(0, dbl).reduce((n, k) => n + (k.span || 1), 0);
        for (let i = 0; i < start + 1; i++) engine.press(snap.expected[i]); // 走到双敲第二敲
        const bad = engine.press(snap.expected[start + 1] === 'a' ? 'b' : 'a');
        ok('阳调双敲·错键反馈带连按注记', bad && bad.ok === false && /同键连按两下/.test(bad.feedback));
        ok('阳调双敲·步号按单元计', /第 \d+ 步应是/.test(bad.feedback));
        hitDouble = true;
        break;
      }
      for (const ch of snap.expected) {
        const r = engine.press(ch);
        if (r.sessionDone) break;
      }
    }
  }
  ok('粤拼池内存在阳调双敲词（反馈路径可达）', hitDouble);

  // 课程五阶与方案库呈现
  const jc = courseOf('jyutping');
  eq('jyutping 恰五阶', jc.stages.map(s => s.kind), ['keys', 'drill', 'practice', 'practice', 'mistakes']);
  eq('jyutping 阶 3 = chars@len（单字深化）', stageModes(jc.stages[3]), ['chars@len']);
  ok('jyutping 易混对皆调对', jc.confus.every(p => p.role === 'tone' && Array.isArray(p.keys)));
  eq('jyutping 挑战七条', jc.challenge.length, 7);
  ok('jyutping 挑战 D4 区分 chars/chars@len', challengeMatch(jc.challenge[3].match, 'chars@len', jc) && !challengeMatch(jc.challenge[3].match, 'chars', jc));
  ok('方案库音码组含粤拼（末位）', GROUPS[0].ids.at(-1) === 'jyutping');
  ok('粤拼卡一句话特点在案', !!CARD_FEATURES.jyutping);
  eq('粤拼范式标签不挂双拼', paradigmTags(jp), ['音码']);
  engine.setScheme(fly);
}

console.log('== 五笔画（SPEC-0004 §3 小程序同步）==');
{
  const sk = getScheme('stroke');
  const { courseOf, stageModes, challengeMatch } = req('./courses.js');
  const { GROUPS, CARD_FEATURES, hiddenModesFor } = req('./schemes-ui.js');
  const raw = req('../data/packs/stroke.v1.json');
  const entries = Object.keys(raw).filter(k => !k.startsWith('_'));

  eq('五笔画包可读', await loadPack('stroke').then(() => packState('stroke')), 'ready');
  await sk.activate();
  eq('五笔画包 6763 字', entries.length, 6763);
  eq('五笔画包 raw ≤150KB', statSync(new URL('../miniprogram/data/packs/stroke.v1.json', import.meta.url)).size <= 150 * 1024, true);
  eq('五笔画包署名与底本在案', [raw._meta.license, raw._meta.attribution.includes('數位發展部, CNS11643'), /方\/火\/必/.test(raw._meta.baseText)], ['LGPL-3.0', true, true]);
  eq('stroke 单字查表', [sk.codeOf({ word: '飞' }), sk.codeOf({ word: '龙' }), sk.codeOf({ word: '必' })], ['zpn', 'hppzn', 'nznnp']);
  eq('stroke 多字词不出题', sk.codeOf({ word: '中国', py: 'zhong guo' }), null);
  eq('stroke plan 笔画标签', sk.planOf('hzhhz').keys.map(k => k.label), ['横', '折', '横', '横', '折']);
  eq('stroke 五键康熙角标', ['h', 's', 'p', 'n', 'z'].map(k => sk.layout.keyLabel(k).sub), ['⼀', '⼁', '⼃', '⼂', '⼄']);
  eq('stroke specialOf 全空', [...'abcdefghijklmnopqrstuvwxyz'].every(k => sk.layout.specialOf(k) === ''), true);

  const c = courseOf('stroke');
  eq('stroke 恰五阶', [c.stages.length, c.stages.map(s => s.kind)], [5, ['keys', 'drill', 'practice', 'practice', 'mistakes']]);
  eq('stroke 五键操练组', [c.stages[1].unit, c.stages[1].groups[0].keys], ['symbol', ['h', 's', 'p', 'n', 'z']]);
  eq('stroke 无词阶明确逐字连打', [c.stages[3].pools, c.stages[3].body.includes('词 = 逐字连打')], [['chars'], true]);
  eq('stroke 笔顺阶按码长', stageModes(c.stages[2]), ['chars@len']);
  eq('stroke 挑战阶模式可判定', [challengeMatch(c.challenge[2].match, 'chars@len', c), challengeMatch(c.challenge[3].match, 'chars', c)], [true, true]);
  eq('stroke 形码组首位', GROUPS.find(g => g.id === 'shape').ids[0], 'stroke');
  eq('stroke 卡片特点', CARD_FEATURES.stroke, '五键打字 · 形码第一步');
  eq('stroke 隐藏所有词与整句模式', hiddenModesFor(sk), ['words2', 'words34', 'sentences']);
  engine.setScheme(sk);
  const strokeKeys = [];
  eq('stroke 五键单键操练可开局', engine.startDrill(c.stages[1], 'h', ['h', 's', 'p', 'n', 'z']).status, 'ok');
  for (let i = 0; i < 5; i++) {
    const snap = engine.snapshot();
    strokeKeys.push([snap.current.word, snap.expected, snap.planKeys.length]);
    engine.press(snap.expected);
  }
  eq('stroke 五键题均为一笔画见键', strokeKeys, [['横', 'h', 1], ['竖', 's', 1], ['撇', 'p', 1], ['捺', 'n', 1], ['折', 'z', 1]]);
  eq('stroke 引擎单字按码长可开局', engine.startSession('chars@len').status, 'ok');
  ok('stroke 引擎 plan 使用笔画标签', engine.snapshot().planKeys.every(k => ['横', '竖', '撇', '捺', '折'].includes(k.label)), true);
  engine.finish();
  eq('stroke 引擎二字词全过滤', engine.startSession('words2').status, 'filtered');
  engine.setScheme(fly);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
