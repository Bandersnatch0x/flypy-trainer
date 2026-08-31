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
