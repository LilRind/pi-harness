# Tasks

## 1. 评测核心抽离与兼容

- [x] 1.1 运行 GitNexus impact 分析 `eval-runner`、`real-eval-runner`、viewer 解析逻辑和相关调用方，记录高风险编辑点；验证输出包含调用方、风险和后续保护性测试范围
- [x] 1.2 定义共享评测类型：SuiteCatalogEntry、RunConfigOverride、StudioRun、StudioRepeat、FixtureResult、MetricsReport、HistoryRecord；验证类型检查通过且 schema 单元测试覆盖必填字段与稳定空值
- [x] 1.3 从 `scripts/eval-runner.mjs` 抽出 suite 加载、fixture 渲染、断言评估和报告生成核心模块；验证原 CLI 输出路径与退出码保持兼容，相关单元测试通过
- [x] 1.4 从 `scripts/real-eval-runner.mjs` 抽出真实 session 读取、事件转换和导出断言核心；验证真实 smoke 核心单元测试通过且 CLI 继续生成 `real-report.json`
- [x] 1.5 从 `viewer/viewer.mjs` 抽出 JSONL 解析、span 树重建和摘要计算纯函数；验证 viewer 页面行为不变，解析函数单元测试覆盖事件行、footer 行和坏行

## 2. 扩展指标、重复采样与 baseline

- [x] 2.1 实现 JSONL 指标聚合纯函数，覆盖通过率、token、耗时、工具失败率、首事件延迟、工具执行耗时、工具错误数、成本和模型响应耗时；验证固定 JSONL fixture 的指标断言全部通过
- [x] 2.2 实现事件完整性状态机，检查 run/message/tool 生命周期配对和 footer/event count 一致性；验证完整、缺终止事件、未配对工具和计数不一致四类测试通过
- [x] 2.3 实现断言失败原因结构化输出，保留 fixture、断言类型、期望值、实际值和错误消息；验证失败用例报告可被程序读取且人工可读
- [x] 2.4 实现重复采样聚合，输出个体结果、均值、最小值、最大值和样本数不少于 2 时的离散度；验证 1/3/5 次采样的聚合测试通过
- [x] 2.5 扩展 baseline schema 与创建逻辑，记录采样次数、个体值、聚合值、波动范围、版本、原因和说明；验证普通运行不覆盖 baseline，显式更新才写入
- [x] 2.6 实现确定性断言与 LLM-as-judge 分层报告 schema，judge 结果带显式标记但不进入主结论；验证混合报告的主 PASS/FAIL 与 baseline 判定只依赖确定性结果

## 3. 历史存储与任意两次对比

- [x] 3.1 实现 JSON 历史 store：run index、per-run record、原子写入和启动加载；验证强制中断写入模拟后不会留下半写主文件
- [x] 3.2 实现历史查询接口，支持 run id、suite、模式、状态和时间过滤；验证组合过滤与空结果测试通过
- [x] 3.3 实现任意两次运行对比纯函数，输出配置差异、核心指标差异、单位、绝对变化和变化方向；验证优劣、变差、空值和同值场景测试通过
- [x] 3.4 为历史 record、报告和产物路径增加路径安全校验，禁止越出工作台数据根目录；验证路径穿越样本被拒绝的单元测试通过

## 4. 本地服务与安全边界

- [x] 4.1 搭建本地 eval-studio 服务入口，仅绑定 `127.0.0.1` 并生成启动 token；验证非 localhost Host、缺失/错误 token 的 API 请求被拒绝
- [x] 4.2 实现 suite catalog 与详情 API，返回 suite、fixture、断言和默认阈值；验证 `sample` suite API 输出与文件定义一致
- [x] 4.3 实现运行创建 API，校 provider、model、prompt、工具、阈值、重复次数和超时覆盖，并把覆盖值写入 run record；验证非法重复次数、非法超时和未知 suite 被拒绝
- [x] 4.4 实现 SSE run 事件流，推送 lifecycle、fixture 状态和事件追加，并支持通过快照恢复当前状态；验证断线重连后不丢 run 终态且事件顺序稳定
- [x] 4.5 实现取消 API 和取消状态落盘，确保已完成的 fixture、事件和部分报告保留；验证取消过程中的 run record 可读取且状态为 cancelled

## 5. 确定性 suite 工作台 UI

- [x] 5.1 创建 eval-studio Web UI 入口和基础导航，包含 suite、运行、报告、历史、对比和 trace 区域；验证本地页面可打开且无控制台错误
- [x] 5.2 实现 suite 列表与详情页，展示 fixture、场景、断言和默认阈值；验证 `sample` 的 12 条 fixture 全部可见
- [x] 5.3 实现运行参数表单，支持 provider、model、prompt、工具、阈值、重复次数和超时覆盖；验证提交的覆盖值与 run record 一致且 suite 源文件未被修改
- [x] 5.4 实现执行页实时状态与事件流，展示 fixture 进度、PASS/FAIL、失败断言和错误信息；验证一次确定性 suite 运行中 UI 收到有序 SSE 事件
- [x] 5.5 实现运行报告页，展示核心指标、扩展指标、fixture 明细、重复采样汇总和断言失败原因；验证报告数据与 API 返回一致

## 6. 真实 Pi 会话执行

- [x] 6.1 实现隔离真实 Pi 执行器：每次 repeat 独立 session 目录、临时 cwd、固定工具白名单、超时和取消；验证两个 repeat 的 session/cwd 不互相复用
- [x] 6.2 实现 MVP bash 安全白名单，仅允许安全演示命令（如 `echo ok`），并不接受明文 API Key；验证危险命令和密钥输入被拒绝
- [x] 6.3 将真实 Pi suite 模式接入统一 run 编排和 SSE 事件流；验证一次受控真实会话生成 JSONL、报告和历史记录
- [x] 6.4 实现单次即时真实测试模式，独立于 suite 批量入口；验证从表单提交到 run 报告和 trace 可打开的完整链路
- [x] 6.5 实现真实 LLM baseline 多次采样入口，默认建议 3 次且次数可配置；验证 3 次采样后 baseline 包含个体值、聚合值和波动范围

## 7. 历史、对比与 trace UI

- [x] 7.1 实现历史列表页，支持 suite、时间、模式和状态过滤，并显示运行配置摘要和状态；验证过滤后仅显示匹配记录
- [x] 7.2 实现任意两次运行选择和对比页，用表格展示配置差异和指标差异；验证每个指标显示数值、单位、绝对变化和变化方向
- [x] 7.3 实现对比图表和重复运行波动图，覆盖通过率、token、耗时和工具失败率；验证图表与对比 API 数值一致
- [x] 7.4 实现工作台 trace 视图，基于 run JSONL 渲染事件树、时间线、错误标记和摘要；验证与独立 viewer 对同一 JSONL 的核心摘要一致
- [x] 7.5 实现历史详情打开关联报告、JSONL、session 信息和产物路径；验证重启本地服务后仍可打开历史 run

## 8. LLM-as-judge 附加评估

- [x] 8.1 实现可选 LLM-as-judge 评估器配置与调用边界，输出分数、理由、模型、prompt 摘要和原文引用；验证缺省时不执行任何 judge 调用
- [x] 8.2 在报告 UI 中单独展示 judge 区域并显式标记其不影响主结论；验证包含 judge 结果时主通过率和 baseline 判定保持不变

## 9. 文档、集成与验收

- [x] 9.1 编写 eval-studio 使用文档，覆盖启动、token、suite 执行、真实会话、历史对比、trace、安全边界和已知边界；验证文档命令按原文可执行
- [x] 9.2 补充端到端测试：启动本地服务、加载 sample、执行确定性 suite、接收 SSE、生成历史、执行两次对比并打开 trace；验证自动化端到端测试通过
- [ ] 9.3 补充真实 Pi 会话受控验收：执行安全命令、生成导出、进入历史并对比；验证真实 run 指标、trace 和历史记录完整且脱敏
- [x] 9.4 执行 `pnpm typecheck`、目标 Vitest 套件和 lint 检查；验证命令退出码为 0或修复全部由本 change 引入的问题
- [x] 9.5 运行 GitNexus detect-changes 全量图变更分析并审查 HIGH/CRITICAL 风险；验证无未处理的高风险影响或已形成明确缓解记录

## Workflow follow-up

- 用户人工审阅 proposal、specs、design 与 tasks；确认迭代完成后再创建 `.spec-frozen`。
- 只有 `.spec-frozen` 存在后，才允许进入 `/opsx:apply` 的 TDD 实施循环。
- 实施与 `/opsx:verify` 通过后，按用户仓库规则推送、合并 main，再执行 `/opsx:archive 2026-10-16-harness-test-framework-ui`。
- 2026-10-19 verify 收尾：typecheck/80 测试/lint/GitNexus 全部通过；9.3 被外部 provider 403 阻塞，详见同目录 verify-report.md。
