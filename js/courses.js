// 课程数据（v3 课程数据化，SPEC-0003 §4.1 / §8 缺口 1，issue #3）。
//
// ===== 课程数据 schema v1（后续各范式课程照此格式产出）=====
// 每方案一份课程数据；每阶 = 课程数据 + 通用渲染器（渲染在 js/app.js，不含范式分支）。
// {
//   scheme: string,            // 方案 id
//   challengeSub: string,      // 七日挑战卡副标文案
//   stages: [                  // 恰 5 阶，形状固定；公共字段 name（阶名）/ sub（副标题）/ body（正文，'{n}'=错词数占位）
//     // kind='keys'     键位图认知/诊断：{view:'map'} 键位说明图 | {view:'heat'} 弱键热力图（点键即弱键特训）
//     // kind='drill'    间隔重复操练：{unit:'ymKey'|'syllable'|'symbol', items?:string[], groups?:[{label, keys}]}
//     //                 ymKey=韵母键（按钮自方案 layout+YM 派生，省略 items）；
//     //                 syllable=音节（items=高频音节清单，拼音串；SRS 单元即音节，维度不变）；
//     //                 symbol=符号键（注音：groups 分组清单 声符→介符→韵符→声调键，SRS 单元=键，含声调键〔规格推断〕5）
//     // kind='practice' 池取题练习：{pools:['chars'|'words2'|'words34'|'sentences']}，多池合并；
//     //                 会话模式名 = pools 以 '+' 连接
//     // kind='mistakes' 错词本取题（无额外字段；会话模式名 'mistakes'）
//     // drill 阶会话模式名恒为 'finaldrill'
//   ],
//   confus: [                  // 易混对（范式供给；练习页模式按钮与取题过滤皆由此驱动）
//     // 三形：
//     // {label, role:'sm'|'ym', a, b}  键位对——a/b 经方案声/韵表映射为物理键，按 plan 触达过滤（双拼）
//     // {label, ends:[u,v]}            音节尾对——词条任一音节以 u 或 v 结尾即入选（全拼前后鼻音类）
//     // {label, role, keys:[...]}      物理键直给——注音翘舌/鼻音等对（形码形近字母对 #5 供）
//   ],
//   challenge: [               // 七日挑战谓词（读范式课程数据，〔规格推断〕6）
//     // {tag, label, match}；match 四形：
//     // {any:true} 当日任意会话 | {stage:N} 第 N 阶对应的会话模式 | {modes:[...]} 显式模式 | {prefix:'confus'} 前缀
//   ],
// }
// 双拼五变体同范式复用同一骨架（§1 红线「同范式变体复用骨架只换映射」）；
// 全拼为「提速为核」骨架变体（T4-Q1）。字集/词集直取内置池（js/data.js），不新增数据。

import { splitPinyin } from './flypy.js';
import { ZY_GROUPS } from './zhuyin.js';

// ---- 双拼族（五变体共用骨架）----
const SP_CONFUS = [
  { label: 'in/ing', role: 'ym', a: 'in', b: 'ing' },
  { label: 'an/ang', role: 'ym', a: 'an', b: 'ang' },
  { label: 'en/eng', role: 'ym', a: 'en', b: 'eng' },
  { label: 'zh/z', role: 'sm', a: 'zh', b: 'z' },
  { label: 'ch/c', role: 'sm', a: 'ch', b: 'c' },
  { label: 'sh/s', role: 'sm', a: 'sh', b: 's' },
];
const SP_CHALLENGE = [
  { tag: 'D1', label: '任意一轮热身', match: { any: true } },
  { tag: 'D2', label: '韵母操练一轮', match: { stage: 1 } },
  { tag: 'D3', label: '单字一轮', match: { stage: 2 } },
  { tag: 'D4', label: '二字词一轮', match: { stage: 3 } },
  { tag: 'D5', label: '易混对抗一轮', match: { prefix: 'confus' } },
  { tag: 'D6', label: '限时冲刺一轮', match: { modes: ['sprint'] } },
  { tag: 'D7', label: '混合综合一轮', match: { modes: ['mixed', 'sentences'] } },
];
const SP_STAGES = [
  { kind: 'keys', view: 'map', name: '键位认知', sub: '一张图看懂当前方案键位' },
  { kind: 'drill', unit: 'ymKey', name: '韵母操练', sub: '逐键建立韵母反射（间隔重复）', body: '选一个韵母键反复练。带 <b class="due-dot">●</b> 的键是到期待复习键（间隔重复调度）。' },
  { kind: 'practice', pools: ['chars'], name: '单字练习', sub: '高频字码输入练习', body: '从内置高频字池按频抽题。建议先用「全提示」，顺手后切「仅按键」乃至「无提示」。' },
  { kind: 'practice', pools: ['words2'], name: '词组练习', sub: '二字词连贯输入', body: '从内置常用二字词池按频抽题。建议先用「全提示」，顺手后切「仅按键」乃至「无提示」。' },
  { kind: 'mistakes', name: '易错强化', sub: '从你的错词本取题', body: '错词本现有 {n} 条。答错的词会自动进错词本（上限 200 条），这里专门重练它们。' },
];
const shuangpinCourse = (id) => ({
  scheme: id, challengeSub: '每天一个小目标，七天入门双拼',
  stages: SP_STAGES, confus: SP_CONFUS, challenge: SP_CHALLENGE,
});

// ---- 全拼（提速为核：弱键诊断 → 高频音节 → 词组 → 长句 → 易错）----
// 阶 1 操练单元 = 高频音节表（取自内置池 chars 出现频次靠前的音节，§4.1 全拼列）
const QP_SYLLABLES = [
  'de', 'yi', 'shi', 'wo', 'zai', 'ren', 'you', 'ta', 'lai', 'ge',
  'shuo', 'shang', 'dao', 'jiu', 'da', 'na', 'ye', 'ma', 'hao', 'tian',
  'hai', 'hou', 'xiao', 'he', 'dui', 'xiang', 'qi', 'shen', 'sheng', 'tou',
  'duo', 'jia', 'mian', 'zhi', 'kai', 'ru', 'wu', 'hen', 'dian', 'qian',
];
const QUANPIN_COURSE = {
  scheme: 'quanpin', challengeSub: '每天一个小目标，七天入门全拼',
  stages: [
    { kind: 'keys', view: 'heat', name: '弱键诊断', sub: '键位图读热力图，直击易错键', body: '全拼的码就是拼音本身，没有键位映射可教——这一阶直接读你的击键热力图：颜色越红，错误率越高。点击任意键开始弱键特训。' },
    { kind: 'drill', unit: 'syllable', items: QP_SYLLABLES, name: '高频音节操练', sub: '逐音节建立键序反射（间隔重复）', body: '选一个高频音节反复练，键序就是拼音字母本身。带 <b class="due-dot">●</b> 的是到期待复习音节（间隔重复调度）。' },
    { kind: 'practice', pools: ['words2'], name: '词组提速', sub: '二字词连贯输入', body: '从内置常用二字词池按频抽题。全拼词组键数多，重点是把节奏练顺。建议先用「全提示」，顺手后切「仅按键」。' },
    { kind: 'practice', pools: ['words34', 'sentences'], name: '长句节奏', sub: '多字词与连句的长键序', body: '从内置多字词与连句池取题，练长键序下的节奏与呼吸。建议「仅按键」起步。' },
    { kind: 'mistakes', name: '易错强化', sub: '从你的错词本取题', body: '错词本现有 {n} 条。答错的词会自动进错词本（上限 200 条），这里专门重练它们。' },
  ],
  confus: [
    { label: 'ian/iang', ends: ['ian', 'iang'] },
    { label: 'an/ang', ends: ['an', 'ang'] },
    { label: 'en/eng', ends: ['en', 'eng'] },
    { label: 'in/ing', ends: ['in', 'ing'] },
  ],
  challenge: [
    { tag: 'D1', label: '任意一轮热身', match: { any: true } },
    { tag: 'D2', label: '音节操练一轮', match: { stage: 1 } },
    { tag: 'D3', label: '词组提速一轮', match: { stage: 2 } },
    { tag: 'D4', label: '长句节奏一轮', match: { stage: 3 } },
    { tag: 'D5', label: '易混对抗一轮', match: { prefix: 'confus' } },
    { tag: 'D6', label: '限时冲刺一轮', match: { modes: ['sprint'] } },
    { tag: 'D7', label: '混合综合一轮', match: { modes: ['mixed', 'sentences', 'words34'] } },
  ],
};

// ---- 注音（大千布局：声调键阶 1 收尾——无声调不出字，T4-Q4；字集 = 内置池 + 带调截取包）----
const ZHUYIN_COURSE = {
  scheme: 'zhuyin', challengeSub: '每天一个小目标，七天入门注音',
  stages: [
    { kind: 'keys', view: 'map', name: '键盘认知', sub: '一张图看懂 41 键大千布局',
      body: '大字是各键承载的注音符号，小字是物理键位。数字行左起是ㄅㄉ列（1/2）、韵符ㄞㄟㄠㄡ与调键ˊˇˋ（9/0、6/3/4）；字母行右侧一列收韵符与ㄥㄦ，底行含介符ㄩ与调键˙。第一声ˉ就是空格键。点击任意键查看说明。' },
    { kind: 'drill', unit: 'symbol', groups: [
        { label: `声符 ${ZY_GROUPS.sm.length} 键`, keys: ZY_GROUPS.sm },
        { label: `介符 ${ZY_GROUPS.jie.length} 键`, keys: ZY_GROUPS.jie },
        { label: `韵符 ${ZY_GROUPS.ym.length} 键`, keys: ZY_GROUPS.ym },
        { label: `声调键 ${ZY_GROUPS.tone.length} 键`, keys: ZY_GROUPS.tone },
      ],
      name: '符号操练', sub: '声符 → 介符 → 韵符 → 声调键（间隔重复）',
      body: '一键一键练：先声符，再接介符与韵符，最后是五个声调键——注音无声调不出字，声调键是键位学习的收尾。带 <b class="due-dot">●</b> 的键是到期待复习键（间隔重复调度）。' },
    { kind: 'practice', pools: ['chars'], name: '单字练习', sub: '单字含调，声调键首次应用',
      body: '从内置高频字池按频抽题，每字带调：先符号键、最后一键是声调键（第一声按空格）。建议先用「全提示」，顺手后切「仅按键」乃至「无提示」。' },
    { kind: 'practice', pools: ['words2'], name: '词组练习', sub: '二字词连贯输入',
      body: '从内置常用二字词池按频抽题，每个音节都以声调键收尾。建议先用「全提示」，顺手后切「仅按键」。' },
    { kind: 'mistakes', name: '易错强化', sub: '从你的错词本取题',
      body: '错词本现有 {n} 条。答错的词会自动进错词本（上限 200 条），这里专门重练它们。' },
  ],
  confus: [
    { label: 'ㄓ/ㄗ', role: 'sm', keys: ['5', 'y'] },
    { label: 'ㄔ/ㄘ', role: 'sm', keys: ['t', 'h'] },
    { label: 'ㄕ/ㄙ', role: 'sm', keys: ['g', 'n'] },
    { label: 'ㄈ/ㄏ', role: 'sm', keys: ['z', 'c'] },
    { label: 'ㄢ/ㄤ', role: 'ym', keys: ['0', ';'] },
    { label: 'ㄣ/ㄥ', role: 'ym', keys: ['p', '/'] },
  ],
  challenge: [
    { tag: 'D1', label: '任意一轮热身', match: { any: true } },
    { tag: 'D2', label: '符号操练一轮', match: { stage: 1 } },
    { tag: 'D3', label: '单字一轮', match: { stage: 2 } },
    { tag: 'D4', label: '词组一轮', match: { stage: 3 } },
    { tag: 'D5', label: '易混对抗一轮', match: { prefix: 'confus' } },
    { tag: 'D6', label: '限时冲刺一轮', match: { modes: ['sprint'] } },
    { tag: 'D7', label: '混合综合一轮', match: { modes: ['mixed'] } },
  ],
};

export const COURSES = {
  flypy: shuangpinCourse('flypy'),
  mspy: shuangpinCourse('mspy'),
  sogou: shuangpinCourse('sogou'),
  abc: shuangpinCourse('abc'),
  ziranma: shuangpinCourse('ziranma'),
  quanpin: QUANPIN_COURSE,
  zhuyin: ZHUYIN_COURSE,
};
export function courseOf(schemeId) { return COURSES[schemeId] || COURSES.flypy; }

// ---- 纯谓词（无 DOM，供渲染器与单测共用）----

// 拼音串 → 音节序列（方案无关通货）
export function syllablesOf(py) {
  const s = String(py || '').trim();
  if (!s) return [];
  return splitPinyin(s.replace(/\s+/g, '')) || s.split(/\s+/).filter(Boolean);
}

// 易混对物理键（键位对经方案声/韵表映射；形码 keys 直给预留）
export function confusKeys(pair, scheme) {
  if (pair.keys) return pair.keys;
  return [pair.a, pair.b].map(n => scheme.SM_KEYS[n] || scheme.YM[n] || n);
}

// 音节尾对匹配：任一音节以成员结尾即入选；非音节尾对返回 null
export function confusEndsMatch(py, pair) {
  if (!pair.ends) return null;
  return syllablesOf(py).some(s => pair.ends.some(t => s.endsWith(t)));
}

// 课程阶 → 会话模式名（drill='finaldrill'；practice=pools 以 '+' 连接；mistakes='mistakes'）
export function stageModes(stage) {
  if (!stage) return [];
  if (stage.kind === 'drill') return ['finaldrill'];
  if (stage.kind === 'practice') return [(stage.pools || []).join('+')];
  if (stage.kind === 'mistakes') return ['mistakes'];
  return [];
}

// 七日挑战谓词：会话模式是否命中 match（读范式课程数据机制，〔规格推断〕6）
export function challengeMatch(match, mode, course) {
  if (!match || !mode) return false;
  if (match.any) return true;
  if (match.prefix) return mode.startsWith(match.prefix);
  if (match.modes) return match.modes.includes(mode);
  if (match.stage != null) return stageModes(course.stages[match.stage]).includes(mode);
  return false;
}
