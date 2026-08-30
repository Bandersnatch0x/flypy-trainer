# CONTEXT — flypy-trainer（鹤练）

## Ubiquitous Language

| 术语 | 定义 |
|---|---|
| 声母 | 音节开头的辅音部分（拼 = **p** + in）。小鹤中 zh→V、ch→I、sh→U |
| 韵母 | 声母之后的部分（拼 = p + **in**） |
| 小鹤码 / flypy code | 一个小写双拼编码，每音节恰两键；零声母音节用双字母（爱=ad）或首字母+韵母键 |
| 方案 (Scheme) | 一种可切换的输入法编码规则，共十二方案（双拼×5：小鹤/微软/搜狗/智能ABC/自然码，加全拼/注音/粤拼/仓颉/速成/五笔 86/五笔画），含接口 {id, name, paradigm, codeOf, planOf, layout, activate}；注册于方案注册表 |
| 范式 (Paradigm) | 码的派生方式：py 派生（码是拼音的纯函数：双拼/全拼）vs 字表查询（码是 word 的查表函数：形码，已接入——仓颉/速成/五笔 86/五笔画） |
| 数据包 (Data Pack) | 构建期从上游字典抽取的版本化紧凑 `{字: 码}` JSON（wubi86.v1 / wubi86-course.v1 / cangjie5.v1 / zhuyin-tones.v1 / jyutping-tones.v1 / stroke.v1）；方案首次激活经 activate() 懒加载，内存缓存+失败重试；版本化文件名 + SW cache-first 为唯一持久层（不进 localStorage/ SHELL）；`_meta` 键内嵌出处与许可；速成/全拼/自然码无包；粤拼包经构建期简繁桥以简体为键（运行时零映射）；五笔画包截 GB2312 6,763 字、笔顺底本为 CNS11643（台标，方/火/必 类与大陆规范有微差） |
| 音节切分 | 把全拼串拆成音节序列（zhongguo → zhong+guo），贪心最长匹配 + 失败回溯 |
| 词目 (Entry) | 规范形 `{ word, py(全拼), weight }` + 可选 `{ srcCode, srcScheme }`；code 绝不持久化，出题时由当前方案 codeOf 派生 |
| 词库导入 (Import) | 解析本地文件为词目集合并存入浏览器，绝不上传 |
| 内置池 (Built-in Pool) | 随站点内置的高频字词数据（离线可用，从零练习的基础） |
| 练习池 (Practice Pool) | 一次会话抽题来源 = 内置池 ∪ 已导入词库（按权重加权随机） |
| 练习会话 (Session) | 一轮练习，产出时长/准确率/速度/错键统计 |
| 课程 (Curriculum) | 五阶形状固定（键位认知/操练/字词练习/易错强化），内容 = 范式课程数据 + 通用渲染器；进度按方案拆键 `course.<scheme>` |
| 课程数据 (Course Data) | 每方案一份（`js/courses.js`，schema v1）：五阶清单（键位图/间隔操练/池练习/错词）+ 易混对 + 七日挑战谓词；双拼五变体共用骨架，全拼为提速变体；注音/粤拼/仓颉/速成/五笔画五阶与五笔 86 字根总表已全范式供给 |
| 提示层级 (Hint Level) | 全提示（①②顺序+键盘高亮+拼音）/ 仅按键 / 无提示，用户手选 |
| 错词本 (Mistake Book) | 按词聚合的失败记录，上限 200 条，供易错强化阶段取题 |
| 错键热力图 (Key Heatmap) | 26 键的错误率着色（错误数/总按数） |
| 错键惩罚 (Wrong-Key Punish) | 小程序设置项：关=标红续打（默认），开=整段清空回词首；错键振动恒触发不受开关影响 |
| 数据备份 (Backup) | 小程序统一 JSON 备份（`{v:1, data:{键:信封}}` 打包全部 `flypy.v1.*`），导出走转发文件、导入走聊天文件选取，兼作「删小程序即丢」自救通道 |
| 同步快照 | Rime 导出的 `*.userdb.txt`，行格式 `code word \x01 c=N d=N t=N`，code 为全拼 |
