# Tasks

## 1. 标准导出层（standard-export）

- [x] 1.1 定义 JSONL schema（`schemaVersion`、事件原生字段 + `text`/`toolArgs` 增强字段、运行级收尾元信息），在 `src/main/harness/export/` 新增类型定义；验证：单测覆盖 schema 序列化、版本号递增与收尾元信息结构（不含通过率）
- [x] 1.2 实现 exporter：订阅 `HarnessRuntime.onEvent`，`run.started` 建文件入缓冲，事件追加内存缓冲，`completed/failed/aborted` flush + 运行级收尾元信息 + 关闭句柄；验证：注入假事件流断言 `${runId}.jsonl` 内容完整且按终止状态落盘
- [x] 1.3 实现 enricher：从 session/run 数据补充 `text`/`toolArgs`（来源受限时可为空），写入前统一 `redactSecrets` 脱敏；验证：单测断言增强字段补充正确、敏感字段被掩码、磁盘无明文
- [x] 1.4 实现 OTLP span 映射纯函数：输入完整脱敏事件序列 `events[] → spans[]`，内部状态机合并 `message/tool/compaction` 配对，输出 `traceId/spanId/parentSpanId/起止时间/状态/属性`；验证：单测覆盖关键事件、未配对事件与边界情况
- [x] 1.5 并发与生命周期管理：`Map<runId, WriteStream>` 管理并发 run；文件名基于 `run.id` 并 sanitize；注册进程退出钩子执行 `flushAll`；验证：单测模拟多 run 并发与进程退出，断言各文件独立、无覆盖、缓冲不丢
- [x] 1.6 接入点装配：在 harness runtime 构造处挂载 exporter（默认启用，目录可配置），导出目录为新增持久化输出（如用户数据下 `harness-exports/`），不覆盖现有 JSON store；验证：`pnpm test` 相关单测通过；手动运行一次产生导出文件

## 2. 批量评测闭环（eval-loop）

- [x] 2.1 定义 fixture 结构与 10–15 条样例集：覆盖简单问答、多轮对话、工具调用成功、工具调用失败、工具重试、长上下文、空输入、非法输入、超时、模型返回错误、用户中止与敏感信息脱敏验证；每条含唯一 ID 与明确断言（输出包含、工具调用、工具失败次数上限、token 上限、耗时上限、无未脱敏 secret）；验证：fixture 校验脚本断言条数在 10–15 区间且所需场景均存在
- [x] 2.2 实现确定性模拟器：为每条 fixture 生成完整 `HarnessEvent` 序列（含 `text`/`toolArgs` 增强字段）并落盘 JSONL；验证：同一 fixture 重复运行输出一致，不依赖模型/网络/app
- [x] 2.3 实现指标聚合：从 JSONL 事件流计算通过率、token 总量、耗时、工具失败率四件套；报告中注明每项指标计算口径；验证：单测用构造 JSONL 断言聚合结果正确，且仅凭 JSONL 即可计算
- [x] 2.4 实现 baseline 版本化存储与对比：`baselines/<suite>.json`，显式更新（记录更新原因、指标变化、预期改进/接受退化说明），按写死阈值输出 `regression/warning/improvement/same`（通过率 -5%/-2%、token +10%/+5%、耗时同量级、容差内 same）；验证：单测覆盖首次设置、普通运行不自动覆盖、更新原因落库与判定阈值
- [x] 2.5 实现 CLI runner（`scripts/eval-runner.mjs`，与现有 scripts/*.mjs 一致，零新依赖）：非交互执行 suite，输出 `reports/<suite>-<date>.json`、`reports/<suite>-<date>.md` 并更新 `<suite>-latest.json`；退出码优先级 `3 运行错误 > 1 有失败 > 2 有 regression > 0 通过`；不依赖 app 启动/IPC/前端状态；验证：命令行实跑一条 fixture suite，产出两种报告且退出码符合预期
- [x] 2.6 文档：在 README 或 docs 说明 runner 命令、报告路径、baseline 路径、退出码语义、JSONL schema 版本与产物可被 CI 消费（本周不接 CI）；验证：按文档命令可复现运行并得到预期产物

## 3. 独立 JSONL 查看器

- [x] 3.1 前端新增独立页面：本地拖拽/选择 JSONL 文件、纯前端解析，渲染 span 嵌套树、每 span 耗时、事件时间线、错误标记、脱敏后参数预览与简单趋势图；趋势图仅附赠，不作为独立验收项；验证：加载示例 JSONL 后各视图渲染且有数据，无后端依赖
- [x] 3.2 提供独立入口（独立路由 / 独立 Vite 静态入口），未启动 app 的浏览器可独立打开，不修改 `HarnessRunDetailPanel`，不新增存量面板 tab；验证：在未启动 app 的环境可独立打开查看器并加载示例文件；存量面板未被改动

## 4. 集成与验收

- [x] 4.1 端到端演示脚本/说明：从运行产生事件 → 导出 JSONL → 查看器加载 → 跑一遍 eval suite 出报告 → 展示 baseline 对比判定；真实 LLM run 作为附赠演示路径（exporter 捕获真实会话 JSONL 后由查看器消费，不进验收）；验证：按说明完整演示一次，产物齐全（JSONL、JSON 报告、Markdown 趋势、baseline 对比）
- [x] 4.2 编写面试口述稿：包含与 pi-harness 存量能力的差异对照（trace / replay / evaluation / regression 是存量，标准导出与批量闭环是增量），以及本周 out-of-scope 说明（OTLP 部署、CI 接入、存量面板改造、上下文/成本水位仪表、回放 session、幻觉率、召回/精确率、规划冗余与 span 深度门禁、独立对照表、真实 LLM 能力评测）；验证：口述稿成文且差异段落前后一致
- [x] 4.3 确认 out-of-scope 清单已写入 spec，且未被当作验收项；验证：对照 `standard-export` 与 `eval-loop` 的 spec，确认 out-of-scope 段落完整

## Workflow follow-up

- [ ] 人工审阅 + 手创 `.spec-frozen` 后执行 apply
  - 若使用 Codex 且 `/opsx:*` 不可用，改用 `$openspec-apply-change` 技能
- [ ] 校验 verify（前置：`openspec config profile` 选 expanded profile）
  - 若使用 Codex，改用 `$openspec-verify` 或对应技能
- [ ] PR 合并回 main 后执行 archive `harness-observability-suite`
  - 若使用 Codex，改用 `$openspec-archive` 或对应技能