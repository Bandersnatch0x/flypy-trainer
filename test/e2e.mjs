// e2e：核心路径走查（Edge headless）
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = 'http://localhost:4173';
let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('ok  ' + name); }
  else { fail++; console.error('FAIL ' + name); }
};

// #7：方案切换走顶栏芯片 → 分组弹层（设置页下拉已废除）
async function switchScheme(p, id, settle = 300) {
  await p.click('#schemeChip');
  await p.waitForSelector('#schemePop:not(.hidden)');
  await p.click(`#schemePop button[data-scheme="${id}"]`);
  await p.waitForTimeout(settle);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => { fail++; console.error('PAGEERROR ' + e.message); });

await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });

// 1. 练习页骨架
check('标题含鹤练', await page.title().then(t => t.includes('鹤练')));
check('目标字渲染', await page.locator('#word').innerText().then(t => t.trim().length > 0));
const kbKeys = await page.evaluate(() => import('/js/schemes.js').then(m => {
  const s = m.getScheme(JSON.parse(localStorage.getItem('flypy.v1.settings'))?.data?.scheme || 'flypy');
  return s.layout.ROWS.join('').length + s.layout.extraKeys.length;
}));
check('键盘键数随布局', await page.locator('#kb .key').count().then(n => n === kbKeys));
check('引导含第 1 步', await page.locator('#guide').innerHTML().then(h => h.includes('第 1 步')));

// 2. 输错：抖动 + 提示应是哪键（先读正确码再挑一个错键）
const code1 = await page.locator('#hint b').innerText();
const wrongKey = code1[0] === 'q' ? 'w' : 'q';
await page.locator('#inbox').press(wrongKey);
const fb1 = await page.locator('#fb').innerText();
check('错键反馈含应是', fb1.includes('应是'));
check('错词入本后准确率下降', await page.locator('#sAcc').innerText().then(t => t !== '100%'));

// 3. 输入正确码 → 进度推进
await page.locator('#inbox').fill('');
for (const ch of code1) await page.locator('#inbox').press(ch);
await page.waitForTimeout(250);
check('进度 1/20', await page.locator('#sDone').innerText().then(t => t.startsWith('1/')));

// 4. 提示层级：仅按键 → 拼音码隐藏、引导清空
await page.click('input[name="hint"][value="keys"]');
await page.waitForTimeout(150);
check('仅按键档隐藏提示行', await page.locator('#hint').innerText().then(t => t.trim() === ''));
check('仅按键档无引导文字', await page.locator('#guide').innerText().then(t => t.trim() === ''));
check('仅按键档①高亮存在', await page.locator('#kb .key.smhi').count().then(n => n >= 1));

// 5. 课程页
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('五阶课程+挑战卡渲染', await page.locator('#stages li').count().then(n => n === 6));
check('键位全景图渲染', await page.locator('#kbmap .key').count().then(n => n === kbKeys));

// 6. 导入：上传小型 userdb 快照
const sample = 'jixu \u7ee7\u7eed\u0001c=12990 d=12990 t=150\nzhongguo \u4e2d\u56fd\u0001c=800 d=800 t=140\ndaima \u4ee3\u7801\u0001c=600 d=600 t=120\n';
fs.writeFileSync('sample.userdb.txt', sample);
await page.goto(BASE + '/#/import', { waitUntil: 'networkidle' });
await page.locator('#filein').setInputFiles('sample.userdb.txt');
await page.waitForTimeout(400);
const report = await page.locator('#report').innerText();
check('导入报告含条数', report.includes('3 条'));
check('导入报告声明本地解析', report.includes('未上传'));
check('词库列表出现文件', await page.locator('#liblist').innerText().then(t => t.includes('sample.userdb.txt')));

// 7. 我的词库模式可开练
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
await page.click('#modes button[data-mode="personal"]');
await page.waitForTimeout(200);
check('我的词库出题', await page.locator('#word').innerText().then(t => ['继续', '中国', '代码'].includes(t)));

// 8. 错词本有刚才的错词
await page.goto(BASE + '/#/mistakes', { waitUntil: 'networkidle' });
check('错词本有条目', await page.locator('#mklist .mk').count().then(n => n >= 1));

// 9. 统计页渲染
await page.goto(BASE + '/#/stats', { waitUntil: 'networkidle' });
check('统计四卡渲染', await page.locator('#totals div').count().then(n => n === 4));
check('热力键盘渲染', await page.locator('#kbheat .key').count().then(n => n === 26));

// 10. 隐私：无任何非本地网络请求（字体除外）
const reqs = [];
page.on('request', (r) => reqs.push(r.url()));
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
const foreign = reqs.filter(u => !u.startsWith(BASE) && !u.includes('fonts.g'));
check('无外部数据请求', foreign.length === 0);

// 11. V2：方案切换 / 集市 / 徽章 / 日历 / 冲刺入口
await switchScheme(page, 'mspy');
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('微软方案键盘含分号键', await page.locator('#kb .key[data-key=";"]').count().then(n => n === 1));
check('冲刺模式按钮存在', await page.locator('#modes button[data-mode="sprint"]').count().then(n => n === 1));
check('易混对抗按钮存在', await page.locator('#modes button[data-mode="confus:0"]').count().then(n => n === 1));
await page.goto(BASE + '/#/import', { waitUntil: 'networkidle' });
check('词表集市两包', await page.locator('#packs .lib').count().then(n => n === 2));
check('自定义词单输入框', await page.locator('#customText').count().then(n => n === 1));
await page.goto(BASE + '/#/stats', { waitUntil: 'networkidle' });
check('徽章墙七枚', await page.locator('#badges .badge').count().then(n => n === 7));
check('日历 365 格', await page.locator('#calendar i').count().then(n => n === 365));
check('分享卡按钮', await page.locator('#shareBtn').count().then(n => n === 1));
check('manifest 可达', await page.evaluate(() => fetch('/manifest.webmanifest').then(r => r.status === 200)));
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#shareBtn')]);
check('分享卡下载触发', !!dl);
// 冲刺冒烟：连击计数
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
await page.click('input[name="hint"][value="full"]');
await page.click('#modes button[data-mode="sprint"]');
await page.waitForTimeout(200);
const sprintCode = await page.locator('#hint b').innerText();
for (const ch of sprintCode) await page.locator('#inbox').press(ch);
await page.waitForTimeout(150);
check('冲刺连击计数', await page.locator('#sCombo').innerText().then(t => t === '1'));
check('冲刺倒计时格式', await page.locator('#sTime').innerText().then(t => /^0:\d\d$/.test(t)));
await page.goto(BASE + '/#/mistakes', { waitUntil: 'networkidle' });
check('Rime 导出按钮', await page.locator('#exportRime').count().then(n => n === 1));
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('七日挑战卡', await page.locator('#stages li.challenge').count().then(n => n === 1));
await switchScheme(page, 'flypy');

// 12. v3：新方案可切可练 + 练习中切换重算 queue（Alt+S 弹层入口，不落入输入流）
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
await page.click('#modes button[data-mode="chars"]');
await page.waitForTimeout(200);
await page.locator('#inbox').focus();
await page.keyboard.press('Alt+s');
await page.waitForTimeout(150);
check('Alt+S 练习中开弹层且不落输入流', await page.locator('#schemePop').evaluate(el => !el.classList.contains('hidden'))
  && await page.locator('#inbox').inputValue().then(v => v === ''));
await page.click('#schemePop button[data-scheme="quanpin"]');
await page.waitForTimeout(300);
check('练习中切换提示重新出题', await page.locator('#toast').innerText().then(t => t.includes('重新出题')));
check('全拼码文本为拼音串', await page.locator('#hint b').innerText().then(t => /^[a-z]+$/.test(t)));
check('全拼引导为步骤话术', await page.locator('#guide').innerText().then(t => t.includes('第 1 步')));
const qpKbKeys = await page.evaluate(() => import('/js/schemes.js').then(m => {
  const s = m.getScheme('quanpin');
  return s.layout.ROWS.join('').length + s.layout.extraKeys.length;
}));
check('全拼键盘键数随布局', await page.locator('#kb .key').count().then(n => n === qpKbKeys));
await switchScheme(page, 'ziranma');
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('自然码单字两键可练', await page.locator('#hint b').innerText().then(t => /^[a-z]{2}$/.test(t)));
await switchScheme(page, 'flypy');

// 13. v3 #2：data pack — 首访不下载 / 激活懒加载 / SW cache-first / 离线冒烟
//     做法：独立干净上下文；断网用 context.setOffline(true) 真实切断网络，
//     等价于「下载过 pack 后断网再激活」，无需拔线/关服务器。
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
await p2.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
await p2.evaluate(() => navigator.serviceWorker.ready);
await p2.reload({ waitUntil: 'networkidle' }); // 确保 SW 接管
const packReqs = [];
p2.on('request', (r) => { if (r.url().includes('/data/packs/')) packReqs.push(r.url()); });
await p2.reload({ waitUntil: 'networkidle' });
check('首访不下载任何 pack', packReqs.length === 0);
const noneCached = await p2.evaluate(async () => {
  for (const k of await caches.keys()) {
    const c = await caches.open(k);
    for (const u of ['/data/packs/wubi86.v1.json', '/data/packs/cangjie5.v1.json', '/data/packs/zhuyin-tones.v1.json']) {
      if (await c.match(u)) return false;
    }
  }
  return true;
});
check('首访缓存中无 pack 预置', noneCached);
const cjCount = await p2.evaluate(() => import('/js/packs.js').then(m => m.loadPack('cangjie5').then(t => Object.keys(t).length)));
check('首次激活懒加载得全表', cjCount === 20910);
const cachedAfter = await p2.evaluate(async () => {
  for (const k of await caches.keys()) if (await (await caches.open(k)).match('/data/packs/cangjie5.v1.json')) return true;
  return false;
});
check('pack 写入 SW 缓存（cache-first 持久层）', cachedAfter);
check('pack 不写 localStorage', await p2.evaluate(() =>
  ![...Object.entries(localStorage)].some(([k, v]) => k.includes('/data/packs') || v.length > 100000)), true);

// 离线冒烟：真实断网后重载，已下载方案再激活仍可用；未下载包标未就绪不阻塞
await ctx2.setOffline(true);
await p2.reload({ waitUntil: 'load' });
const offlineCount = await p2.evaluate(() => import('/js/packs.js')
  .then(m => m.loadPack('cangjie5').then(t => Object.keys(t).length).catch(() => -1)));
check('断网后再激活仍可用（SW cache-first）', offlineCount === 20910);
const wubiState = await p2.evaluate(() => import('/js/packs.js')
  .then(m => m.loadPack('wubi86').then(() => 'loaded', () => 'error')));
check('断网未下载包标未就绪（不阻塞）', wubiState === 'error');
await ctx2.setOffline(false);
await p2.close();
await ctx2.close();

// 14. v3 #2：「数据来源与许可」静态页 + 页脚链接
//     dev 用 serve 会把 /licenses.html 301 到 clean URL /licenses，两者同页；
//     线上（Vercel）直出 /licenses.html。此处按 dev 服务器走 /licenses。
await page.goto(BASE + '/licenses', { waitUntil: 'networkidle' });
check('数据来源与许可页渲染', await page.locator('h1').innerText().then(t => t.includes('数据来源与许可')));
check('许可页列上游出处（含五笔画与底本声明）', await page.locator('main').innerText().then(t =>
  t.includes('rime-wubi') && t.includes('rime-cangjie') && t.includes('rime-terra-pinyin')
  && t.includes('rime-stroke') && t.includes('數位發展部, CNS11643') && t.includes('笔顺底本') && t.includes('方、火、必')));
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('页脚含数据来源与许可链接', await page.locator('.foot a[href="licenses.html"]').count().then(n => n === 1));

// 15. v3 #3：课程数据化 —— 五阶形状 / 全拼五阶 / 进度 per-scheme / 易混对数据驱动
// 小鹤：易混对按钮由课程数据重建（六对，标签与次序保持）
check('易混按钮由课程数据重建（六对）', await page.locator('#modes button[data-mode^="confus:"]').count().then(n => n === 6));
check('易混按钮标签来自课程数据', await page.locator('#modes button[data-mode="confus:5"]').innerText().then(t => t === 'sh/s'));
// 小鹤进度推进到阶 2（单字练习）
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
await page.locator('#stages li:not(.challenge)').nth(2).click();
await page.waitForTimeout(150);
check('小鹤进度按方案落盘', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('flypy.v1.course.flypy'))?.data?.stage === 2));
check('单字练习正文数据驱动渲染', await page.locator('#stageBody h3').innerText().then(t => t === '单字练习'));
check('开始练习按钮在', await page.locator('#goStage').count().then(n => n === 1));
// 切全拼：课程从阶 0 起（进度独立），阶 0 = 弱键诊断热力图
await switchScheme(page, 'quanpin', 200);
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('全拼五阶+挑战卡渲染', await page.locator('#stages li').count().then(n => n === 6));
check('全拼阶 0 = 弱键诊断', await page.locator('#stages li:not(.challenge)').first().innerText().then(t => t.includes('弱键诊断')));
check('全拼进度从阶 0 起', await page.evaluate(() =>
  (JSON.parse(localStorage.getItem('flypy.v1.course.quanpin'))?.data?.stage ?? 0) === 0));
check('全拼阶 0 键位热力图渲染', await page.locator('#kbmap .key').count().then(n => n === 26));
check('全拼阶 0 点键弱键特训', await page.locator('#stageBody').innerText().then(t => t.includes('弱键特训')));
// 阶 1 高频音节操练：按钮数 = 课程数据音节清单长度
const qpDrillItems = await page.evaluate(() => import('/js/courses.js').then(m => m.courseOf('quanpin').stages[1].items.length));
await page.locator('#stages li:not(.challenge)').nth(1).click();
await page.waitForTimeout(150);
check('全拼音节操练按钮随课程数据', await page.locator('#finalkeys button').count().then(n => n === qpDrillItems));
// 阶 3 长句节奏：合并池（words34+sentences）可开练
await page.locator('#stages li:not(.challenge)').nth(3).click();
await page.waitForTimeout(150);
check('全拼阶 3 = 长句节奏', await page.locator('#stageBody h3').innerText().then(t => t === '长句节奏'));
await page.click('#goStage');
await page.waitForTimeout(250);
check('全拼长句练习出题（长词条）', await page.locator('#word').innerText().then(t => [...t].length >= 3));
check('全拼码文本为拼音串（开卷）', await page.locator('#hint b').innerText().then(t => /^[a-z]+$/.test(t)));
// 全拼易混对 = 课程数据四对（音节尾对），可取题
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('全拼易混对四对', await page.locator('#modes button[data-mode^="confus:"]').count().then(n => n === 4));
check('全拼易混标签为音节尾对', await page.locator('#modes button[data-mode="confus:0"]').innerText().then(t => t === 'ian/iang'));
await page.click('#modes button[data-mode="confus:0"]');
await page.waitForTimeout(200);
check('全拼易混模式可出题', await page.locator('#word').innerText().then(t => t.trim().length > 0));
// 切回小鹤：课程进度保留（per-scheme），挑战卡副标按范式文案
await switchScheme(page, 'flypy', 200);
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('切回小鹤进度仍在阶 2', await page.locator('#stages li.on span').first().innerText().then(t => t.includes('单字练习')));
check('七日挑战卡副标为范式文案', await page.locator('#stages li.challenge').innerText().then(t => t.includes('七天入门双拼')));

// 16. v3 #4：注音方案 —— pack 状态流 / 41 键大千键盘 / 声调键 / 符号提示 / 五阶课程
await switchScheme(page, 'zhuyin', 900); // 激活状态流：正在准备资料包 → 就绪
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('注音键盘 42 键元（41 键位 + 空格调键）', await page.locator('#kb .key').count().then(n => n === 42));
check('注音数字行在键盘', await page.locator('#kb .key[data-key="1"]').count().then(n => n === 1));
check('注音空格声调宽键在键盘', await page.locator('#kb .key[data-key=" "]').count().then(n => n === 1));
check('注音码文本显注音符号+调号', await page.locator('#hint b').innerText().then(t => /[\u3105-\u3129]/.test(t) && /[ˉˊˇˋ˙]/.test(t)));
const zyCode = await page.evaluate(async () => {
  const m = await import('/js/schemes.js');
  const s = m.getScheme('zhuyin');
  return s.codeOf({ word: document.querySelector('#word').textContent });
});
check('注音符号码含声调键收尾', typeof zyCode === 'string' && /[ 6347]$/.test(zyCode));
for (const ch of zyCode) await page.locator('#inbox').press(ch === ' ' ? 'Space' : ch);
await page.waitForTimeout(300);
check('注音带调输入整词推进', await page.locator('#sDone').innerText().then(t => t.startsWith('1/')));
const zyWant = await page.evaluate(async () => {
  const m = await import('/js/schemes.js');
  const s = m.getScheme('zhuyin');
  const w = document.querySelector('#word').textContent;
  const c = s.codeOf({ word: w });
  return s.planOf(c, { word: w }).keys[0].key;
});
const zyWrong = zyWant === 'q' ? 'w' : 'q';
await page.locator('#inbox').press(zyWrong);
check('注音错键反馈显注音符号', await page.locator('#fb').innerText().then(t =>
  t.includes('应是') && /[\u3105-\u3129]|空格/.test(t)));
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('注音五阶+挑战卡渲染', await page.locator('#stages li').count().then(n => n === 6));
check('注音阶 0 键盘图 42 键元', await page.locator('#kbmap .key').count().then(n => n === 42));
await page.locator('#stages li:not(.challenge)').nth(1).click();
await page.waitForTimeout(150);
check('注音阶 1 符号操练按钮 42 个（21+3+13+5）', await page.locator('#finalkeys button').count().then(n => n === 42));
check('注音阶 1 声调键收尾分组在', await page.locator('#finalkeys').innerText().then(t => t.includes('声调键')));
check('注音阶 1 分组标题齐（声符/介符/韵符/声调键）', await page.locator('#finalkeys .drillgroup').count().then(n => n === 4));
// 16b. v4 #10：粤拼方案 —— 带调包懒加载 / 26 键 / 六调键收尾 / 阳调双敲单一连击单元（验收 4 交互面）
await switchScheme(page, 'jyutping', 900); // 激活状态流：正在准备粤拼带调数据 → 就绪
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('粤拼键盘 26 键元（标准 26 键零布局）', await page.locator('#kb .key').count().then(n => n === 26));
check('粤拼码文本显带调粤拼串', await page.locator('#hint b').innerText().then(t => /^[a-z]+[1-6]( [a-z]+[1-6])*$/.test(t)));
const jpCode = await page.evaluate(async () => {
  const m = await import('/js/schemes.js');
  return m.getScheme('jyutping').codeOf({ word: document.querySelector('#word').textContent });
});
check('粤拼码以六调键收尾（v/x/q）', typeof jpCode === 'string' && /[vqx]$/.test(jpCode));
for (const ch of jpCode) await page.locator('#inbox').press(ch);
await page.waitForTimeout(300);
check('粤拼带调输入整词推进', await page.locator('#sDone').innerText().then(t => t.startsWith('1/')));
const jpWrong = jpCode[0] === 'w' ? 'e' : 'w';
await page.locator('#inbox').press(jpWrong);
check('粤拼错键反馈含应是', await page.locator('#fb').innerText().then(t => t.includes('应是')));
check('粤拼阳调双敲 = 单一连击单元（plan span=2 + note）', await page.evaluate(async () => {
  const m = await import('/js/schemes.js');
  const s = m.getScheme('jyutping');
  const c = s.codeOf({ word: '是' });
  const plan = s.planOf(c, { word: '是' });
  const last = plan.keys.at(-1);
  return c === 'siqq' && plan.keys.length === 3 && last.span === 2 && last.note.includes('同键连按两下');
}));
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('粤拼五阶+挑战卡渲染', await page.locator('#stages li').count().then(n => n === 6));
check('粤拼阶 0 键盘图 26 键元', await page.locator('#kbmap .key').count().then(n => n === 26));
check('粤拼阶 0 文案讲透六调辨义', await page.locator('#view-course').innerText().then(t =>
  t.includes('六调辨义') || t.includes('声调辨义')));
await page.locator('#stages li:not(.challenge)').nth(1).click();
await page.waitForTimeout(150);
check('粤拼阶 1 操练按钮 31 个（声母 17+韵母 11+调键 3）', await page.locator('#finalkeys button').count().then(n => n === 31));
check('粤拼阶 1 调键组单列双敲提示', await page.locator('#finalkeys').innerText().then(t => t.includes('阳调同键双敲')));
// 阳调双敲呈现一致性探针：调键操练轮的引导话术带调名注记、键盘高亮落在当前单元
await page.evaluate(() => { // 探针前置：固定全提示+高亮（防前序会话自适应降档干扰）
  const s = JSON.parse(localStorage.getItem('flypy.v1.settings'));
  s.data.hintLevel = 'full'; s.data.hlKeys = true;
  localStorage.setItem('flypy.v1.settings', JSON.stringify(s));
});
await page.locator('#finalkeys button').filter({ hasText: /^Q/ }).last().click();
await page.waitForTimeout(400);
check('粤拼调键操练引导含调名注记（阴/阳）', await page.locator('#guide').innerText().then(t => /阴|阳/.test(t)));
check('粤拼调键操练键盘高亮当前单元', await page.locator('#kb .key.smhi').count().then(n => n === 1));
await switchScheme(page, 'flypy', 300);
// 16c. v4 #11：五笔画方案 —— 截包懒加载 / 26 键仅五键点亮 / 逐笔笔顺教学（验收 9–12、29）
await switchScheme(page, 'stroke', 900); // 激活状态流：正在准备五笔画笔顺码表（~132KB）→ 就绪
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('五笔画键盘 26 键元（标准 26 键复用）', await page.locator('#kb .key').count().then(n => n === 26));
check('五笔画仅 h/s/p/n/z 点亮（角标康熙笔画字形）', await page.locator('#kb .key[data-key="h"] .ym').innerText().then(t => t === '⼀')
  && await page.locator('#kb .key[data-key="s"] .ym').innerText().then(t => t === '⼁')
  && await page.locator('#kb .key[data-key="p"] .ym').innerText().then(t => t === '⼃')
  && await page.locator('#kb .key[data-key="n"] .ym').innerText().then(t => t === '⼂')
  && await page.locator('#kb .key[data-key="z"] .ym').innerText().then(t => t === '⼄'));
check('五笔画余键暗面（无角标）', await page.locator('#kb .key[data-key="a"] .ym').innerText().then(t => t === '')
  && await page.locator('#kb .key[data-key="q"] .ym').innerText().then(t => t === ''));
check('五笔画码文本 = 笔顺序列（hspnz 域）', await page.locator('#hint b').innerText().then(t => /^[hsnpz]{1,29}$/.test(t)));
const skCode = await page.evaluate(async () => {
  const m = await import('/js/schemes.js');
  return m.getScheme('stroke').codeOf({ word: document.querySelector('#word').textContent });
});
check('五笔画出码与码文本一致', await page.locator('#hint b').innerText().then(t => t === skCode));
for (const ch of skCode) await page.locator('#inbox').press(ch);
await page.waitForTimeout(300);
check('五笔画逐笔输入整词推进', await page.locator('#sDone').innerText().then(t => t.startsWith('1/')));
const skWant = await page.evaluate(async () => {
  const m = await import('/js/schemes.js');
  const s = m.getScheme('stroke');
  const w = document.querySelector('#word').textContent;
  const c = s.codeOf({ word: w });
  return s.planOf(c, { word: w }).keys[0].key;
});
const skWrong = 'hsnpz'.replace(skWant, '')[0];
await page.locator('#inbox').press(skWrong);
check('五笔画错键反馈显笔画名', await page.locator('#fb').innerText().then(t =>
  t.includes('应是') && /横|竖|撇|捺|折/.test(t)));
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('五笔画五阶+挑战卡渲染', await page.locator('#stages li').count().then(n => n === 6));
check('五笔画阶 0 键盘图 26 键元', await page.locator('#kbmap .key').count().then(n => n === 26));
check('五笔画阶 0 归类规则讲透（提归横/点归捺/带转折归折）', await page.locator('#view-course').innerText().then(t =>
  t.includes('提归横') && t.includes('点归捺') && t.includes('带转折')));
await page.locator('#stages li:not(.challenge)').nth(1).click();
await page.waitForTimeout(150);
check('五笔画阶 1 五键操练恰 5 按钮（全站最轻）', await page.locator('#finalkeys button').count().then(n => n === 5));
await page.locator('#stages li:not(.challenge)').nth(3).click();
await page.waitForTimeout(150);
check('五笔画阶 3 直陈「词 = 逐字连打」（无词阶）', await page.locator('#view-course').innerText().then(t => t.includes('词 = 逐字连打')));
await switchScheme(page, 'flypy', 300);
// 17. v3 #5：仓颉深教样板 + 速成 —— 字表查询 / 取题仅单字 / 字根认知五阶 / 首尾派生
await switchScheme(page, 'cangjie', 900); // 激活状态流：正在准备仓颉单字码表（~269KB）→ 就绪
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('仓颉单字出码（1–5 字母，x 不作首码）', await page.locator('#hint b').innerText().then(t => /^[a-y]{1,5}$/.test(t)));
check('仓颉引导为步骤话术', await page.locator('#guide').innerText().then(t => t.includes('第 1 步')));
check('仓颉键帽主显字母/角标主字根（D=木）', await page.locator('#kb .key[data-key="d"] .ym').innerText().then(t => t === '木'));
const cjWord = await page.locator('#word').innerText();
const cjCode = await page.evaluate(async (w) => {
  const m = await import('/js/schemes.js');
  return m.getScheme('cangjie').codeOf({ word: w });
}, cjWord);
check('仓颉码与码文本一致', cjCode === await page.locator('#hint b').innerText());
for (const ch of cjCode) await page.locator('#inbox').press(ch);
await page.waitForTimeout(250);
check('仓颉整码输入推进', await page.locator('#sDone').innerText().then(t => t.startsWith('1/')));
check('仓颉多字词不取题（§3.4）', await page.evaluate(async () => {
  const m = await import('/js/schemes.js');
  return m.getScheme('cangjie').codeOf({ word: '中国', py: 'zhong guo' });
}).then(c => c === null));
const cjWrong = cjCode[0] === 'q' ? 'w' : 'q';
await page.locator('#inbox').press(cjWrong);
check('仓颉错键反馈显字根名', await page.locator('#fb').innerText().then(t => t.includes('应是')));
// 课程：阶 0 字根认知（roots 视图）/ 阶 1 拆字操练（24 字母）
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('仓颉五阶+挑战卡渲染', await page.locator('#stages li').count().then(n => n === 6));
check('仓颉阶 0 = 字根认知', await page.locator('#stages li:not(.challenge)').first().innerText().then(t => t.includes('字根认知')));
check('仓颉阶 0 键位图 26 键', await page.locator('#kbmap .key').count().then(n => n === 26));
check('仓颉阶 0 四类分区 + X/Z 单列（5 组）', await page.locator('#rootcats .rootcat').count().then(n => n === 5));
await page.locator('#kbmap .key[data-key="d"]').click();
await page.waitForTimeout(150);
check('仓颉点键看字根详情（例字带码）', await page.locator('#rootdetail').innerText().then(t => t.includes('木') && t.includes('例字')));
await page.locator('#stages li:not(.challenge)').nth(1).click();
await page.waitForTimeout(150);
check('仓颉阶 1 操练按钮 24 字母（X 不教、Z 非取码）', await page.locator('#finalkeys button').count().then(n => n === 24));
check('仓颉阶 1 四类分组标题', await page.locator('#finalkeys .drillgroup').count().then(n => n === 4));
// 速成：独立方案身份、首尾二码、共用字表即切即用
await switchScheme(page, 'quick', 500); // cangjie5 已在内存：速成接载即时就绪
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('速成码 ≤2 键（首尾派生）', await page.locator('#hint b').innerText().then(t => /^[a-y]{1,2}$/.test(t)));
const qkPair = await page.evaluate(async () => {
  const m = await import('/js/schemes.js');
  return [m.getScheme('cangjie').codeOf({ word: '学' }), m.getScheme('quick').codeOf({ word: '学' })];
});
check('速成 = 仓颉首尾二码（学 fbnd→fd）', qkPair[0] === 'fbnd' && qkPair[1] === 'fd');
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('速成五阶+挑战卡渲染', await page.locator('#stages li').count().then(n => n === 6));
check('速成阶 1 含首尾码速认话术', await page.locator('#stages li:not(.challenge)').nth(1).innerText().then(t => t.includes('首尾码速认')));
// 切回小鹤收尾
await switchScheme(page, 'flypy', 200);

// 18. v4 #13 M3：五笔 86 全课程 —— 拆解逐步引导 / 五阶+挑战 / 课程池二字词 2+2
await switchScheme(page, 'wubi86', 1200); // 码表 + 课程包同批懒加载
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
await page.click('input[name="hint"][value="full"]');
await page.click('#modes button[data-mode="chars"]');
await page.waitForTimeout(200);
check('五笔取题为单字', await page.locator('#word').innerText().then(t => [...t].length === 1 && t !== '∅'));
const wbHintB = await page.locator('#hint b').innerText().catch(async () => {
  console.log('DBG 五笔面板状态 word=' + JSON.stringify(await page.locator('#word').innerText())
    + ' hint=' + JSON.stringify(await page.locator('#hint').innerHTML())
    + ' guide=' + JSON.stringify((await page.locator('#guide').innerText()).slice(0, 120)));
  return null;
});
check('五笔单字查表码（1–4 键）', !!wbHintB && /^[a-y]{1,4}$/.test(wbHintB));
check('五笔引导为步骤话术', await page.locator('#guide').innerText().then(t => t.includes('第 1 步')));
check('五笔课程字 full 档逐步引导（字根名）', await page.evaluate(async () => {
  const m = await import('/js/schemes.js');
  const s = m.getScheme('wubi86');
  const w = document.querySelector('#word').innerText;
  const p = s.planOf(s.codeOf({ word: w }), { word: w });
  return p.keys.every(k => k.role === 'root' || k.role === '码键');
}));
check('五笔键帽角标字根全列（G=王戋五一）', await page.locator('#kb .key[data-key="g"] .ym').innerText().then(t => t === '王 戋 五 一'));
check('五笔练习键盘 title 保全量', await page.locator('#kb .key[data-key="g"]').getAttribute('title').then(t => !!(t && t.includes('王 戋 五 一'))));
check('五笔 Z 学习键描边单列', await page.locator('#kb .key[data-key="z"].special').count().then(n => n === 1));
const wbWord = await page.locator('#word').innerText();
const wbCode = await page.evaluate(async (w) => {
  const m = await import('/js/schemes.js');
  return m.getScheme('wubi86').codeOf({ word: w });
}, wbWord);
check('五笔码与码文本一致', wbCode === wbHintB);
for (const ch of wbCode) await page.locator('#inbox').press(ch);
await page.waitForTimeout(250);
check('五笔整码输入推进', await page.locator('#sDone').innerText().then(t => t.startsWith('1/')));
check('五笔课程池二字词可出题（中国 2+2）', await page.evaluate(async () => {
  const m = await import('/js/schemes.js');
  return m.getScheme('wubi86').codeOf({ word: '中国', py: 'zhong guo' });
}).then(c => c === 'khlg'));
check('五笔下二字词模式可见', await page.locator('#modes button[data-mode="words2"]').evaluate(el => el.style.display !== 'none'));
check('五笔仍藏多字词与整句', await page.evaluate(() => ['words34', 'sentences']
  .every(m => document.querySelector(`#modes button[data-mode="${m}"]`).style.display === 'none')));
// 课程视图：五阶 + 七日挑战
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('五笔五阶+挑战卡渲染', await page.locator('#stages li').count().then(n => n === 6));
check('五笔课程页脚注明本站教学口径', await page.locator('#view-course').innerText().then(t => t.includes('拆解为本站教学口径')));
check('五笔阶 0 = 字根认知', await page.locator('#stages li:not(.challenge)').first().innerText().then(t => t.includes('字根认知')));
check('五笔阶 0 五区分组', await page.locator('#rootcats .rootcat').count().then(n => n === 5));
check('五笔阶 0 键位图 26 键', await page.locator('#kbmap .key').count().then(n => n === 26));
await page.locator('#rootcats .rootchip').first().click();
await page.waitForTimeout(150);
check('五点键看字根与例字', await page.locator('#rootdetail').innerText().then(t => t.includes('例字')));
await page.locator('#stages li:not(.challenge)').nth(1).click();
await page.waitForTimeout(150);
check('五笔阶 1 操练 25 码键（Z 不入）', await page.locator('#finalkeys button').count().then(n => n === 25));
check('五笔阶 1 五区分组标题', await page.locator('#finalkeys .drillgroup').count().then(n => n === 5));
await switchScheme(page, 'flypy', 200);

// 19. v3 #7：方案库 UI —— #/schemes 十二卡三层分组 / 设置页摘要行 / 芯片弹层 Alt+S Esc / 气泡 / 形码藏模式 / 预下载 / 动效与 reduced-motion
// 19a. 方案库页：12 卡、三层分组、旗舰大卡、五层信息、五笔灰调、速成互注、五笔画形码组首位
await page.goto(BASE + '/#/schemes', { waitUntil: 'networkidle' });
check('方案库页头文案', await page.locator('.schemelib-head').innerText().then(t => t.includes('方案库') && t.includes('音码打声、形码打形')));
check('方案库恰 12 卡', await page.locator('.scard').count().then(n => n === 12));
check('旗舰大卡独享顶层（徽章+使用中）', await page.locator('.scard.flagship').count().then(n => n === 1)
  && await page.locator('.scard.flagship').innerText().then(t => t.includes('旗舰 · 默认') && t.includes('使用中')));
check('音码组科普行', await page.locator('.schemegroup[data-group="phonetic"] h2').innerText().then(t => t.includes('音码 · 码即读音')));
check('形码组科普行', await page.locator('.schemegroup[data-group="shape"] h2').innerText().then(t => t.includes('形码 · 码即字形')));
check('音码组 7 卡 / 形码组 4 卡', JSON.stringify([
  await page.locator('.schemegroup[data-group="phonetic"] .scard').count(),
  await page.locator('.schemegroup[data-group="shape"] .scard').count()]) === JSON.stringify([7, 4]));
check('五笔画卡居形码组首位（入门叙事，#11）', await page.locator('.schemegroup[data-group="shape"] .scard').first().getAttribute('data-scheme').then(id => id === 'stroke'));
check('五笔画卡文案「五键打字 · 形码第一步」', await page.locator('.scard[data-scheme="stroke"] .scard-feat').innerText().then(t => t.includes('五键打字 · 形码第一步')));
check('速成卡紧邻仓颉卡', await page.locator('.schemegroup[data-group="shape"] .scard').evaluateAll(
  els => els.map(e => e.dataset.scheme)).then(ids => ids.indexOf('quick') - ids.indexOf('cangjie') === 1));
check('速成卡互注文案', await page.locator('.scard[data-scheme="quick"] .scard-feat').innerText().then(t => t.includes('仓颉首尾二码')));
check('卡片迷你键盘预览渲染（注音显数字行）', await page.locator('.scard[data-scheme="zhuyin"] .kbmini .key[data-key="1"]').count().then(n => n === 1));
check('卡片迷你键盘预览渲染（形码显字根角标）', await page.locator('.scard[data-scheme="cangjie"] .kbmini .key[data-key="d"] .ym').innerText().then(t => t === '木'));
check('卡片迷你键盘五笔角标全列同源', await page.locator('.scard[data-scheme="wubi86"] .kbmini .key[data-key="g"] .ym').innerText().then(t => t === '王 戋 五 一'));
check('卡片状态行 = 课程形态 + 数据状态', await page.locator('.scard[data-scheme="flypy"] .scard-state').innerText().then(t => t.includes('五阶课程') && t.includes('无需下载'))
  && await page.locator('.scard[data-scheme="quanpin"] .scard-state').innerText().then(t => t.includes('提速课程')));
check('五笔卡已去灰调降级标签', await page.locator('.scard[data-scheme="wubi86"] .formtag.gray').count().then(n => n === 0)
  && await page.locator('.scard[data-scheme="wubi86"] .scard-feat').innerText().then(t => t.includes('拆字逐步引导')));
check('五笔卡状态行 = 五阶课程', await page.locator('.scard[data-scheme="wubi86"] .scard-state').innerText().then(t => t.includes('五阶课程')));
check('切回态卡片自带进度摘要', await page.locator('.scard[data-scheme="flypy"]').innerText().then(t => t.includes('课程第')));
// 19b. 设置页：下拉废除 → 摘要行跳方案库
await page.goto(BASE + '/#/settings', { waitUntil: 'networkidle' });
check('设置页硬编码下拉已删', await page.locator('#setScheme').count().then(n => n === 0));
check('设置页当前方案摘要行', await page.locator('#setSchemeNow').innerText().then(t => t.includes('小鹤双拼') && t.includes('音码')));
check('摘要行更换入口跳方案库', await page.locator('#setSchemeGo').getAttribute('href').then(h => h === '#/schemes'));
// 19c. 芯片 + 弹层 + Alt+S + Esc 焦点归还
const chipH = await page.locator('#schemeChip').boundingBox().then(b => b.height);
check('芯片触控目标 ≥44px', chipH >= 44);
await page.click('#schemeChip');
await page.waitForTimeout(150);
check('弹层两组 12 项 + 进方案库入口', await page.locator('#schemePop .popgroup').count().then(n => n === 2)
  && await page.locator('#schemePop button[data-scheme]').count().then(n => n === 12)
  && await page.locator('#schemePop .poplib').count().then(n => n === 1));
check('当前项朱砂勾', await page.locator('#schemePop button[data-scheme="flypy"]').evaluate(el => el.classList.contains('cur') && el.querySelector('.tick').textContent === '✓'));
await page.keyboard.press('Escape');
await page.waitForTimeout(120);
check('Esc 关闭弹层且焦点归还芯片', await page.locator('#schemePop').evaluate(el => el.classList.contains('hidden'))
  && await page.evaluate(() => document.activeElement && document.activeElement.id === 'schemeChip'));
await page.keyboard.press('Alt+s');
await page.waitForTimeout(120);
check('Alt+S 开弹层', await page.locator('#schemePop').evaluate(el => !el.classList.contains('hidden')));
await page.click('#schemePop .poplib');
await page.waitForTimeout(150);
check('弹层底部进入方案库', await page.evaluate(() => location.hash), '#/schemes');
// 19d. 形码变化面：二字词/多字词/整句隐藏，切回音码复现
await switchScheme(page, 'cangjie', 400); // 前序已缓存：即切即用
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('形码隐藏二字词/多字词/整句', await page.evaluate(() => ['words2', 'words34', 'sentences']
  .every(m => document.querySelector(`#modes button[data-mode="${m}"]`).style.display === 'none')));
check('形码保留单字/混合/冲刺/词库/错词', await page.evaluate(() => ['chars', 'mixed', 'sprint', 'personal', 'mistakes']
  .every(m => document.querySelector(`#modes button[data-mode="${m}"]`).style.display !== 'none')));
check('形码科普块数据驱动（仅单字取题）', await page.locator('#helpBlock').innerText().then(t => t.includes('形码'))
  && await page.locator('#helpBlock summary').innerText().then(t => t.includes('仓颉')));
await switchScheme(page, 'flypy', 300);
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('切回音码模式复现', await page.evaluate(() => ['words2', 'words34', 'sentences']
  .every(m => document.querySelector(`#modes button[data-mode="${m}"]`).style.display !== 'none')));
check('音码科普块随方案恢复', await page.locator('#helpBlock summary').innerText().then(t => t.includes('小鹤双拼')));
// 19e. 动效：视图入场 .enter + 键盘逐行级联（纯 CSS 运行态断言）
await page.goto(BASE + '/#/course', { waitUntil: 'networkidle' });
check('视图入场带 enter 类', await page.locator('#view-course').evaluate(el => el.classList.contains('enter')));
const kbAnim = await page.evaluate(() => {
  const rows = document.querySelectorAll('#kb .kbrow');
  return [...rows].map(r => getComputedStyle(r).animationName);
});
check('键盘行级联动画生效（行距 30ms 内收）', kbAnim.length >= 3 && kbAnim.every(n => n === 'kbRowRise'));
const kbDelays = await page.evaluate(() => [...document.querySelectorAll('#kb .kbrow')]
  .map(r => parseFloat(getComputedStyle(r).animationDelay)));
check('级联行距 30ms、总时长 ≤250ms', kbDelays[1] - kbDelays[0] === 0.03 && kbDelays.at(-1) + 0.16 <= 0.26);
// 19f. reduced-motion 全站兜底：动画与长 transition 一律停置
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
const rm = await page.evaluate(() => {
  const row = document.querySelector('#kb .kbrow');
  const view = document.querySelector('#view-practice');
  return {
    rowAnim: getComputedStyle(row).animationDuration,
    viewAnim: getComputedStyle(view).animationDuration,
  };
});
check('reduced-motion 停置级联/升入动画', parseFloat(rm.rowAnim) < 0.001 && parseFloat(rm.viewAnim) < 0.001);
await switchScheme(page, 'mspy', 300);
check('reduced-motion 下切换仍可用', await page.locator('#kb .key[data-key=";"]').count().then(n => n === 1));
await page.emulateMedia({ reducedMotion: null });
await switchScheme(page, 'flypy', 200);

// 20. v3 #7：干净上下文 —— 首访气泡一次性 + 未下载态预下载按钮（SW message 通道）
const ctx3 = await browser.newContext();
const p3 = await ctx3.newPage();
await p3.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('首访静默入小鹤（默认不拦截）', await p3.locator('#schemeChip .chipname').innerText().then(t => t === '小鹤双拼'));
check('芯片一次性气泡首现', await p3.locator('#chipBubble').evaluate(el => el.classList.contains('show')));
check('气泡 flag 落设置', await p3.evaluate(() => JSON.parse(localStorage.getItem('flypy.v1.settings'))?.data?.chipTipSeen === true));
await p3.click('#word');
await p3.waitForTimeout(200);
check('任意点击气泡即消', await p3.locator('#chipBubble').evaluate(el => !el.classList.contains('show')));
await p3.reload({ waitUntil: 'networkidle' });
check('气泡不再现（一次性）', await p3.locator('#chipBubble').evaluate(el => !el.classList.contains('show')));
// 干净上下文无缓存：三带包方案皆显「未下载」，预下载走 SW message 通道
await p3.evaluate(() => navigator.serviceWorker.ready);
await p3.reload({ waitUntil: 'networkidle' }); // 确保 SW 接管（message 通道需 controller）
await p3.goto(BASE + '/#/schemes', { waitUntil: 'networkidle' });
check('未下载态显包大小', await p3.locator('.scard[data-scheme="cangjie"] .datastate').innerText().then(t => t.includes('未下载 ~269KB'))
  && await p3.locator('.scard[data-scheme="wubi86"] .datastate').innerText().then(t => t.includes('未下载 ~82KB')));
check('未下载者带预下载按钮', await p3.locator('.scard[data-scheme="zhuyin"] .scard-actions button').count().then(n => n === 2));
await p3.locator('.scard[data-scheme="zhuyin"] .scard-actions button').nth(1).click();
await p3.waitForTimeout(900);
check('预下载完成转已缓存（SW message 通道）', await p3.locator('.scard[data-scheme="zhuyin"] .datastate').innerText().then(t => t === '已缓存 ✓'));
check('预下载落 SW 缓存', await p3.evaluate(async () => {
  for (const k of await caches.keys()) if (await (await caches.open(k)).match('/data/packs/zhuyin-tones.v1.json')) return true;
  return false;
}));
await p3.close();
await ctx3.close();

// 21. v4 #12：移动端键盘适配（T3-D1–D7）—— 375px 视口弹性键宽不溢出 / 键高 ≥44 /
//     调号角标 6·ˊ 一类练习与预览同享（单一键位数据源）
const ctxM = await browser.newContext({ viewport: { width: 375, height: 667 } });
const pm = await ctxM.newPage();
const kbFit = () => pm.evaluate(() => {
  const vw = window.innerWidth;
  const rows = [...document.querySelectorAll('#kb .kbrow')];
  const keys = [...document.querySelectorAll('#kb .key')];
  return {
    noScroll: document.documentElement.scrollWidth <= vw,
    rowsIn: rows.length > 0 && rows.every(r => {
      const b = r.getBoundingClientRect();
      return b.right <= vw + 0.5 && b.left >= -0.5;
    }),
    minH: Math.min(...keys.map(k => k.getBoundingClientRect().height)),
  };
});
await pm.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
let fit = await kbFit();
check('375px 26 键形态行不溢出视口（禁分行/横滚）', fit.noScroll && fit.rowsIn);
check('375px 键高 ≥44（触控基准按高执行）', fit.minH >= 44);
// 注音大千 41 键形态：数字行 11 键窄屏同样不溢出
await switchScheme(pm, 'zhuyin', 1200);
await pm.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
check('注音 42 键元在窄屏渲染', await pm.locator('#kb .key').count().then(n => n === 42));
fit = await kbFit();
check('375px 注音 41 键形态行不溢出视口', fit.noScroll && fit.rowsIn);
check('375px 注音键高 ≥44', fit.minH >= 44);
check('注音调键 6/3/4/7 角标补调号（练习键盘）',
  await pm.locator('#kb .key[data-key="6"] .ym').innerText().then(t => t === '6·ˊ')
  && await pm.locator('#kb .key[data-key="3"] .ym').innerText().then(t => t === '3·ˇ')
  && await pm.locator('#kb .key[data-key="4"] .ym').innerText().then(t => t === '4·ˋ')
  && await pm.locator('#kb .key[data-key="7"] .ym').innerText().then(t => t === '7·˙'));
check('注音 - 键保持 ㄦ、空格 ˉ 宽键不动',
  await pm.locator('#kb .key[data-key="-"] .sm').innerText().then(t => t === 'ㄦ')
  && await pm.locator('#kb .key[data-key=" "] .sm').innerText().then(t => t === 'ˉ'));
// D6：方案库迷你预览与练习键盘共用 scheme.layout，调号角标同享
await pm.goto(BASE + '/#/schemes', { waitUntil: 'networkidle' });
check('预览迷你键盘同享调号角标（单一键位数据源）',
  await pm.locator('.scard[data-scheme="zhuyin"] .kbmini .key[data-key="6"] .ym').innerText().then(t => t === '6·ˊ'));
await pm.close();
await ctxM.close();

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
