# Pi-Harness 二次开发 — 讨论沉淀（2026-10-10）

> 目标：2 周内基于 Pi 生态做二次开发，聚焦可观测（Observe），交付能展示给面试官的 Demo + 测试 + 口述稿。
> 主线决策尚未最终拍板，以下为已达成共识与三个候选切口。

## 已确认的背景与共识

1. **方向**：基于 pi / pi-harness 的构造做二次开发，不重造轮子；参考 pi-harness（主）、openclaw、Hermes；Claude Code 太黑盒，仅作反面参照。
2. **聚焦"可观测"**：不可观测 = 黑盒；先做 Observe（Runs/Trace/Replay/Diagnostics），其他三层（Control/Orchestrate/Work）不铺开。
3. **pi-harness 已有能力（核实源码）**：`src/main/harness/` 已有 run-registry（事件流 reducer）、trace-service（span + replay log）、compare-service（side-by-side diff）、evaluation-service（确定性评测）、regression-service（baseline 对比）。**这些是存量能力，不是我们的增量**，面试叙事必须区分。
4. **技术栈倾向**：Java / Spring Boot + Spring AI（简历主线）；但"在 fork 里做 TS 增量"工期更稳，未拍板。
5. **工作流**：grill-me（grilling 访谈）→ OpenSpec（propose/apply/verify/archive）；规则已写入 `AGENTS.md`。

## 三个候选增量切口（重点）

### 切口 1：标准导出层（首选主线）
- 把 HarnessEvent 流导出为 OTLP/JSONL 标准格式，接 Langfuse / Jaeger。
- 价值：pi-harness 观测数据是内部 JSON store，非标准 trace 协议；"标准化 vs 私有格式"是清晰面试叙事。
- 现状缺口：无标准导出，无法直接接 Langfuse。

### 切口 2：批量评测闭环
- 10-20 条评测集 + 改 prompt / 换模型自动回归 + 趋势报告，可进 CI。
- 价值：pi-harness 只有单次 run 的 evaluation/regression，没有产品化批量收口；正好覆盖"可观测 + 测试完整度 + 优化迭代"。
- 现状缺口：无批量 runner / 聚合指标 / 趋势输出。

### 切口 3：上下文 / 成本趋势
- 事件里已有 usage（input/output/cache/cost），但没按 session 累计的水位仪表。

## 待拍板决策（下一轮 grill）

- Q1 项目形态：fork 内加增量（A）/ 独立仓库 Java 自建（B）/ fork 内插件模块（C）
- Q2 技术栈：TS（A）/ Java（B）/ 混合（C）
- Q3 面试叙事主线：A / B / C
- Q4 验收物优先级：Demo > 口述稿 > 测试 > 差异对照表

## 下一步

1. 继续 grilling（从第 1 轮 Q1-Q4 开始，或按需重开）
2. 拍板后：openspec init → propose → 人工审阅 → .spec-frozen → apply/verify
3. 主线建议：先只做切口 1（标准导出层），一条一条来
