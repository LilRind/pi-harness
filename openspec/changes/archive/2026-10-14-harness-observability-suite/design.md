# Design

## Context

pi-harness 已有完整的运行时事件流（`HarnessEvent`）、`HarnessRuntime.onEvent` 顶层订阅点、`RunRegistry` 的 run 生命周期事件与 `redactSecrets` 脱敏管线。本次增量在其上补两个能力：标准导出层（`standard-export`）与批量评测闭环（`eval-loop`），见 `proposal.md - Why`。

导出层只读消费 `HarnessRuntime.onEvent` 广播的事件；评测层消费导出层产出的 JSONL 事件流，二者通过 JSONL schema 解耦，不互相依赖内部状态。

## Goals / Non-Goals

**Goals:**

- 把 `HarnessEvent` 按 run 导出为带 schemaVersion 的 JSONL 文件，经 enricher 补充增强字段并统一脱敏；提供 OTLP span 映射纯函数 + 单测。
- 提供批量评测 CLI：10–15 条确定性 fixture + 模拟器、四件套指标聚合、版本化 baseline 对比、JSON + Markdown 趋势报告。
- 提供独立只读 JSONL 查看器（独立静态页面 / 独立 Vite 入口，浏览器本地解析），作为“标准导出 → 任意前端可消费”的验证。
- 导出与评测产物均可被 CI 消费（本周不接入 CI 流水线本身）。

**Non-Goals:**

- 不接 OTLP 服务、不部署 Langfuse / Jaeger，只留映射纯函数与单测。
- 不改存量 `HarnessRunDetailPanel`、不新增存量面板 tab、不改运行数据 store。
- 不做上下文 / 成本水位仪表作为独立交付（数据在 JSONL 中自然带上，趋势图仅附赠）。
- 不做回放已录制 session、幻觉率、召回 / 精确率、规划冗余门禁、span 深度门禁、独立对照表。
- 本周评测对象为“导出格式 + 聚合管线正确性”，不做 LLM 能力评测；真实 LLM run 仅作为附赠演示路径，不进入验收。

## Decisions

**D1: 导出接入点选 `HarnessRuntime.onEvent`（而非 adapter 层）**
它是所有 adapter（Pi / MCP / 自定义）事件的统一分发点，导出与底层实现解耦，测试可直接注入假事件流。备选（`PiHarnessAdapter.subscribe`）会绑定单一实现、易漏事件、生命周期不一致，弃用。

**D2: JSONL 主线 + 每个 run 一个文件（而非 OTLP 推送 / 单大文件）**
面试可拿真实文件讲 schema 与脱敏；OTLP 推送引入网络 / 服务 / 端口负担。OTLP 只留纯函数 + 单测作“标准协议映射能力”证明。备选（单文件追加全量）不利于按 run 检索与演示，也增加并发写复杂度。

**D3: 内存缓冲 + run 终止 flush（而非逐条刷盘）**
`run.started` 建文件，事件经脱敏后入缓冲/流式追加，`completed / failed / aborted` 时 flush + 运行级收尾元信息 + 关闭句柄。并发 run 用 `Map<runId, WriteStream>` 管理；进程退出注册 `flushAll`。降低 IO；crash 时最多丢未 flush 的尾段（见风险 R1）。通过率只在 eval 聚合报告出现，单 run 收尾元信息只含运行级指标。

**D4: JSONL schema 固定为“事件原生字段 + 会话增强字段”**
schema 含 `schemaVersion`；导出层只保证事件原生字段完整，`text` / `toolArgs` 等增强字段由 enricher 在写入前补充并脱敏（来源受限时可为空但字段名稳定）。这样断言（输出包含 / 参数预览）与指标（token / 耗时 / 工具失败率）有可编程输入，且导出层仍可独立运行。备选（schema 只含原生字段）会让“输出包含指定串 / 脱敏参数预览”这类验收不可实现。

**D5: OTLP 映射是“序列纯函数”（`events[] → spans[]`）而非单事件映射**
`message.started/completed` 与 `tool.started/completed` 是配对事件，单事件拿不到结束时间、父子关系与合并属性；纯函数内部按事件顺序用局部状态机合并配对，无外部副作用、同输入同输出。备选（逐事件映射）数学上无法产出起止时间与 parentSpanId，弃用。

**D6: eval fixture 确定性生成（而非依赖真实运行）**
10–15 条手工 fixture 由模拟器生成完整 `HarnessEvent` 序列（含增强字段），runner 先落盘 JSONL 再聚合+断言，保证“确定性 + 无 app + 吃 JSONL”三者同时成立。真实 LLM 输出 run 作为附赠演示路径（exporter 捕获真实会话 JSONL 后由查看器消费），不进入验收。备选（回放录制 session / 真模型联调）破坏可复现性，作为后续增强。

**D7: runner 用 `.mjs` + 退出码优先级**
CLI 采用 `scripts/eval-runner.mjs`，与仓库现有 `scripts/*.mjs` 惯例一致，零新 devDependency；退出码 `3 运行错误 > 1 有失败 > 2 有 regression > 0 全部通过且无 regression`，避免“同时失败+回归”时语义歧义。备选（引入 tsx）增加依赖，备选（退出码无优先级）会造成 CI 判断不稳定。

**D8: baseline 阈值写死并独立于存量 RegressionService**
eval-loop 的 suite 级阈值写进 spec：通过率下降 ≥5% 判 `regression`、≥2% 判 `warning`；token 上升 ≥10% 判 `regression`、≥5% 判 `warning`；耗时同通过率量级；容差内判 `same`。语义对齐存量“百分比 + warning 中间态”，但数字针对 suite 聚合场景，不复用单 run 常量（存量 `RegressionService` 是 WARNING=25% / REGRESSION=50% 等）。

**D9: 查看器独立入口（而非存量面板加 tab）**
拖拽 JSONL 本地解析，零后端，不依赖 IPC / 登录 / 全局 store；独立静态页面 / 独立 Vite 入口，未启动 app 的浏览器也能打开。备选（改 `HarnessRunDetailPanel`）依赖运行时内存、叙事变弱、容易滑向“跟自带面板比没差别”。

**D10: 一个 OpenSpec change，拆两个 spec 文件**
`standard-export` 与 `eval-loop` 同属一个可观测闭环，一次 propose / verify，`.spec-frozen` 门禁一次冻结，避免两条 apply 路径并行；两份 spec 验收项分开列，边界清晰。

## Risks / Trade-offs

- **[进程崩溃丢缓冲尾段]** → 导出文件标记“未完整”，收尾元信息缺失可被检测；进程退出钩子执行 `flushAll` 降低概率。
- **[大 run 产生大量事件行]** → 单 run 文件按需截断 / 设上限（参考 `TraceService` 的 `maxEventsPerRun` 语义）；完整性由收尾元信息标记。查看器大文件可流式解析或分片加载。
- **[enricher 依赖 session/run 数据，来源受限时增强字段为空]** → schema 声明字段可空，断言按“有值时校验”处理；enricher 只在 app 内存在，CLI/查看器消费完整 schema。
- **[OTLP 映射无真实协议校验]** → 用单测覆盖关键事件映射与边界；真实推送留 out-of-scope。
- **[fixture 覆盖有限，容易“为过而过”]** → 断言明确（输出包含 / 工具调用 / token 上限 / 耗时上限 / 无未脱敏 secret），并纳入失败用例展示，报告列出失败断言。
- **[查看器纯前端，无法访问主进程数据]** → 这正是设计意图：只消费导出文件，避开权限与耦合，同时验证导出格式通用性。
- **[run.id 含特殊字符或并发写]** → 文件名 sanitize + `Map<runId, WriteStream>`；进程退出 flushAll。