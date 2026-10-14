# Spec Delta

## MODIFIED Requirements

### Requirement: JSONL schema 固定且含增强字段

系统 MUST 定义并落盘最小 JSONL schema，包含 `schemaVersion`。schema 字段 MUST 分为两类：事件原生字段（`type`、`timestamp`、`runId` 及事件自带字段）与会话增强字段（`text`、`toolArgs`，由 enricher 补充）。断言与指标计算 MUST 只依赖 schema 中声明的字段；schema 版本号 MUST 随结构变化递增。

enricher 的增强字段 MUST 支持真实数据源：当 exporter 装配时注入 `SessionService.readRawEntries(sessionId)` 作为 source，系统 MUST 从真实 session 消息中为 `message.completed` 补充 assistant 文本、为 `tool.started` / `tool.completed` 补充工具参数（按 `toolCallId` 匹配）。真实运行导出的 JSONL MUST 包含完整增强字段；源不可用（读取失败或找不到匹配 entry）时字段可空，但字段名 MUST 保持稳定。

#### Scenario: 导出行可被确定性解析
- **WHEN** 读取导出文件中的任意行
- **THEN** 该行按 schemaVersion 声明的字段结构可解析，断言与指标仅依赖这些字段

#### Scenario: 增强字段有值
- **WHEN** 事件涉及 assistant 文本或工具参数
- **THEN** 导出行包含脱敏后的 `text` / `toolArgs` 增强字段（来源受限时可为空，但字段名稳定）

#### Scenario: 真实 session 补充 assistant 文本
- **WHEN** exporter 注入 `readRawEntries` 且真实 session 中存在 assistant 消息
- **THEN** 对应 `message.completed` 导出行包含该 assistant 文本（脱敏后）

#### Scenario: 真实 session 补充工具参数
- **WHEN** exporter 注入 `readRawEntries` 且真实 session 中存在带 `toolCallId` 的工具调用
- **THEN** 对应 `tool.*` 导出行包含按 `toolCallId` 匹配的 `toolArgs`（脱敏后）

#### Scenario: 源不可用时字段可空
- **WHEN** session 读取失败或找不到匹配 entry
- **THEN** 导出行仍以稳定字段名输出，值为空/缺省，不抛错、不中断导出

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

真实 LLM 输出 run 本周参与验收（smoke 路径）：通过 `--real` 真实模型命令导出一份真实 JSONL 并断言增强字段完整且脱敏；真实 LLM 结果有波动，不进入稳定 baseline，不作为确定性回归基准。

#### Scenario: out-of-scope 不被当作验收项
- **WHEN** 评审本周交付
- **THEN** 上述 out-of-scope 内容不作为验收项

#### Scenario: 真实 LLM smoke 参与验收
- **WHEN** 执行 `--real` 真实模型命令
- **THEN** 真实 JSONL 中 `text` / `toolArgs` 增强字段完整且脱敏；该结果作为 smoke 验收，不写入稳定 baseline
