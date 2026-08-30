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
