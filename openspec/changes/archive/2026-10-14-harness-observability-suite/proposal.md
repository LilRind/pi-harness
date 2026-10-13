# Proposal

## Why

pi-harness 的 Harness 事件流（HarnessEvent）是内部私有事件格式，只落在内部 JSON store，没有标准导出；评估/回归也停留在单次 run 的检查，缺少可重复、可比较、产物可被 CI 消费的产品化闭环。作为一个面向面试的可观测增量，我们补上“标准导出层 + 批量评测闭环”，把运行变成可观察、可比较、可复现的实验，叙事主线为“标准化 vs 私有格式 + 迭代优化收口”。

## What Changes

- 新增事件标准导出层：订阅 `HarnessRuntime.onEvent`，每个 run 一个 JSONL 文件（按 run.id 命名并 sanitize），run.started 时创建/打开，事件经 `redactSecrets` 脱敏后追加写，run.completed / failed / aborted 时 flush 并写入收尾元信息（运行级指标，不含通过率），进程退出时 flushAll。
- 新增最小 JSONL schema（含 schemaVersion）：字段分“事件原生字段”与“会话增强字段”（text / toolArgs，由 enricher 在写入前补充并脱敏）；断言与指标只依赖这些字段。
- 新增 OTLP span 映射纯函数：输入为该 run 的完整事件序列 `events[] → spans[]`，内部按事件顺序用状态机合并 start/completed，配单元测试；不接 OTLP 服务。
- 新增独立只读 JSONL 查看器：独立静态页面 / 独立 Vite 入口，浏览器本地解析拖拽文件，渲染 span 嵌套树、耗时、时间线、错误标记、脱敏参数预览和简单趋势图；与应用运行时解耦，不修改 HarnessRunDetailPanel，不新增存量面板 tab。
- 新增批量评测闭环：CLI runner（`node scripts/eval-runner.mjs --suite <name>`，与现有 scripts/*.mjs 惯例一致，零新运行时依赖）+ 10–15 条手工 fixture（由确定性模拟器生成完整 HarnessEvent 序列），从 JSONL 事件聚合通过率、token、耗时、工具失败率四件套指标，生成 JSON 报告 + Markdown 趋势，baseline 版本化对比，输出 regression / warning / improvement / same；退出码优先级 `3(运行错误) > 1(有失败) > 2(有回归) > 0(通过)`。
- 本周评测对象为“导出格式 + 聚合管线正确性”（确定性、可复现、可进 CI）；真实 LLM 输出作为附赠演示路径（exporter 捕获真实会话 JSONL 后丢进查看器），不进入验收。
- 明确不做：上下文/成本水位仪表（数据在 JSONL 中自然带上，趋势图仅附赠）、Langfuse/Jaeger 部署、存量面板改造、CI 流水线接入（产物可被 CI 消费）、回放录制 session 作为评测集、幻觉率、召回/精确率、规划冗余与 span 深度门禁、独立对照表（降级为口述稿差异段落）。

## Capabilities

### New Capabilities
- `standard-export`: 把 Harness 运行事件标准化导出为带 schemaVersion 的 JSONL 文件与 OTLP span 结构，覆盖事件捕获、enricher 增强、脱敏、文件生命周期与收尾元信息；每个 run 一个文件。OTLP 仅做纯函数映射与单测，不接服务。
- `eval-loop`: 批量评测闭环：确定性 fixture + 模拟器、runner、四件套指标聚合、版本化 baseline 对比、JSON + Markdown 趋势报告；产物可被 CI 消费，但本周不接 CI。

### Modified Capabilities

-（无：仅新增能力，不改动现有 spec 行为要求。）

## Impact

- 代码：`src/main/harness/` 新增 exporter + enricher 模块（挂在 `HarnessRuntime.onEvent`，harness-runtime.ts:269）；`scripts/` 新增 `eval-runner.mjs` 与 fixture 目录；新增独立 JSONL 查看器（独立路由 / 静态入口，不动 `HarnessRunDetailPanel`）。
- API：新增 JSONL 导出文件 schema（schemaVersion、事件原生字段 + text/toolArgs 增强字段）与 CLI 命令（`node scripts/eval-runner.mjs --suite <name>`）；不改动既有 IPC/服务接口。
- 依赖：运行时不新增第三方依赖（复用现有 `redactSecrets` / 事件模型）；runner 采用 `.mjs` 与现有 scripts/*.mjs 一致，不新增 devDependency；查看器保持纯前端。
- 数据：导出目录为新增持久化输出（如用户数据下 `harness-exports/`），不覆盖现有 JSON store；报告输出到 `reports/`，baseline 存 `baselines/`。
- 风险与缓解：run.id 特殊字符 -> sanitize；并发 run -> Map<runId, WriteStream>；进程退出 -> flushAll；脱敏遗漏 -> 写入前统一 redactSecrets（含 enricher 增强字段）；fixture 不稳定 -> 手工固定输入 + 确定性模拟器 + 明确断言；OTLP 无真实协议校验 -> 单测覆盖关键映射。