# Harness Observability Suite

在 pi-harness fork 中新增的两个可观测能力：标准导出层（`standard-export`）与批量评测闭环（`eval-loop`）。本页是命令与产物说明。

## 标准导出层

- 位置：`src/main/harness/export/`（`HarnessEventExporter` 挂在 `HarnessRuntime.onEvent`）。
- JSONL schema 版本：`JSONL_SCHEMA_VERSION = 1`。每行 `{ schemaVersion, sessionId, event, enriched? }`，其中 `enriched.text` / `enriched.toolArgs` 由 enricher 补入并在写入前经 `redactSecrets` 脱敏。
- 每 run 一个文件：`harness-obs-output/exports/<sanitized-run-id>.jsonl`，含事件行与一行 `{ schemaVersion, footer }` 收尾元信息（运行级指标，不含通过率）。
- 进程退出钩子执行 `flushAll`；并发 run 用 `Map<runId, ...>` 隔离。

## 批量评测（CLI）

```bash
node scripts/eval-runner.mjs --suite sample
node scripts/eval-runner.mjs --suite sample --update-baseline --reason "rebaseline after prompt v2"
```

- fixture：`scripts/fixtures/<suite>.mjs`（默认 `sample`，12 条确定性场景，含断言）。
- 产物：
  - 报告 JSON：`harness-obs-output/reports/<suite>-<date>.json`
  - 趋势 Markdown：`harness-obs-output/reports/<suite>-<date>.md`
  - 最新快照：`harness-obs-output/reports/<suite>-latest.json`
  - baseline：`harness-obs-output/baselines/<suite>.json`（显式 `--update-baseline` 才会更新，并记录原因）
- 指标四件套：通过率、token 总量、耗时、工具失败率（见报告口径）。
- 退出码优先级：`3` 运行错误 > `1` fixture 失败 > `2` 有 regression > `0` 全部通过且无 regression。
- CI 语义：非交互、产物结构化、退出码可判，本周不接 CI。

## 查看器

`viewer/index.html` — 纯静态、无后端，浏览器打开后拖入导出的 `.jsonl` 即可查看 span 树 / 时间线 / 错误标记 / 脱敏参数预览与趋势图。
