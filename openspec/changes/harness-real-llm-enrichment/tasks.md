# Tasks

## 1. 真实数据源对接（standard-export）

- [x] 1.1 扩展 enricher：支持真实 `readRawEntries(sessionId)` source，为 `message.completed` 补充 assistant 文本、为 `tool.*` 按 `toolCallId` 匹配补充 `toolArgs`；源缺失时字段可空不抛错；验证：enricher 真实 SessionEntry 单测通过（文本匹配、toolCallId 匹配、缺失边界）
- [x] 1.2 exporter 装配注入真实 source：`HarnessRuntime` 构造处把 `options.sessions` 的 `readRawEntries` 传给 `HarnessEventExporter({ source })`；验证：单测断言注入后真实事件导出包含增强字段；typecheck 通过
- [x] 1.3 真实运行导出验证：构造含 assistant 消息 + 工具调用的 SessionEntry fixture，驱动 exporter，断言 JSONL 中 `text`/`toolArgs` 完整且经 `redactSecrets` 脱敏；验证：新增单测通过

## 2. 真实模型联调入口（eval-loop）

- [x] 2.1 新增 `scripts/real-eval-runner.mjs`：复用当前 Pi 配置的 provider/model（允许 `--provider`/`--model` 覆盖，不接受 API Key），跑一次真实 session，走真实 HarnessEvent → exporter → JSONL；验证：命令可启动并产出真实 JSONL 与联调报告
- [x] 2.2 真实 smoke 断言：检查真实 JSONL 中至少一条 assistant `text`、至少一条工具调用及其 `toolArgs` 非空、无未脱敏 secret；结果输出到本地忽略目录，不写入稳定 baseline；验证：运行 `node scripts/real-eval-runner.mjs` 后报告显示断言结果
- [x] 2.3 文档：说明 `--real` 命令、安全边界（不传 API Key、结果不进 baseline、输出隔离）与真实 LLM smoke 的验收角色；验证：按文档命令可复现

## 3. 验收与推送

- [x] 3.1 执行 typecheck + 相关 vitest（含新增 enricher/真实导出单测）；验证：全部通过
- [x] 3.2 执行一次真实模型 smoke（若本机中转可用）并留存联调报告；验证：真实 JSONL 增强字段完整且脱敏
- [x] 3.3 提交到新分支、合并回 main、推送到 `github.com/LilRind/pi-harness`（不推 upstream）；验证：origin/main 包含本 change 全部文件

## Workflow follow-up

- 人工审阅 + 手创 `.spec-frozen` 后执行 apply
- 校验 verify
- PR 合并回 main 后执行 archive `harness-real-llm-enrichment`
