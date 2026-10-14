# Design

## Context

`harness-observability-suite` 已交付确定性 JSONL 导出与批量评测闭环；exporter/enricher/runner 均已存在。本 change 在现有架构上补两件事：真实数据源对接（让真实运行导出完整 `text`/`toolArgs`）与真实模型联调入口（`--real`）。见 proposal.md - Why。

## Goals / Non-Goals

**Goals:**
- enricher 接入真实 session 数据源：`message.completed` → assistant 文本；`tool.*` → 按 `toolCallId` 匹配的工具参数；源缺失可空不抛错。
- exporter 装配注入 `readRawEntries` source，真实运行导出的 JSONL 含完整增强字段。
- 提供 `scripts/real-eval-runner.mjs`：真实 Pi provider/model 跑一次 session → 真实 HarnessEvent → exporter → JSONL → 断言增强字段完整且脱敏。
- typecheck + 相关 vitest 通过；新增 enricher 真实 SessionEntry 单测。

**Non-Goals:**
- 不接 OTLP/Langfuse/Jaeger 服务；不改存量面板；不接 CI 流水线本身。
- 真实 LLM 结果不进入稳定 baseline；不把真实结果作为确定性回归基准。
- 不在命令行接收 API Key；不把真实 prompt/参数/响应提交仓库。

## Decisions

**D1: enricher 作为真实数据源消费端（方案 A）**
保持 exporter 只读消费 `HarnessRuntime.onEvent`；`HarnessEventExporter` 的 `source` 注入 `readRawEntries(sessionId)`。备选（改 `HarnessEvent`/adapter 源头）会污染共享事件模型、波及 trace/replay，弃用。

**D2: 工具参数按 `toolCallId` 精确匹配；assistant 文本按消息顺序匹配**
`SessionEntry.ToolCallContent` 有稳定 `toolCallId`/`input`；assistant 文本用"同一 session 内 assistant 消息与 `message.completed` 的先后顺序"近似匹配。源缺失时字段可空（延续原 spec）。

**D3: `--real` 独立入口而非改造默认 runner**
新增 `scripts/real-eval-runner.mjs`：有网络/模型/配置依赖，不应被 CI 或默认评测误调用。默认复用当前 Pi 配置，允许 `--provider`/`--model` 覆盖，不接受 API Key。

**D4: 真实结果隔离**
真实联调输出到本地忽略目录；结果写入联调报告/导出文件，不写入稳定 baseline；真实 smoke 作为验收补充证据，不参与确定性回归。

## Risks / Trade-offs

- [真实模型结果有波动/中转限流 429] → smoke 路径只断言"链路通 + 字段完整 + 脱敏"，不设指标阈值；失败返回运行错误，不修改 baseline。
- [assistant 文本顺序匹配可能错位] → 单测覆盖顺序边界；工具参数用 `toolCallId` 精确匹配，文本顺序仅在单会话内近似。
- [真实 session 读取失败] → enricher 静默返回空增强字段，导出不中断（延续原 spec 边界）。
- [真实 prompt/参数被提交] → 输出目录在忽略规则内；命令不回显 API Key；验收检查 JSONL 中无未脱敏 secret。
