# Proposal

## Why

现有评测能力已经具备 CLI、确定性 fixture、真实 LLM smoke、JSONL 导出和只读 viewer，但配置、执行、历史查询与对比仍分散在命令行和本地文件中，无法形成可演示、可日常使用的测试闭环。为了继续验证 Pi Agent 会话质量，并为后续上下文管理与记忆系统提供可复现的评估基础，需要把这些能力整合为本地测试工作台，并保留后续迁入 pi-harness 桌面端的演进路径。

## What Changes

- 新增独立本地 Web 测试工作台（B 阶段）：提供 suite 查看、运行参数编辑、执行触发、实时状态与事件、结果报告、历史查询、任意两次运行对比和 JSONL/span 查看入口。
- MVP 保持 suite 由文件定义，不在第一版实现完整可视化用例编辑器；UI 允许查看 suite 并编辑 provider、model、prompt、工具、阈值、重复次数等运行参数。
- 支持两种测试形态并优先 suite 回归测试：多 fixture 批量回归优先，单次即时真实测试随后补充。
- 将真实 Pi Agent 会话纳入测试执行路径，并为每次运行提供独立 session 目录、临时工作目录、固定工具白名单、超时与取消能力。
- 扩展现有指标口径：在通过率、token、耗时、工具失败率之外增加断言失败原因、首事件延迟、工具执行耗时、工具错误数、事件完整性、重复运行波动、provider 可用时的成本，以及事件映射可支持时的模型响应耗时。
- 扩展重复运行与 baseline 规则：运行重复次数可配置；真实 LLM baseline 需要多次采样并记录个体值、聚合值和离散度，baseline 采样次数可配置且默认建议 3 次。
- 持久化测试历史，提供 run/report 查询抽象，并支持任意两次运行的可视化差异对比；第一版不做删除。
- 评估判定分为确定性断言与显式 LLM-as-judge 两类；MVP 中 LLM-as-judge 只作为附加报告维度，不进入 baseline。
- 后续 A 阶段将本地服务与工作台能力迁入 pi-harness Electron 桌面端，使其成为桌面应用中的直接功能；本 change 先交付 B 阶段并保留集成边界。

## Capabilities

### New Capabilities

- `eval-studio`: 本地评测工作台能力，覆盖 suite 查看、参数编辑、执行编排、实时事件、报告展示、持久化历史、任意两次运行对比、JSONL/span 查看入口，以及真实 Pi 会话运行隔离与取消。

### Modified Capabilities

- `eval-loop`: 扩展评测指标、重复执行、真实 Pi 会话测试、baseline 采样与聚合规则，并明确确定性断言与 LLM-as-judge 的边界。

## Impact

- 新增本地 Web UI 与本地服务的入口、路由/页面、运行编排和测试历史存储。
- 复用并扩展 `scripts/eval-runner.mjs`、`scripts/real-eval-runner.mjs`、suite fixture 加载、JSONL 导出与 viewer 的解析/展示逻辑。
- 涉及评测指标聚合、报告 schema、历史存储 schema、baseline schema、真实 Pi session 启动与隔离、取消与超时处理。
- 需要补充单元测试与端到端验收测试，覆盖指标计算、历史查询、两次运行对比、事件完整性、真实会话隔离和 UI 关键流程。
- 不修改 `standard-export` 的既有导出契约；工作台消费其 JSONL 产物。
- A 阶段 Electron 集成、完整可视化用例编辑器、完整工具安全策略、上下文管理与记忆系统均不在本 change 的 MVP 验收范围内。
