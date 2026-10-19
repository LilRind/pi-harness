# Design

## Context

现有基础由三部分组成：`eval-runner` 的确定性 suite 评测、`real-eval-runner` 的真实 Pi 会话 smoke、以及 `standard-export` 产出的 JSONL 和只读 viewer。它们已经能证明链路正确，但执行入口分散在 CLI 和本地文件中，缺少统一的工作台、历史存储和对比视图。

本设计采用 B 阶段先交付独立本地 Web 工作台，A 阶段再迁入 pi-harness Electron 桌面端。B 阶段不修改 `standard-export` 契约，也不把 Electron IPC 作为前置条件；所有能力通过可复用的评测服务和纯函数核心实现，为后续桌面端集成保留边界。

## Goals / Non-Goals

**Goals:**

- 提供本地 Web UI，覆盖 suite 查看、参数覆盖、执行、实时状态、报告、历史、任意两次对比和 trace 查看。
- 将确定性评测与真实 Pi 会话评测统一到同一运行编排模型。
- 用结构化 JSON 历史保存运行配置、状态、指标和产物位置。
- 将指标计算、事件完整性检查、重复采样聚合和两次运行对比实现为可测试的纯函数或服务接口。
- 保持 CLI 可用，并避免 CLI、Web UI、未来 Electron UI复制三份评测逻辑。
- 为 A 阶段 Electron 集成保留_transport-neutral_的服务边界。

**Non-Goals:**

- 不实现完整可视化用例编辑器；MVP 只展示文件定义 suite 并编辑运行覆盖参数。
- 不接入 Electron 桌面端 UI；A 阶段单独规划。
- 不引入 SQLite；第一版使用结构化 JSON store 和查询接口。
- 不实现完整工具安全策略；MVP 只提供固定白名单和安全演示命令。
- 不把 LLM-as-judge 纳入 baseline 或主 PASS/FAIL。
- 不做上下文管理、记忆系统、插件化和历史删除。

## Decisions

### D1: B 阶段采用本地 Web UI + 本地服务

新增一个只绑定 `127.0.0.1` 的本地服务和对应 Web UI。UI 使用项目现有 Vue/Vite 技术栈，不引入新的前端框架；服务使用 Node 实现，负责 suite catalog、运行编排、历史查询、报告读取和 JSONL 读取。

选择这个方案而不是直接嵌入 Electron，是为了先快速交付可演示闭环，并避免在需求未稳定时改造桌面端导航和 IPC。相比纯静态页面，本地服务能安全地读取 suite、启动真实 Pi 会话并持久化历史；相比直接改 Electron，它更容易测试和后续迁移。

替代方案：

- 直接做 Electron 面板：更接近最终形态，但会把 UI、IPC、桌面导航和运行编排耦合在第一版。
- 纯静态 viewer 扩展：无法安全启动真实会话，也无法提供持久历史服务。

### D2: CLI 与 Web UI 共享评测核心

将现有 runner 中可复用的 suite 加载、JSONL 渲染、断言评估、指标聚合、报告生成和真实会话执行逻辑抽成可导入的核心模块。CLI 保留为薄入口，Web 服务调用同一核心，不通过解析 CLI stdout 获取细粒度事件。

这样避免复制逻辑，也让单元测试直接覆盖核心行为。实时事件由运行编排器在执行过程中发出，CLI 可以压缩为摘要输出，Web UI 订阅完整事件流。

替代方案：

- Web 服务直接 spawn 当前 CLI 并解析 stdout：实现快，但无法可靠得到 fixture 级实时状态和事件流。
- 只给 Web UI 重写一套 runner：短期看似独立，长期会造成 CLI 与 UI 指标口径分裂。

### D3: 运行编排采用统一 Run Model

每次用户点击执行都创建一个 studio run，包含：

- run id、创建时间、模式（deterministic-suite / real-pi-suite / ad-hoc-real）；
- suite id 与版本信息；
- 参数覆盖（provider、model、prompt、工具、阈值、重复次数、超时等）；
- repeat 列表和每次 repeat 的状态；
- 汇总状态、报告、指标、产物路径和错误信息；
- 关联 session 目录与临时工作目录。

确定性 suite 和真实 Pi suite 共享 run 状态机：`pending → running → completed / failed / cancelled / timeout`。ad-hoc real 是只有一个用例的真实运行，也使用同一状态机，避免单独发明一套生命周期。

### D4: 实时通信使用 SSE，操作使用普通 HTTP API

本地服务提供只读事件流端点，使用 Server-Sent Events 推送 run lifecycle、fixture 状态和事件追加；启动、取消、查询历史、对比等操作使用普通 HTTP API。

SSE 足够承接服务端单向推送，且不需要新增 WebSocket 依赖。取消等用户动作走独立 API，避免把控制指令混入事件流。UI 重连时按 run id 读取当前快照，再继续订阅增量事件。

替代方案：

- 轮询：实现简单，但事件顺序和实时性差。
- WebSocket：双向能力更强，但本场景主要是服务端推送，引入额外依赖不划算。

### D5: 本地服务加启动令牌和 Host 校验

服务启动时生成一次性本地 token，并只接受 `127.0.0.1` 或 `localhost` 的 Host。浏览器打开 UI 时携带该 token；API 和 SSE 请求都必须通过校验。

该边界用于降低其他本地网页访问评测服务或触发真实会话的风险。UI 不接受明文 API Key，真实会话只复用本机 Pi 配置。

### D6: 历史使用 JSON store + 查询接口

第一版历史存储放在本地忽略目录下，采用一个 run index 加每个 run 的详细 record/report 文件。写入使用临时文件加原子替换，避免半写损坏。

查询层提供按 run id、suite、模式、状态和时间过滤的接口，不把文件布局暴露给 UI。删除接口不做。这样满足 MVP 的持久化与任意对比，又避免过早引入 SQLite。

### D7: 指标计算实现为纯函数

指标计算输入导出的 JSONL 解析结果、fixture 结果和 run 配置，输出稳定 schema。核心函数不访问网络、不读取 UI 状态、不启动进程。

指标口径：

- 通过率 = 通过 fixture 数 / 总 fixture 数；
- token = usage 总和，兼容 `usage.total` 与 `totalTokens`；
- 耗时 = run 终止时间 - run 开始时间；
- 首事件延迟 = 第一条非 `run.started` 事件时间 - `run.started` 时间；
- 工具执行耗时 = 配对的 `tool.completed.timestamp - tool.started.timestamp`；
- 工具失败率 = `isError:true` 的 `tool.completed` / 全部 `tool.completed`；
- 工具错误数 = `tool.completed && isError === true` 的事件数；
- 模型响应耗时仅在存在可配对的 `message.started/completed` 时计算，否则为空；
- 成本仅在 provider usage 包含成本数据时记录，否则为空；
- 事件完整性由 run/message/tool 生命周期状态机和 footer/event count 一致性检查得出。

### D8: 重复采样与 baseline 分层记录

一次 studio run 可包含多个 repeat。每个 repeat 保留完整个体结果，run 层保存均值、最小值、最大值，以及样本数不少于 2 时的离散度。baseline 创建引用同一套聚合结构，并记录采样次数、原因和版本。

确定性 suite 默认 1 次；真实 LLM suite 默认建议 3 次，但次数可配置。这样既承认真实模型波动，也不把个人项目的配额成本固定得过高。

### D9: LLM-as-judge 作为独立可选评估器

确定性断言和核心指标生成主结论。LLM-as-judge 是显式可选评估器，其输入、模型、prompt、分数和原文摘要在报告中单独展示，并带有 `judge` 标记。该结果不进入通过率、regression 或 baseline。

这保留了定性评估价值，同时避免裁判模型波动污染回归判定。

### D10: 真实 Pi 会话通过隔离执行器启动

真实 Pi 执行器为每次 repeat 创建独立 session 目录和临时 cwd，并通过现有 Pi 配置选择 provider/model。工具白名单固定；MVP 的 bash 场景只允许安全演示命令（如 `echo ok`）。执行器负责超时、取消和进程树终止，并在终止后收集已产生的 session、JSONL 和错误信息。

该执行器复用真实 Pi Agent 会话与 `standard-export` 链路，不在 Web 服务中伪造 Agent 事件。A 阶段可将该执行器替换或包装为 Electron 主进程服务。

### D11: trace 视图复用 JSONL 解析逻辑

现有 viewer 的 JSONL 解析、span 树重建和摘要计算抽成可复用模块。Web UI 通过本地服务读取指定 run 的 JSONL，再用同一解析逻辑渲染事件树、时间线和摘要，避免 viewer 与工作台展示口径分裂。

### D12: 图表优先复用现有前端能力

历史对比和重复运行波动优先复用项目已有的 Vue 图表能力或轻量封装，不新增重型图表依赖。对比图至少展示通过率、token、耗时和工具失败率的数值、单位和变化方向。

## Risks / Trade-offs

- [本地服务被其他页面访问] → 仅绑定 `127.0.0.1`，校验 Host 与启动 token，敏感操作必须显式触发。
- [真实会话执行成本高] → 重复次数可配置，真实 LLM baseline 默认建议 3 次而非强制更高。
- [取消进程不彻底] → 执行器记录子进程树，取消时终止整棵进程树并标记 run 状态；验收测试覆盖取消后的残留目录检查。
- [历史 JSON 文件增长] → MVP 先用 index + per-run record，保留迁移到 SQLite 的查询接口；不做自动删除。
- [实时事件丢失] → run 状态和事件写入持久记录，UI 重连后先读快照再订阅增量。
- [模型响应耗时数据不完整] → 只有事件可配对时计算，否则稳定空值，不估算。
- [LLM-as-judge 波动] → 独立展示，不进入主结论或 baseline。
- [B/A 两阶段重复开发] → 服务核心不依赖 Electron IPC，UI 不使用 Electron-only API，为 A 阶段迁移保留边界。
- [suite 参数覆盖语义混乱] → 覆盖值只属于 run，不回写 suite 源文件；完整编辑器延后。

## Migration Plan

1. 先抽离评测核心与 JSONL 解析核心，保持现有 CLI 输出兼容。
2. 增加 studio run 编排、历史存储和指标扩展，并用单元测试锁定 schema。
3. 增加本地 Web UI 和 SSE 事件流，先打通确定性 suite。
4. 接入隔离的真实 Pi 会话执行器、取消和超时。
5. 增加历史对比、重复采样和 trace 视图。
6. A 阶段另立 change，将本地服务包装进 Electron 主进程，并把 UI 挂到 pi-harness 桌面导航中。

回滚策略：B 阶段新增独立入口和存储目录，不影响现有 `standard-export` 契约；如工作台故障，可继续使用原 CLI runner 和 viewer，历史文件保留不迁移。

## Open Questions

- 工作台页面的视觉布局和演示文案可在实现后期打磨，不改变本设计的架构和规约。
- A 阶段 Electron 内的具体导航位置和 IPC 包装方式留给后续 change。
- 更完整的工具安全命令集留给后续安全设计。
