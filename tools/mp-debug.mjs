/**
 * 小程序调试驱动 —— 连接微信开发者工具自动化端口，遍历页面并收集运行时问题。
 *
 * 前置：开发者工具中「设置 → 安全设置 → CLI/HTTP 调用」已开启，且已执行
 *   cli auto --project <miniprogram 目录> --auto-port 9420
 *
 * 用法：
 *   node tools/mp-debug.mjs                 # 遍历全部页面
 *   node tools/mp-debug.mjs pages/course/course
 */
import automator from 'miniprogram-automator';

const AUTOMATION_PORT = 9420;
const PAGE_SETTLE_MS = 600;
const CONNECT_TIMEOUT_MS = 30_000;

/** app.json 中登记的页面，按巡检顺序排列。 */
const ALL_PAGES = [
  'pages/home/home',
  'pages/course/course',
  'pages/practice/practice',
  'pages/stats/stats',
  'pages/mine/mine',
  'pages/settings/settings',
  'pages/schemes/schemes',
  'pages/import/import',
  'pages/mistakes/mistakes',
  'pages/licenses/licenses',
];

/** tabBar 页面必须用 switchTab，navigateTo 对其无效。 */
const TAB_PAGES = new Set([
  'pages/home/home',
  'pages/course/course',
  'pages/stats/stats',
  'pages/mine/mine',
]);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 采集一个页面的渲染结果：根节点是否存在、可见文本量、页面 data 概要。
 * @returns {Promise<{route: string, ok: boolean, detail: string}>}
 */
async function inspectPage(miniProgram, route) {
  try {
    // navigateTo 会累积页面栈（上限 10 层），巡检到后段会触顶并表现为
    // automator 响应超时；巡检完非 tabBar 页后立即 navigateBack 退栈。
    // 不用 reLaunch：它在本版开发者工具下会抛 getPageMetaByWebviewId 为 null。
    const isTab = TAB_PAGES.has(route);
    const page = isTab
      ? await miniProgram.switchTab(`/${route}`)
      : await miniProgram.navigateTo(`/${route}`);

    await delay(PAGE_SETTLE_MS);

    const root = await page.$('.page');
    if (!root) {
      return { route, ok: false, detail: '未找到 .page 根节点，页面可能未渲染' };
    }

    const text = ((await root.text()) || '').replace(/\s+/g, ' ').trim();
    const data = await page.data();
    const keys = Object.keys(data ?? {});

    if (!isTab) await miniProgram.navigateBack();

    if (!text) {
      return { route, ok: false, detail: `根节点无可见文本 · data keys: ${keys.length}` };
    }

    return {
      route,
      ok: true,
      detail: `文本 ${text.length} 字 · data keys ${keys.length} · ${text.slice(0, 60)}`,
    };
  } catch (error) {
    return { route, ok: false, detail: `异常：${error.message}` };
  }
}

async function main() {
  const requested = process.argv.slice(2);
  const routes = requested.length ? requested : ALL_PAGES;

  const miniProgram = await automator.connect({
    wsEndpoint: `ws://localhost:${AUTOMATION_PORT}`,
    connectionTimeout: CONNECT_TIMEOUT_MS,
  });

  const consoleErrors = [];
  miniProgram.on('console', (msg) => {
    if (msg.type === 'error' || msg.type === 'warn') {
      consoleErrors.push(`[${msg.type}] ${msg.args?.join(' ') ?? ''}`);
    }
  });
  miniProgram.on('exception', (err) => {
    consoleErrors.push(`[exception] ${err.message}\n${err.stack ?? ''}`);
  });

  const results = [];
  for (const route of routes) {
    results.push(await inspectPage(miniProgram, route));
  }

  console.log('\n===== 页面巡检 =====');
  for (const { route, ok, detail } of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${route}\n      ${detail}`);
  }

  if (consoleErrors.length) {
    console.log('\n===== 运行时 error/warn =====');
    for (const line of consoleErrors) console.log(`  ${line}`);
  } else {
    console.log('\n运行时无 error/warn。');
  }

  await miniProgram.disconnect();

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`\n${failed.length}/${results.length} 个页面未通过。`);
    process.exitCode = 1;
  } else {
    console.log(`\n全部 ${results.length} 个页面通过。`);
  }
}

main().catch((error) => {
  console.error(`调试驱动启动失败：${error.message}`);
  console.error('请确认已执行 cli auto --project <miniprogram> --auto-port 9420');
  process.exitCode = 1;
});
