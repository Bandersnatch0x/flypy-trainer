# CONTEXT — flypy-trainer（鹤练）

## Ubiquitous Language

| 术语 | 定义 |
|---|---|
| 声母 | 音节开头的辅音部分（拼 = **p** + in）。小鹤中 zh→V、ch→I、sh→U |
| 韵母 | 声母之后的部分（拼 = p + **in**） |
| 小鹤码 / flypy code | 一个小写双拼编码，每音节恰两键；零声母音节用双字母（爱=ad）或首字母+韵母键 |
| 方案 (Scheme) | 一种可切换的输入法编码规则（小鹤/微软/搜狗/智能ABC/自然码/全拼），含接口 {id, name, paradigm, codeOf, planOf, layout, activate}；注册于方案注册表 |
| 范式 (Paradigm) | 码的派生方式：py 派生（码是拼音的纯函数：双拼/全拼）vs 字表查询（码是 word 的查表函数：形码，后续接入） |
| 音节切分 | 把全拼串拆成音节序列（zhongguo → zhong+guo），贪心最长匹配 + 失败回溯 |
| 词目 (Entry) | 规范形 `{ word, py(全拼), weight }` + 可选 `{ srcCode, srcScheme }`；code 绝不持久化，出题时由当前方案 codeOf 派生 |
| 词库导入 (Import) | 解析本地文件为词目集合并存入浏览器，绝不上传 |
| 内置池 (Built-in Pool) | 随站点内置的高频字词数据（离线可用，从零练习的基础） |
| 练习池 (Practice Pool) | 一次会话抽题来源 = 内置池 ∪ 已导入词库（按权重加权随机） |
| 练习会话 (Session) | 一轮练习，产出时长/准确率/速度/错键统计 |
| 课程 (Curriculum) | 五阶：键位认知 → 韵母操练 → 单字 → 词组 → 易错强化 |
| 提示层级 (Hint Level) | 全提示（①②顺序+键盘高亮+拼音）/ 仅按键 / 无提示，用户手选 |
| 错词本 (Mistake Book) | 按词聚合的失败记录，上限 200 条，供易错强化阶段取题 |
| 错键热力图 (Key Heatmap) | 26 键的错误率着色（错误数/总按数） |
| 同步快照 | Rime 导出的 `*.userdb.txt`，行格式 `code word \x01 c=N d=N t=N`，code 为全拼 |
