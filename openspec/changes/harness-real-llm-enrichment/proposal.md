# Proposal

## Why

`harness-observability-suite` 已交付确定性 JSONL 导出与批量评测闭环，但存在一个真实缺口：exporter 的 enricher 未接入真实 session 数据源，真实运行导出的 JSONL 中 `text` / `toolArgs` 增强字段为空；且"真实 LLM run"被明确排除在验收之外，导致"真实模型 → Pi runtime → HarnessEvent → enricher → exporter → JSONL → viewer"这条生产链路从未被真正验证过。本 change 补上真实数据源对接，并把真实大模型联调纳入验收。

## What Changes

- **标准导出层（MODIFIED）**：enricher 接入真实数据源 `SessionService.readRawEntries(sessionId)`，为 `message.completed` 补充 assistant 文本、为 `tool.*` 补充工具参数（按 `toolCallId` 匹配；源不可用时字段可空）。真实运行导出的 JSONL 将包含完整增强字段。
- **批量评测闭环（MODIFIED）**：新增 `--real` 真实模型联调入口（独立 `scripts/real-eval-runner.mjs`）：复用当前 Pi 配置的真实 provider/model 跑一次真实 session，导出 JSONL，并断言 `text`/`toolArgs` 完整且脱敏。真实 LLM 从"不作为验收项"提升为"参与验收（smoke）"，但结果有波动，不进入稳定 baseline。
- **验收（ADDED）**：A=enricher 真实 SessionEntry 单测；B=`--real` 完成一次真实模型 smoke run；C=typecheck + 相关 vitest 通过；D=真实 JSONL 中 `text`/`toolArgs` 完整且脱敏。

## Capabilities

### New Capabilities
-（无：不新增能力。）

### Modified Capabilities
- `standard-export`: 变更"JSONL schema 固定且含增强字段"——增强字段由真实 session 数据源补充（不再仅靠模拟器）；变更"本周明确不做"——真实 LLM run 从"附赠演示"改为"参与验收的 smoke 路径"。
- `eval-loop`: 变更"评测集由确定性 fixture 组成"——确定性 fixture 仍是稳定回归基线，但新增 `--real` 真实模型 smoke 入口并纳入验收；变更"本周明确不做"——真实 LLM run 从"不作为验收项"改为"参与验收（smoke）"。

## Impact

- 代码：`src/main/harness/export/enricher.ts`（真实数据源匹配）、`harness-event-exporter.ts`（source 注入与装配）、`harness-runtime.ts`（向 exporter 传 `readRawEntries` source）、`scripts/real-eval-runner.mjs`（新增真实联调入口）、相关测试。
- API：`eval-runner` 新增 `--real`（或独立 `real-eval-runner.mjs`）真实模型命令；不改既有 IPC/服务接口。
- 依赖：复用现有 Pi 配置/模型；不新增运行时第三方依赖；不把 API Key 写入命令、报告或仓库。
- 数据：真实联调输出到本地忽略目录，不提交 JSONL/报告；真实运行结果不进稳定 baseline。
- 安全：命令行不接受明文 API Key；真实 prompt/工具参数/响应不回显、不提交。