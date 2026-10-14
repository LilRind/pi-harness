# 真实 LLM 联调（real-eval-runner）

`scripts/real-eval-runner.mjs` 用真实大模型跑一次会话，验证"真实模型 → Pi runtime/CLI → session → JSONL 导出 → 完整增强字段"链路。

## 命令

```bash
node scripts/real-eval-runner.mjs --provider zhipu --model glm-5.2 --prompt "..."
```

- `--provider` / `--model`：覆盖默认配置（默认复用 `~/.pi/agent/models.json` 的 provider/model）。
- 输出：`harness-obs-output/real/exports/<runId>.jsonl` + `harness-obs-output/real/real-report.json`。
- 退出码：`0` PASS（文本/工具字段完整、无未脱敏 secret）、`1` FAIL、`3` 运行错误。

## 安全边界

- 命令行不接受 API Key（复用现有 Pi 配置/环境变量）。
- 真实 prompt、工具参数、模型响应与导出文件只落在本地忽略目录，不提交仓库、不进稳定 baseline。
- 真实结果有波动，仅作 smoke 验收证据，不作为确定性回归基准。

## 说明

TypeScript exporter/enricher 的真实数据源行为由单元测试覆盖（`enricher.test.ts`、`harness-event-exporter.test.ts`）；本脚本负责真实模型端。