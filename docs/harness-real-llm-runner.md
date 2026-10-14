# 真实 LLM 联调（real-eval-runner）

`scripts/real-eval-runner.mjs` 用真实大模型跑一次会话，验证"真实模型 → Pi CLI → session → 真实 HarnessEventExporter → JSONL 完整增强字段"链路。

## 命令

```bash
node scripts/build-export-bundle.mjs          # 先把 TS exporter 打包成 ESM bundle（必做一次）
node scripts/real-eval-runner.mjs --provider zhipu --model glm-5.2
```

- `--provider` / `--model`：覆盖默认配置（默认复用 `~/.pi/agent/models.json` 的 provider/model）。
- 输出：`harness-obs-output/real/exports/<runId>.jsonl` + `harness-obs-output/real/real-report.json`。
- 退出码：`0` PASS（文本/工具字段完整、secret 形态已脱敏）、`1` FAIL、`3` 运行错误。

## 真实协议说明

真实 Pi session 的 toolCall 块使用 `{ type:'toolCall', id, name, arguments }`；
enricher 同时兼容本 change 的 `{ toolCallId, toolName, input }` 契约与 Pi 的
`id/arguments` 形式，按 `toolCallId`（或 `id`）匹配，真实导出中
`enriched.toolArgs` 携带原始参数。assistant 文本按消息顺序匹配到
`enriched.text`。

## 安全边界

- 命令行不接受 API Key（复用现有 Pi 配置/环境变量）。
- 真实 prompt、工具参数、模型响应与导出文件只落在本地忽略目录，不提交仓库、不进稳定 baseline。
- secret 形态（如 `sk-...`）在写盘前经 `redactSecretText` 掩码；真实联调断言导出中无明文 seed。

## 说明

exporter/enricher 的真实数据源行为由单元测试覆盖（`enricher.test.ts`、
`harness-event-exporter.test.ts`）；`real-eval-runner.mjs` 负责真实模型端。