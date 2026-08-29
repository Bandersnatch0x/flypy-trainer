// e2e：核心路径走查（Edge headless）
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = 'http://localhost:4173';
let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('ok  ' + name); }
  else { fail++; console.error('FAIL ' + name); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => { fail++; console.error('PAGEERROR ' + e.message); });

await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });

// 1. 练习页骨架
check('标题含鹤练', await page.title().then(t => t.includes('鹤练')));
check('目标字渲染', await page.locator('#word').innerText().then(t => t.trim().length > 0));
check('键盘 26 键', await page.locator('#kb .key').count().then(n => n === 26));
check('引导含①', await page.locator('#guide').innerHTML().then(h => h.includes('①')));

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
check('五阶课程渲染', await page.locator('#stages li').count().then(n => n === 5));
check('键位全景图渲染', await page.locator('#kbmap .key').count().then(n => n === 26));

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
check('统计三卡渲染', await page.locator('#totals div').count().then(n => n === 3));
check('热力键盘渲染', await page.locator('#kbheat .key').count().then(n => n === 26));

// 10. 隐私：无任何非本地网络请求（字体除外）
const reqs = [];
page.on('request', (r) => reqs.push(r.url()));
await page.goto(BASE + '/#/practice', { waitUntil: 'networkidle' });
const foreign = reqs.filter(u => !u.startsWith(BASE) && !u.includes('fonts.g'));
check('无外部数据请求', foreign.length === 0);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
