<div align="center">

# 鹤练 · FlypyTrainer

> 你的词库，只在你的浏览器里。

![version](https://img.shields.io/badge/版本-v0.0.5-101014?style=flat-square&labelColor=17171c&color=7f9dd9)
![static](https://img.shields.io/badge/纯静态-零后端-101014?style=flat-square&labelColor=17171c&color=d96c4f)
![scheme](https://img.shields.io/badge/小鹤双拼-flypy-101014?style=flat-square&labelColor=17171c&color=7fa98c)
![privacy](https://img.shields.io/badge/数据-仅本地-101014?style=flat-square&labelColor=17171c&color=8b8b93)

<p align="center">
  <a href="https://flypy-trainer.vercel.app">线上体验</a> ·
  <a href="#功能">功能</a> ·
  <a href="#开发">开发</a> ·
  <a href="#反馈">反馈</a>
</p>

<p align="center">
小鹤双拼在线打字练习：导入你的 Rime 词库个性化出题，<br />
或从五阶课程零基础开始——每个音节，只按两键。
</p>

</div>

---

<a id="功能"></a>

## 功能

- **本地词库导入** — Rime 同步快照 `*.userdb.txt` / `*.dict.yaml` / `custom_phrase.txt` / 纯文本词表，按你的真实词频加权出题
- **五阶课程** — 键位认知 → 韵母操练 → 单字 → 词组 → 易错强化，配逐步按键顺序引导
- **练习仪表** — 实时速度/准确率、27→26 键错键热力图、错词本闭环重练
- **击键体感** — 打砖块式命中震荡与粒子反馈，设置页可开关
- **多方案注册表** — 小鹤/微软/搜狗/智能ABC/自然码/全拼六方案，统一 {codeOf, planOf, layout} 接口，新增音码方案只加一张映射表

## 隐私

词库文件只在浏览器内解析，**不上传任何服务器**。无账号、无遥测、无第三方运行时依赖。

<a id="开发"></a>

## 开发

```bash
npx -y serve -l 4173 .   # 起本地服务
node test/run.mjs        # 引擎单元测试
npx tsc -p jsconfig.json # 类型检查
node test/e2e.mjs        # e2e 走查（系统 Edge）
node tools/build-packs.mjs # 重建 data/packs/（构建期联网拉上游字典，缓存 tools/.cache/，幂等）
```

<a id="反馈"></a>

## 反馈

问题与建议请到 [Issues](https://github.com/Bandersnatch0x/flypy-trainer/issues) 按模板提交；
也可以直接在[线上站](https://flypy-trainer.vercel.app)页脚点「提 issue」。
