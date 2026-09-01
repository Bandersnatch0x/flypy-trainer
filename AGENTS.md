# flypy-trainer — Agent instructions

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`gh` CLI). Specs, wayfinder maps, and other work artifacts live under local `docs/` paths (gitignored — machine-local by design). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles map onto this repo's existing labels (`question`, `help wanted`, `wontfix` reused). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Dev workflow

Every task enters the pipeline at a stage picked from `docs/agents/dev-workflow.md`; stage 7 acceptance is mandatory per delivery.

### Release

Ship a version / push to remote: four-piece version bump, gates, name-boundary scan. See `docs/agents/release.md`.

## Compliance invariants

### License disclosure is duplicated — keep both copies in sync

Bundled dictionary data carries LGPL-3.0, CC-BY-4.0 and Taiwan Open Government Data
obligations (retain notices, state changes, attribute named parties). The disclosure text
exists as **two independent copies** that no build step reconciles:

| Surface | File |
| --- | --- |
| Web | `licenses.html` |
| Mini program | `miniprogram/pages/licenses/licenses.js` (`SOURCES` / `THANKS`) |

Any change to a pack's upstream, license, attribution or modification notes — and any
added or removed pack — **must land in both files in the same commit**. A one-sided edit
is a compliance defect, not a cosmetic drift: whichever surface is stale ships an
inaccurate notice.

Named parties that must stay attributed verbatim: **CanCLID** (CC-BY-4.0),
**CNS11643** and **數位發展部** (Open Government Data licence).

### Privacy policy is backend-declared, never hand-written

The privacy policy lives in 微信公众平台 (`《鹤练小程序隐私保护指引》`) and is opened via
`wx.openPrivacyContract()`. Do not add an in-app privacy page or copy the text into the
repo — a local copy drifts from the filed version and review treats the mismatch as a
violation. Consent is triggered at point of use (`wx.requirePrivacyAuthorize` before
album writes) with `__usePrivacyCheck__: true` in `app.json`; no blocking welcome or
consent gate.

### Gate

`node tools/verify-compliance.mjs` asserts entry points, pack counts, licence-badge
distribution and the named attributions. Requires an automation session:
`cli auto --project <repo root> --auto-port 9420`. Run it before shipping any change to
`miniprogram/pages/licenses/`, `miniprogram/pages/mine/` or `miniprogram/data/packs/`.

### `.wxss` / `.wxml` 改动：Node 测试不构成门禁

`test/mp-run.mjs` 只跑纯 JS 回归——它 **不编译** `.wxss` / `.wxml`。样式与模板的语法错误
（未闭合块、标签错配）在 Node 侧全绿，却让小程序编译直接失败。

改动这两类文件后，唯一有效的验证是走微信开发者工具真实编译：

```
cli.bat upload --project <repo root> -v <ver> -d <desc>   # 或 cli.bat preview
```

CLI 在 `D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`。在此之前不得宣称门禁通过。

事故实录：`66e0f61` 补注释时把 `@keyframes kbpress-a {` 误插到 `.key.heat2` 前，
`keyboard.wxss` 块未闭合。`mp-run.mjs` 94 passed，据此判定"门禁绿"并合入 main，
缺陷直到 `cli upload` 报 `Unclosed block` 才暴露（修复 `bd52060`）。
