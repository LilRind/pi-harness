# grill-me 访谈摘要 — harness-real-llm-enrichment

> 日期：2026-10-14；工具链：grill-me → OpenSpec propose/apply/verify/archive
> 目标：让真实运行也能导出完整字段（assistant 文本 + 工具参数），并用真实大模型做一次真实联调，证明生产链路（真实模型 → Pi runtime → HarnessEvent → enricher → exporter → JSONL → viewer）真的通。

## 已拍板决策（Q1-Q6）

1. **需求形态（Q1）**：新建独立 change `harness-real-llm-enrichment`，不重开已归档的 `harness-observability-suite`（归档已完成、specs 已同步，重开会污染归档）。
2. **数据接入方式（Q2）**：推荐 A——enricher 是消费端，注入 `readRawEntries(sessionId)` 作为真实数据源；不改 `HarnessEvent` 事件模型、不破坏 trace/replay 语义。
3. **匹配键与边界（Q3）**：工具参数按 `toolCallId` 精确匹配；assistant 文本按"同一 session 内 assistant 消息与 `message.completed` 的先后顺序"匹配；源不可用（read 失败/找不到 entry）时 `enriched` 可为空。
4. **真实联调（Q4）**：新增 `--real` 真实模型命令（独立 `real-eval-runner.mjs`），**真实大模型必须参与**：真实模型 → Pi session → HarnessEvent → exporter → JSONL，缺了真实模型不足以证明真实性。默认复用当前 Pi 配置的 provider/model，允许 `--provider`/`--model` 覆盖；命令行不接受 API Key。真实模型结果有波动，不参与稳定回归 baseline，但参与验收。
5. **验收（Q5）**：A=enricher 真实 SessionEntry 单测；B=`--real` 完成一次真实模型 smoke run；C=typecheck + 相关 vitest 通过；D=真实 JSONL 中 `text`/`toolArgs` 完整且脱敏。
6. **流程（Q6）**：按 AGENTS.md 工作流完整执行（interview → propose → 人工审阅 → `.spec-frozen` → apply → verify → 合并推送自己的仓库 origin，不推 upstream）。

## 已核实源码事实

- `SessionEntry.message`：`AssistantMessage.content` 是 `AssistantContentBlock[]`，文本在 `TextContent.text`，工具调用在 `ToolCallContent`（含 `toolCallId`/`toolName`/`input`）；`ToolResultMessage` 有 `toolCallId`/`isError`（src/shared/types/workspace.ts:46-116）。
- `HarnessEvent` 的 `tool.started/completed` 只有 `toolCallId`/`toolName`/`isError`，无工具参数；`message.completed` 只有 usage/model/provider，无文本（src/shared/types/harness.ts）。
- `SessionService.readRawEntries(sessionId)` 返回 `SessionEntry[]`（src/main/sessions/session-service.ts:207），`HarnessRuntime` 在构造处有 `options.sessions`，并有 `readEntries = (sessionId) => options.sessions?.readRawEntries(sessionId)`（src/main/harness/harness-runtime.ts:194-202）。
- 现有 `HarnessEventExporter` 构造接受 `HarnessEventExporterOptions{dir, enabled?, source?, registerExitHook?}`；`enricher.createEnricher(source)` 支持 `getText`/`getToolArgs`（src/main/harness/export/）。
- 现有 exporter 装配在 `HarnessRuntime` 构造处：`new HarnessEventExporter({dir, enabled})`，未传 `source`（src/main/harness/harness-runtime.ts:263-270）。

## 后续流程

1. propose：读取本文件生成 proposal/specs/design/tasks
2. 人工审阅 spec → 用户手动创建 `.spec-frozen` 空标记文件 → 才允许编码
3. 执行：apply（若需细粒度 TDD，用户提出才切换 superpowers 路径）
4. 校验：verify
5. 归档：PR 合并回自己的仓库 main 后 archive