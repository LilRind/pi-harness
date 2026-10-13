# Spec Delta: standard-export

## Purpose

提供 Harness 运行事件的标准导出能力：订阅 `HarnessRuntime.onEvent`，把内部私有 `HarnessEvent` 流按 run 导出为带 schemaVersion 的 JSONL 文件，经 enricher 补充会话增强字段并在写入前统一脱敏；同时提供 OTLP span 结构映射纯函数与单测，作为标准协议映射能力证明，但不接 OTLP 服务。导出数据可被独立只读 JSONL 查看器消费，作为“标准导出 → 任何前端都能消费”的验证。

本能力只读消费事件，不修改既有运行、追踪或评估持久化数据。

## ADDED Requirements

### Requirement: 按 run 导出 JSONL 文件

系统 MUST 订阅 `HarnessRuntime.onEvent` 作为跨 adapter 的稳定事件入口，并在 `run.started` 时为该 run 创建/打开一个 JSONL 导出文件。文件 MUST 位于导出目录（如用户数据下 `harness-exports/`），文件名 MUST 基于 `run.id` 并做 sanitize。导出行 MUST 携带 `schemaVersion`。运行期间，系统 MUST 把该 run 的 `HarnessEvent` 逐行追加为 JSON 对象，写入前 MUST 经脱敏处理。

#### Scenario: 正常运行完整落盘
- **WHEN** 一个 run 从 `run.started` 开始，经历若干事件后以 `run.completed` 结束
- **THEN** 导出目录中出现以 sanitize 后 `run.id` 命名的 JSONL 文件，包含从 `run.started` 到 `run.completed` 的全部事件行与 `schemaVersion`

#### Scenario: 并发 run 各自独立
- **WHEN** 多个 run 同时产生事件
- **THEN** 每个 run 写入各自独立的 JSONL 文件，互不覆盖，文件句柄由 `Map<runId, WriteStream>` 管理

#### Scenario: run.id 含特殊字符
- **WHEN** `run.id` 包含路径分隔符或文件系统特殊字符
- **THEN** 导出文件名被 sanitize，仍能唯一对应原 `run.id`，且不逃逸导出目录

#### Scenario: 事件追加不阻塞运行时
- **WHEN** 运行中事件持续产生
- **THEN** 事件写入内存缓冲或流式追加，不逐条阻塞刷盘；flush 主要在 run 终止时执行

### Requirement: run 终止落盘与收尾元信息

当 run 进入终止状态（`run.completed` / `run.failed` / `run.aborted`）时，系统 MUST flush 剩余缓冲、写入收尾元信息、关闭文件，并标记该文件完整可用。收尾元信息 MUST 包含运行级指标：`runId`、终止状态、`startedAt`、`endedAt`、`eventCount`、token、耗时、工具失败次数/总数。通过率 MUST NOT 属于单 run 收尾元信息。进程退出时，系统 MUST 对所有未关闭 run 执行 `flushAll`。

#### Scenario: 失败或被取消的 run 也落盘
- **WHEN** run 以 `run.failed` 或 `run.aborted` 结束
- **THEN** 已缓冲的事件仍被 flush 到文件，收尾元信息记录终止状态与运行级指标，文件被关闭并标记完整

#### Scenario: 进程退出不丢缓冲
- **WHEN** 进程在 run 未结束时退出
- **THEN** 退出钩子对该 run 执行 flush，已产生事件不因缓冲丢失

#### Scenario: 收尾元信息不含通过率
- **WHEN** 查看任一 run 的收尾元信息
- **THEN** 其中只含运行级指标（状态、起止时间、eventCount、token、耗时、工具失败次数/总数），不含 suite 级通过率

#### Scenario: 正常运行完整落盘
- **WHEN** 一个 run 从 `run.started` 开始，经历若干事件后以 `run.completed` 结束
- **THEN** 导出目录中出现以 sanitize 后 `run.id` 命名的 JSONL 文件，包含从 `run.started` 到 `run.completed` 的全部事件行、`schemaVersion` 与运行级收尾元信息

#### Scenario: 失败或被取消的 run 也落盘
- **WHEN** run 以 `run.failed` 或 `run.aborted` 结束
- **THEN** 已缓冲的事件仍被 flush 到文件，收尾元信息记录终止状态与运行级指标，文件被关闭并标记完整

#### Scenario: 并发 run 各自独立
- **WHEN** 多个 run 同时产生事件
- **THEN** 每个 run 写入各自独立的 JSONL 文件，互不覆盖，文件句柄由 `Map<runId, WriteStream>` 管理

#### Scenario: run.id 含特殊字符
- **WHEN** `run.id` 包含路径分隔符或文件系统特殊字符
- **THEN** 导出文件名被 sanitize，仍能唯一对应原 `run.id`，且不逃逸导出目录

#### Scenario: 进程退出不丢缓冲
- **WHEN** 进程在 run 未结束时退出
- **THEN** 退出钩子对该 run 执行 flush，已产生事件不因缓冲丢失

#### Scenario: 收尾元信息不含通过率
- **WHEN** 查看任一 run 的收尾元信息
- **THEN** 其中只含运行级指标（状态、起止时间、eventCount、token、耗时、工具失败次数/总数），不含 suite 级通过率

### Requirement: JSONL schema 固定且含增强字段

系统 MUST 定义并落盘最小 JSONL schema，包含 `schemaVersion`。schema 字段 MUST 分为两类：事件原生字段（`type`、`timestamp`、`runId` 及事件自带字段）与会话增强字段（`text`、`toolArgs`，由 enricher 补充）。断言与指标计算 MUST 只依赖 schema 中声明的字段；schema 版本号 MUST 随结构变化递增。

#### Scenario: 导出行可被确定性解析
- **WHEN** 读取导出文件中的任意行
- **THEN** 该行按 schemaVersion 声明的字段结构可解析，断言与指标仅依赖这些字段

#### Scenario: 增强字段有值
- **WHEN** 事件涉及 assistant 文本或工具参数
- **THEN** 导出行包含脱敏后的 `text` / `toolArgs` 增强字段（来源受限时可为空，但字段名稳定）

### Requirement: 导出内容必须脱敏

系统 MUST 在导出每条事件前应用与现有 `redactSecrets` 一致的脱敏处理，确保 API key、token、凭证等敏感内容不以明文进入导出文件。脱敏 MUST 发生在写入磁盘之前；系统 MUST NOT 先落盘再脱敏。enricher 补充的 `text` / `toolArgs` MUST 也在写入前脱敏。OTLP span 映射 MUST 基于脱敏后的事件。

#### Scenario: 敏感信息被掩码
- **WHEN** 某条事件载荷包含疑似 secret 的字段
- **THEN** 导出行中对应值被脱敏掩码，原文不出现

#### Scenario: 脱敏先于落盘
- **WHEN** 事件或增强字段被写入 JSONL 文件
- **THEN** 磁盘上不存在未脱敏的 secret 明文

#### Scenario: OTLP 映射不绕过脱敏
- **WHEN** 对事件执行 OTLP span 映射
- **THEN** 映射输入为脱敏后事件，输出中不包含未脱敏 secret

### Requirement: 提供 OTLP span 结构映射（序列纯函数）

系统 MUST 提供纯函数，输入为该 run 的完整脱敏事件序列（`events[] → spans[]`），内部按事件顺序使用局部状态机合并 `message.started/completed`、`tool.started/completed` 等配对事件，输出 OTLP span 结构，包含 span 名称、`traceId`、`spanId`、`parentSpanId`（如适用）、起止时间戳、状态与关键属性。该纯函数 MUST 无外部副作用、同输入同输出，并配单元测试。系统 MUST NOT 在本周接入 OTLP 服务、Collector、网络推送、端口、重试或批量发送。

#### Scenario: 事件序列映射为 span
- **WHEN** 输入含 `message.started` / `message.completed` 或 `tool.started` / `tool.completed` 的完整序列
- **THEN** 纯函数输出对应 span 结构，包含正确的名称、起止时间、状态与关键属性

#### Scenario: 映射有单测覆盖
- **WHEN** 运行单元测试
- **THEN** 关键事件类型、未配对事件与边界情况被测试覆盖

#### Scenario: 不接 OTLP 服务
- **WHEN** 执行导出或映射
- **THEN** 不发起任何 OTLP 网络请求，不依赖 Collector、端口或外部服务

### Requirement: 提供独立只读 JSONL 查看器作为消费端验证

系统 SHOULD 提供独立只读 JSONL 查看器：浏览器本地解析拖拽文件，渲染 span 嵌套树、耗时、时间线、错误标记、脱敏参数预览和简单趋势图。查看器 MUST 为独立静态页面 / 独立 Vite 入口，可在未启动 app 的浏览器环境打开；MUST 与应用运行时解耦，MUST NOT 修改 `HarnessRunDetailPanel` 或新增存量面板 tab。趋势图仅作为附赠展示，不作为独立验收项。

#### Scenario: 拖入 JSONL 可渲染
- **WHEN** 用户把导出的 `run.id.jsonl` 拖入查看器
- **THEN** 查看器本地解析并渲染 span 嵌套树、耗时、时间线、错误标记与脱敏参数预览

#### Scenario: 查看器不依赖 app 内部状态
- **WHEN** 在未启动 app 的浏览器环境打开查看器
- **THEN** 仅凭 JSONL 文件即可渲染，不需要 IPC、登录或全局 store

#### Scenario: 不动存量面板
- **WHEN** 查看器交付
- **THEN** `HarnessRunDetailPanel` 未被修改，未新增存量面板 tab

### Requirement: 导出不修改既有运行数据

系统 MUST 使导出层只读消费 `HarnessRuntime.onEvent` 广播的事件，不修改运行记录、追踪或评估的既有持久化数据。导出目录 MUST 是新增持久化输出，不覆盖现有 JSON store。

#### Scenario: 导出与存量 store 解耦
- **WHEN** 导出层运行于一个 run 上
- **THEN** 既有的 run/trace/evaluation JSON store 内容不被改变

#### Scenario: 导出目录独立
- **WHEN** 导出文件写入磁盘
- **THEN** 文件写入新增导出目录（如 `harness-exports/`），不覆盖现有 JSON store

### Requirement: 本周明确不做

以下内容本周 MUST NOT 作为验收项：

- OTLP 服务、Collector、Langfuse / Jaeger 部署；
- 上下文 / 成本水位仪表（数据可在 JSONL 中自然带上，趋势图仅附赠）；
- 存量面板改造（包括 `HarnessRunDetailPanel` 新增 tab）；
- CI 流水线接入本身（产物可被 CI 消费，接入留 out-of-scope）；
- 回放已录制 session 作为评测集；
- 幻觉率自动判定；
- 召回 / 精确率；
- 规划步骤冗余度门禁；
- 子 Span 嵌套深度门禁；
- 独立对照表（降级为口述稿差异段落）。

真实 LLM 输出 run 不作为本周验收项：仅作为附赠演示路径（exporter 捕获真实会话 JSONL 后由查看器消费），不进入验收判定。

#### Scenario: out-of-scope 不被当作验收项
- **WHEN** 评审本周交付
- **THEN** 上述内容不作为验收项；真实 LLM run 若被展示，只作为附赠或后续增强说明