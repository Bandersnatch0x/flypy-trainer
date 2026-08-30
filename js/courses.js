// 课程数据（v3 课程数据化，SPEC-0003 §4.1 / §8 缺口 1，issue #3）。
//
// ===== 课程数据 schema v1（后续各范式课程照此格式产出）=====
// 每方案一份课程数据；每阶 = 课程数据 + 通用渲染器（渲染在 js/app.js，不含范式分支）。
// {
//   scheme: string,            // 方案 id
//   form?: 'rootTable',        // 降级形态（五笔 86，issue #6）：单阶课程 = 字根总表页（〔规格推断〕8）——
//                              //   stages 恰一阶 kind:'rootTable'（渲染器 js/app.js renderRootsPage，
//                              //   zones/roots 挂字根总表数据）；无 SRS 操练、不入七日挑战
//                              //   （noChallenge → 挑战卡不渲染，形态边界由页内空态直陈）、无易混对供给
//   challengeSub: string,      // 七日挑战卡副标文案
//   stages: [                  // 恰 5 阶，形状固定；公共字段 name（阶名）/ sub（副标题）/ body（正文，'{n}'=错词数占位）
//     // kind='keys'     键位图认知/诊断：{view:'map'} 键位说明图 | {view:'heat'} 弱键热力图（点键即弱键特训）
//     //                 | {view:'roots'} 形码字根认知（#5）：{groups:[{label,desc,keys}], letters:{键:{name,forms?,ex?,note?,special?}}}
//     //                 键帽主显字母、角标主字根，点键看字根例字（例字码按当前方案实时派生）；四类分区+特殊键单列
//     // kind='drill'    间隔重复操练：{unit:'ymKey'|'syllable'|'symbol'|'letter', items?:string[], groups?:[{label, keys}], roots?:{键:字根字}}
//     //                 ymKey=韵母键（按钮自方案 layout+YM 派生，省略 items）；
//     //                 syllable=音节（items=高频音节清单，拼音串；SRS 单元即音节，维度不变）；
//     //                 symbol=符号键（注音：groups 分组清单 声符→介符→韵符→声调键，SRS 单元=键，含声调键〔规格推断〕5）；
//     //                 letter=仓颉字母键（形码 #5：groups=四类分组；SRS 单元=24 字母，X 不教 Z 非取码；
//     //                 roots 供「字根 X 在哪键」一键题=字根本字；出字题打首码起的全码）
//     // kind='practice' 池取题练习：{pools:['chars'|'words2'|'words34'|'sentences'], seq?:'len'}，多池合并；
//     //                 会话模式名 = pools 以 '+' 连接（+'@'+seq）；seq:'len'=轮内按码长升序（先简字后满码，#5）
//     // kind='mistakes' 错词本取题（无额外字段；会话模式名 'mistakes'）
//     // kind='rootTable' 字根总表页（五笔 86 降级形态，#6）：无额外字段、无会话模式；渲染器读课程 zones/roots
//     // drill 阶会话模式名恒为 'finaldrill'
//   ],
//   confus: [                  // 易混对（范式供给；练习页模式按钮与取题过滤皆由此驱动）
//     // 三形：
//     // {label, role:'sm'|'ym', a, b}  键位对——a/b 经方案声/韵表映射为物理键，按 plan 触达过滤（双拼）
//     // {label, ends:[u,v]}            音节尾对——词条任一音节以 u 或 v 结尾即入选（全拼前后鼻音类）
//     // {label, role, keys:[...]}      物理键直给——注音翘舌/鼻音等对；形码形近字母对用 role:'root'（#5）
//   ],
//   challenge: [               // 七日挑战谓词（读范式课程数据，〔规格推断〕6）
//     // {tag, label, match}；match 四形：
//     // {any:true} 当日任意会话 | {stage:N} 第 N 阶对应的会话模式 | {modes:[...]} 显式模式 | {prefix:'confus'} 前缀
//   ],
// }
// 双拼五变体同范式复用同一骨架（§1 红线「同范式变体复用骨架只换映射」）；
// 全拼为「提速为核」骨架变体（T4-Q1）；仓颉为形码深教样板、速成复用其全五阶（T3，issue #5）。
// 字集/词集直取内置池（js/data.js），不新增数据。

import { splitPinyin } from './flypy.js';
import { ZY_GROUPS } from './zhuyin.js';
import { CJ_CATS, CJ_LETTERS } from './cangjie.js';
import { WB_ZONES, WB_ROOTS } from './wubi.js';

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
      body: '大字是各键承载的注音符号，小字是物理键位。数字行左起是声符ㄅㄉ（1/2）、调键ˇˋ（3/4）、声符ㄓ（5）、调键ˊ（6）、轻声点˙（7）、韵符ㄚㄞㄢ（8/9/0），ㄦ挂在「-」；字母三行承载其余符号，右半收介符ㄧㄨㄩ与ㄛㄟㄠㄡ等韵符（ㄟㄠㄡ在 o/l/.），底行「/」承载ㄥ。打完符号键必须补声调键才出字：ˊˇˋ˙分别在 6/3/4/7 键，第一声ˉ就是空格键。点击任意键查看说明。' },
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

// ---- 形码：仓颉深教样板 + 速成官方变体（§4.1 仓颉/速成列，issue #5）----
// 字集 = 内置高频字池（500 字，皆在 cangjie5 pack 内）+ 导入单字；取题仅单字（§3.4）。
const CJ_ROOT_GROUPS = [
  ...CJ_CATS.map(c => ({ label: `${c.label}类 · ${[...c.keys].map(k => CJ_LETTERS[k].name).join(' ')}`, desc: c.desc, keys: [...c.keys] })),
  { label: '特殊 · 难 X / 重 Z', desc: 'X 难（复合难拆形，不作首码）与 Z 重（重形键，不参与取码）单列，不进 24 字母间隔重复。', keys: ['x', 'z'] },
];
const CJ_DRILL_GROUPS = CJ_CATS.map(c => ({ label: `${c.label}类 · ${[...c.keys].map(k => CJ_LETTERS[k].name).join(' ')}`, keys: [...c.keys] }));
const CJ_ROOT_CHARS = Object.fromEntries(Object.entries(CJ_LETTERS).filter(([, v]) => !v.special).map(([k, v]) => [k, v.name]));
const CJ_CONFUS = [
  { label: '木/十', role: 'root', keys: ['d', 'j'] },
  { label: '日/月', role: 'root', keys: ['a', 'b'] },
  { label: '田/口', role: 'root', keys: ['w', 'r'] },
  { label: '大/人', role: 'root', keys: ['k', 'o'] },
];
const CJ_CHALLENGE = (s2, s3) => [
  { tag: 'D1', label: '任意一轮热身', match: { any: true } },
  { tag: 'D2', label: '拆字操练一轮', match: { stage: 1 } },
  { tag: 'D3', label: `${s2}一轮`, match: { stage: 2 } },
  { tag: 'D4', label: `${s3}一轮`, match: { stage: 3 } },
  { tag: 'D5', label: '形近对抗一轮', match: { prefix: 'confus' } },
  { tag: 'D6', label: '限时冲刺一轮', match: { modes: ['sprint'] } },
  { tag: 'D7', label: '混合综合一轮', match: { modes: ['mixed'] } },
];
const CJ_MISTAKES_STAGE = { kind: 'mistakes', name: '易错强化', sub: '从你的错词本取题', body: '错词本现有 {n} 条。答错的词会自动进错词本（上限 200 条），这里专门重练它们。' };

const cangjieStages = [
  { kind: 'keys', view: 'roots', groups: CJ_ROOT_GROUPS, letters: CJ_LETTERS,
    name: '字根认知', sub: '键帽仓颉字母 · 角标主字根 · 四类讲透 24 字母',
    body: '仓颉的码就是字形的拆解序列：每个键对应一个仓颉字母（字根）。键帽大字是字母，角标是主字根；24 个字母按「哲理、笔画、人体、字形」四类讲，X（难）Z（重）单列。点击任意键查看该字母的辅助字形与例字（例字码随当前方案派生）。' },
  { kind: 'drill', unit: 'letter', groups: CJ_DRILL_GROUPS, roots: CJ_ROOT_CHARS,
    name: '拆字操练', sub: '字根在哪键 · 出字问首码（间隔重复）',
    body: '逐字母间隔重复：一键题是「字根 X 在哪键」——字根本字只有一码，正是那个字母；多键题出字问首码，顺手把整条拆解打完。带 <b class="due-dot">●</b> 的字母是到期待复习字母（间隔重复调度）。' },
  { kind: 'practice', pools: ['chars'], seq: 'len',
    name: '单字拆打', sub: 'plan=拆分步骤序列 · 先简字后满码',
    body: '从内置高频字池逐字出题，plan 即拆分步骤序列。本阶先简字（1–3 码）后满码——同一轮内按码长自动升序。建议先用「全提示」：引导逐步读出「字根名＋字母」。' },
  { kind: 'practice', pools: ['chars'],
    name: '词组', sub: '构词=各字码连打 · 尾码锚点与包围结构',
    body: '仓颉打词组＝按书写顺序把各字的码连打；官方构词另有取码规则——词内单字取「首码、尾码、首尾二码或首、次、尾三码」，包围结构以尾码锚点（\'）分界首与身（如 囝=w\'nd：先外框 囗 后内部 子），便于定位词的尾码。本站 v3 取题仅单字，构词细则缓议——本阶仍练单字：把每个字的拆解打熟，词组连打水到渠成。' },
  CJ_MISTAKES_STAGE,
];

const CANGJIE_COURSE = {
  scheme: 'cangjie', challengeSub: '每天一个小目标，七天入门仓颉拆字',
  stages: cangjieStages, confus: CJ_CONFUS, challenge: CJ_CHALLENGE('单字拆打', '词组热身'),
};

const quickStages = [
  { ...cangjieStages[0],
    sub: '同仓颉：先认字母，再谈首尾' },
  { ...cangjieStages[1],
    name: '拆字操练', sub: '首尾码速认 · 出字只打首尾二码（间隔重复）',
    body: '操练单元同仓颉 24 字母；速成单字码至多两键——出字打「首码＋尾码」，本身就是首尾码速认。一键题仍是「字根 X 在哪键」。带 <b class="due-dot">●</b> 的字母是到期待复习字母（间隔重复调度）。' },
  { kind: 'practice', pools: ['chars'],
    name: '单字拆打', sub: '2 码短码 · 节奏更快',
    body: '速成单字皆 1–2 码（仓颉首尾派生），节奏更快。建议先用「全提示」，顺手后切「仅按键」乃至「无提示」。' },
  { ...cangjieStages[3],
    sub: '词组=各字首尾二码连打',
    body: '速成词组＝各字取仓颉首尾二码连打（官方 quick5 规则：一条 derive 由仓颉 base 运行时派生，零码表）。本站 v3 取题仅单字——本阶仍练单字：首尾二码打熟，词组连打水到渠成。' },
  CJ_MISTAKES_STAGE,
];

const QUICK_COURSE = {
  scheme: 'quick', challengeSub: '每天一个小目标，七天入门速成',
  stages: quickStages, confus: CJ_CONFUS, challenge: CJ_CHALLENGE('短码单字', '词组热身'),
};

// ---- 五笔 86（降级形态，§2/§4.1 五笔列，issue #6）----
// 课程视图内只有一阶：字根总表（25 键 × 键上字根，五区分组）+ 自由练习直达（仅单字出题）。
// 形态边界显式空态：无 SRS 操练阶、不入七日挑战（noChallenge → 挑战卡空态）、无易混对供给；
// 五阶课程缺位由单阶形态直陈（页内空态文案）。
const WUBI_COURSE = {
  scheme: 'wubi86', form: 'rootTable', noChallenge: true,
  challengeSub: '',
  stages: [
    { kind: 'rootTable', name: '字根总表', sub: '25 键 × 键上字根 · 自由练习仅单字',
      body: '五笔 86 的码取自字根：25 个取码键按「横、竖、撇、捺、折」五区排布，每键承载一组字根。先认键——点击任意键查看键上字根与例字（例字码随资料包派生）；再到练习页自由练习：仅单字出题，全提示会给出整条键序，并展开当前键的字根候选表。' },
  ],
  confus: [], challenge: [],
  zones: WB_ZONES, roots: WB_ROOTS,
};

export const COURSES = {
  flypy: shuangpinCourse('flypy'),
  mspy: shuangpinCourse('mspy'),
  sogou: shuangpinCourse('sogou'),
  abc: shuangpinCourse('abc'),
  ziranma: shuangpinCourse('ziranma'),
  quanpin: QUANPIN_COURSE,
  zhuyin: ZHUYIN_COURSE,
  cangjie: CANGJIE_COURSE,
  quick: QUICK_COURSE,
  wubi86: WUBI_COURSE,
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

// 课程阶 → 会话模式名（drill='finaldrill'；practice=pools 以 '+' 连接，+'@'+seq；mistakes='mistakes'）
export function stageModes(stage) {
  if (!stage) return [];
  if (stage.kind === 'drill') return ['finaldrill'];
  if (stage.kind === 'practice') return [(stage.pools || []).join('+') + (stage.seq ? '@' + stage.seq : '')];
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
