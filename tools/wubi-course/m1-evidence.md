# 五笔 86 课程 M1/M2 验收证据

## M1 分批闸

- 首批分层样本定义：`tools/wubi-decomp.mjs` 中 K=25、C=20、H=40、D=15。
- `node tools/wubi-decomp.mjs check --all`：516 字全绿，未过 0、未覆盖 0、跨表分歧 0。
- full 档引导冒烟：`test/e2e.mjs` 覆盖课程字拆解步骤、字根详情、键盘高亮与整码推进。
- 工时证据：首批草稿提交 `4f5cf9c`（2026-08-30 18:24:14 +0800）至首批人工定稿提交 `6f773b5`（2026-08-30 19:45:22 +0800）的墙钟上界为 81 分 08 秒；按 100 字样本线性外推 516 字约 6.97 小时，低于 12 小时闸值。该值是 Git 提交时间区间上界代理，不是精确人工工时。

## M2

- 出货包：`data/packs/wubi86-course.v1.json`，并同步至小程序同名包。
- 条目：516，均为 `src: "human"`；`_meta.courseChars` 明确列出 500 个课程字。
- `tools/wubi-course/annotations.json` 是定稿标注源；草稿仅位于 gitignored `tools/.cache`，不参与出货。
- 课程包 `_meta` 记录码表权威、拆解教学口径、构建期参照、redline、`rootNames` 与分歧裁定。

## 结论

M1/M2 数据校验、full 档冒烟与工时墙钟上界代理均满足放量条件。
