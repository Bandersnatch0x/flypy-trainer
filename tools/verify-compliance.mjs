/**
 * 合规披露回归测试 —— 校验小程序内的许可披露与隐私入口未被改坏。
 *
 * 覆盖两类硬性义务：
 *   1. LGPL-3.0 / CC-BY-4.0 / 政府资料开放授权的署名与出处披露（数据来源与许可页）
 *   2. 隐私指引入口走官方 wx.openPrivacyContract，指向后台备案版本
 *
 * 前置：开发者工具已开 CLI/HTTP 调用，且已执行
 *   cli auto --project <仓库根> --auto-port 9420
 *
 * 用法：node tools/verify-compliance.mjs
 */
import automator from 'miniprogram-automator';

const AUTOMATION_PORT = 9420;
const CONNECT_TIMEOUT_MS = 30_000;
const PAGE_SETTLE_MS = 1_200;
const NAV_SETTLE_MS = 2_500;

/** 出处条目数与许可标签分布，改动词库时同步更新。 */
const EXPECTED_SOURCES = 7;
const EXPECTED_LABELS = { 'LGPL-3.0': 4, 'CC-BY-4.0': 1, 自写: 2 };

/** CC-BY-4.0 与政府资料开放授权要求逐一署名的主体。 */
const REQUIRED_ATTRIBUTIONS = ['CanCLID', 'CNS11643', '數位發展部'];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(ok, label) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

/** 「我的」页：入口完整性与隐私接口可用性。 */
async function checkMinePage(miniProgram, mine) {
  const rows = await mine.$$('.row');
  const texts = [];
  for (const row of rows) texts.push((await row.text()).replace(/\s+/g, ' ').trim());

  check(texts.some((t) => t.includes('数据来源与许可')), '存在「数据来源与许可」入口');
  check(texts.some((t) => t.includes('隐私保护指引')), '存在「隐私保护指引」入口');

  const data = await mine.data();
  check(data.hasPrivacyContract === true, `openPrivacyContract 可用（${data.hasPrivacyContract}）`);

  // 后台备案的协议名取得到，说明 openPrivacyContract 有内容可开
  const contractName = await miniProgram.evaluate(() => new Promise((resolve) => {
    wx.getPrivacySetting({
      success: (r) => resolve(r.privacyContractName || ''),
      fail: () => resolve(''),
    });
  }));
  check(!!contractName, `后台已备案隐私协议：${contractName || '无'}`);

  // 旧文案曾把署名义务指向小程序无法到达的网页版，不得回归
  let about = '';
  for (const el of await mine.$$('.aline')) about += await el.text();
  check(!about.includes('网页版出处页'), '未指向小程序无法到达的网页版出处页');

  let entry = null;
  for (const row of rows) {
    if ((await row.text()).includes('数据来源与许可')) { entry = row; break; }
  }
  return entry;
}

/** 数据来源与许可页：条目数、许可标签、署名主体、可复制链接。 */
async function checkLicensesPage(page) {
  const cards = await page.$$('.src');
  check(cards.length === EXPECTED_SOURCES, `出处条目 ${cards.length}/${EXPECTED_SOURCES}`);

  const labels = [];
  for (const el of await page.$$('.lic')) labels.push((await el.text()).trim());
  for (const [name, want] of Object.entries(EXPECTED_LABELS)) {
    const got = labels.filter((t) => t === name).length;
    check(got === want, `${name} 标签 ${got}/${want}`);
  }

  // 逐条读 .sbody，避免一次性遍历整页大文本导致 automator 超时
  let body = '';
  for (const el of await page.$$('.sbody')) body += await el.text();
  for (const name of REQUIRED_ATTRIBUTIONS) {
    check(body.includes(name), `含 ${name} 署名`);
  }

  const urls = await page.$$('.url');
  check(urls.length >= EXPECTED_SOURCES - 1, `可复制链接 ${urls.length} 处`);
  if (urls.length) {
    await urls[0].tap();
    await delay(500);
    check(true, '链接复制点按未抛错');
  }
}

async function main() {
  const miniProgram = await automator.connect({
    wsEndpoint: `ws://localhost:${AUTOMATION_PORT}`,
    connectionTimeout: CONNECT_TIMEOUT_MS,
  });

  // reLaunch 清栈：连续导航后 currentPage() 会返回陈旧页面对象
  await miniProgram.reLaunch('/pages/mine/mine');
  await delay(PAGE_SETTLE_MS);

  const mine = await miniProgram.currentPage();
  const entry = await checkMinePage(miniProgram, mine);

  if (entry) {
    await entry.tap();
    await delay(NAV_SETTLE_MS);
    const page = await miniProgram.currentPage();
    check(page.path === 'pages/licenses/licenses', `点按跳转到许可页（${page.path}）`);
    if (page.path === 'pages/licenses/licenses') await checkLicensesPage(page);
  } else {
    check(false, '许可入口缺失，跳过许可页校验');
  }

  await miniProgram.disconnect();

  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\n${failed}/${results.length} 项未通过` : `\n全部 ${results.length} 项通过`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(`合规校验启动失败：${error.message}`);
  console.error('请确认已执行 cli auto --project <仓库根> --auto-port 9420');
  process.exitCode = 1;
});
