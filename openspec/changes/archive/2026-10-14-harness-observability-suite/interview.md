# grill-me 访谈摘要 — harness-observability-suite

> 日期：2026-10-13；工具链：grill-me（多轮）→ OpenSpec propose/apply/verify/archive
> 目标：在 pi-harness fork 内做 TS 增量，聚焦可观测（Observe），一周内交付能演示给面试官的 Demo + 口述稿。

## 已拍板决策（Q1-Q11）

1. **项目形态（Q1）**：在 pi-harness fork 内做 TS 增量，作为个人独立项目合入本人仓库（大概率不合入原作者仓库）。数据源、事件模型、既有 UI 全部现成。
2. **技术栈（Q2）**：TypeScript（沿用 fork；OTel/JSONL 生态成熟）。
3. **面试叙事主线（Q3）**：A — "我基于 pi-harness 的事件驱动架构，补上它缺的标准导出与批量评测闭环"，重点讲切口 1 + 切口 2。
4. **验收物（Q4）**：Demo（能实跑的事件导出 + 调用链/趋势图）+ 口述稿（含与 pi-harness 存量的差异对照）；测试尽量覆盖、降级为关键路径单测且保证有效；对照表可初稿或暂时搁置。
5. **输出格式与落盘（Q5）**：JSONL 主线 + 每 run 一个独立文件；OTLP span 映射做成纯函数 + 单测（不接 OTLP 服务）；复用 `redactSecrets` 保证"导出但不过敏"。
6. **导出触发与接入点（Q6）**：exporter 挂 `HarnessRuntime.onEvent`（顶层运行时，跨 adapter 全局捕获）；run 启动按 `run.id` 创建文件；事件实时追加到内存缓冲区（不逐条刷盘）；run 终止（completed/failed/aborted）时 flush、写入收尾元信息（总耗时/状态/最终结果）、关闭文件句柄标记完整可用。
7. **前端调用链形态（Q7）**：独立只读 JSONL 查看器（浏览器本地解析拖拽文件，无后端服务）：span 嵌套树、每 span 耗时、事件时间线、错误标记、脱敏后参数预览、简单趋势图。不动存量 `HarnessRunDetailPanel`，避免同质化。
8. **评测集来源与指标（Q8）**：手工 fixture 10-20 条（覆盖：简单问答、多轮对话、工具成功、工具失败、工具重试、长上下文、空输入、非法输入、超时、模型返回错误、用户中止、敏感信息脱敏验证）；每条有明确断言（输出包含/工具是否调用/token 上限/耗时上限/无未脱敏 secret）；指标四件套 = 通过率 + token 总量 + 耗时 + 工具失败率；baseline 版本化（记录更新原因、指标变化、预期改进或接受退化）。
9. **批量 runner 形态（Q9）**：独立 CLI（`node scripts/... --suite <name>`，输出 JSON 报告 + Markdown 趋势）；不做 IPC/前端面板；CI 本周不接，但验收标准写明"命令产物可被 CI 消费"，CI 为 out-of-scope。
10. **一周范围裁剪（Q10）**：切口 3（上下文/成本趋势）整体砍掉（数据天然带在 JSONL 里，趋势图顺手画，不当独立验收项）；Langfuse/Jaeger 部署砍掉（只留 OTLP 映射单测）；前端只做 JSONL 查看器；对照表降级为口述稿差异段落。
11. **OpenSpec change 拆法（Q11）**：一个 change `harness-observability-suite`，拆两个 spec 文件（`standard-export` / `eval-loop`），一次 propose/verify，`.spec-frozen` 一次冻结，一条 apply 路径。

## 已核实源码事实（作为 spec 的约束）

- `HarnessRuntime.onEvent(listener)` 是顶层事件订阅点（harness-runtime.ts:269），所有 adapter 事件统一从这里分发。
- `RunRegistry` 有 `run.started / run.completed / run.failed / run.aborted` 事件，可作为导出文件的帧边界（runs/run-registry.ts:32-35）。
- `HarnessEvent` 是私有扁平事件流：`runtime.started/message.started/message.completed/tool.started/tool.completed/compaction.*/checkpoint.created/recovery.*/evaluation.*` 等；`message.completed` 携带权威 usage/cost（harness-events.ts:74）。
- 现有导出只有 `RunExportService` 的 JSON/Markdown 保存对话框与脱敏 debug bundle（export/run-export-service.ts:45），无后台 sink、无 OTLP。
- `TraceService` 已把事件 reduce 成 span + replay events（trace-service.ts:102-218），可作为导出 schema 的参考，但本 change 的导出从原始 `HarnessEvent` 出发。
- `EvaluationService` 是 per-run 确定性流水线；`RegressionService` 有 baseline 对比与阈值分级（regression/warning/improvement）；`scripts/` 无批量 runner。
- package.json 无 OTLP/Langfuse/Jaeger 依赖。

## 后续流程

1. propose：读取本文件生成 proposal.md / specs/（standard-export、eval-loop）/ design.md / tasks.md
2. 人工审阅 spec → 用户手动创建 `.spec-frozen` 空标记文件 → 才允许编码
3. 执行：默认 `/opsx:apply`；细粒度 TDD 需用户提出才切换 superpowers 路径
4. 校验：`/opsx:verify`（前置：`openspec config profile` 选 expanded profile）
5. 归档：PR 合并回 main 后 `/opsx:archive harness-observability-suite`