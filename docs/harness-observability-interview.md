# 面试口述稿：基于 pi-harness 的可观测增量

## 一句话主线

我基于 pi-harness 的事件驱动架构，补上它缺的两层：标准导出与批量评测闭环，把一次 Agent 运行变成可观察、可比较、可复现的实验。

## 与存量能力的差异

- 存量（照抄会被追问）：`trace-service`（span + replay 事件）、`replay-service`、`evaluation-service`、`regression-service` 都是 pi-harness 已实现的能力。
- 本增量（我们的价值）：
  1. 标准导出层：`HarnessRuntime.onEvent` 订阅 + JSONL schema（含脱敏 enricher）+ OTLP 映射纯函数。
  2. 批量评测闭环：确定性 fixture + CLI runner + 四件套指标 + 版本化 baseline + 报告/趋势。
  3. 独立 JSONL 查看器：证明导出格式可被任意前端消费。

## 关键设计与为什么

1. 导出挂在 `HarnessRuntime.onEvent`：这是所有 adapter（Pi / MCP / 自定义）的统一广播点，抽出来就是跨实现的可观测性。
2. "标准化 vs 私有格式"：pi-harness 观测数据是内部 JSON store，我们用带 schemaVersion 的 JSONL 解耦导出与消费；OTLP 只做纯函数映射，不接服务，作为协议映射能力的证明。
3. 评测确定性优先：本周评测对象是"导出格式 + 聚合管线的正确性"，不是 LLM 能力；真实模型 run 通过导出层天然记录，可作演示路径但不进验收。
4. 指标四件套：通过率、token、耗时、工具失败率；baseline 显式更新、版本化留痕，避免"为过而过"。

## 边界（out-of-scope）

OTLP 服务 / Langfuse / Jaeger 部署、CI 接入、存量面板改造、上下文成本水位仪表、回放 session 作评测集、幻觉率 / 召回 / 精确率、规划冗余与 span 深度门禁、独立对照表。
