# eval-loop Specification

## Purpose
提供批量评测闭环能力：由确定性模拟器为每条 fixture 生成完整 `HarnessEvent` 序列并产出 JSONL，CLI runner 从 JSONL 聚合通过率、token、耗时与工具失败率四件套指标，与版本化 baseline 对比并输出 JSON 报告与 Markdown 趋势，产物可被 CI 消费（本周不接入 CI 流水线本身）。本周评测对象是导出格式与聚合管线的正确性，不是 LLM 能力。

本能力消费 `standard-export` 产出的 JSONL 事件流（含增强字段），不直接依赖 `HarnessRuntime` 内部状态。

## Requirements

### Requirement: 评测集由确定性 fixture 组成

系统 MUST 提供 10–15 条手工评测用例（fixture），覆盖简单问答、多轮对话、工具调用成功、工具调用失败、工具重试、长上下文、空输入、非法输入、超时、模型返回错误、用户中止与敏感信息脱敏验证场景。

每条 fixture MUST 声明可判定的通过条件，断言类型至少包括：输出包含指定串、工具被调用或未被调用、工具失败次数上限、token 上限、耗时上限、无未脱敏 secret。

fixture 输入 MUST 是确定性的：由模拟器生成完整 `HarnessEvent` 序列（含 `text` / `toolArgs` 增强字段），不依赖真实模型、网络或外部服务，以保证演示与回归可复现。真实 LLM 能力评测本周纳入验收（smoke 路径），但只作为补充证据，不作为确定性回归基线。

#### Scenario: fixture 覆盖代表性场景
- **WHEN** 查看评测集定义
- **THEN** fixture 覆盖上述代表性场景，且每条都有明确的通过/失败断言

#### Scenario: fixture 可判定通过或失败
- **WHEN** 一条 fixture 运行结束
- **THEN** 系统能依据该 fixture 声明的断言，确定性地判定通过或失败，不依赖人工判断

#### Scenario: fixture 输入确定性
- **WHEN** 同一 fixture 在同一 suite 下重复运行
- **THEN** 输入保持不变，不依赖真实模型、网络或外部服务

#### Scenario: 评测对象为导出与聚合管线
- **WHEN** 评审本周交付
- **THEN** 验收聚焦导出格式正确性与聚合/断言管线正确性；真实 LLM 能力表现通过 smoke 路径补充验证，不作为稳定回归基准

### Requirement: 四件套指标从 JSONL 事件流聚合

系统 MUST 从 `standard-export` 产出的 JSONL 事件流聚合以下核心指标：

- **通过率**：通过 fixture 数 / 总 fixture 数；
- **token 总量**：所有 run 的 token 之和；
- **耗时**：所有 run 的耗时之和（或平均值，需在报告中注明口径）；
- **工具失败率**：失败的 `tool.completed` 事件数 / `tool.completed` 事件总数。

系统 MUST 额外聚合以下扩展指标：断言失败原因、首事件延迟、工具执行耗时、工具错误数、事件完整性、重复运行波动，以及 provider 数据可用时的成本和事件映射可支持时的模型响应耗时。扩展指标 MUST 从 JSONL 或运行报告可追溯数据中计算；来源不可用时字段 MUST 保持稳定并为空，MUST NOT 使用估算值冒充真实值。

#### Scenario: 从 JSONL 计算四件套
- **WHEN** 评测运行结束，相关 run 的 JSONL 文件已落盘
- **THEN** 系统能仅凭这些 JSONL 文件计算出四件套指标，结果与运行期直接统计一致

#### Scenario: 指标口径在报告中注明
- **WHEN** 报告输出四件套指标
- **THEN** 每项指标注明计算口径（求和 / 平均、分母定义、单位）

#### Scenario: 聚合扩展指标
- **WHEN** 一次评测运行完成
- **THEN** 报告包含断言失败原因、首事件延迟、工具执行耗时、工具错误数、事件完整性和重复运行波动

#### Scenario: 工具错误口径一致
- **WHEN** 报告统计工具错误数
- **THEN** 该值等于 `tool.completed` 且 `isError: true` 的事件数量

#### Scenario: 数据来源不可用
- **WHEN** provider 未返回成本或事件映射无法支持模型响应耗时
- **THEN** 对应字段为稳定空值，报告不生成估算值

### Requirement: CLI runner 批量执行并输出报告

系统 MUST 提供独立 CLI：

```bash
node scripts/eval-runner.mjs --suite <name>
```

CLI MUST：

- 以非交互方式运行，不弹出交互提示；
- 按 suite 加载 fixture，由确定性模拟器生成事件序列并落盘 JSONL；
- 输出 JSON 报告到 `reports/<suite>-<date>.json`；
- 输出 Markdown 趋势到 `reports/<suite>-<date>.md`；
- 同时输出 `reports/<suite>-latest.json` 供后续消费；
- 退出码优先级明确：`3` 运行错误 > `1` 存在 fixture 失败 > `2` 存在 regression > `0` 全部通过且无 regression；
- 不依赖 app 启动、IPC 或前端状态。

#### Scenario: 运行评测集产出报告
- **WHEN** 执行 `node scripts/eval-runner.mjs --suite <name>`
- **THEN** 在 `reports/` 下生成 JSON 报告与 Markdown 趋势文件，包含每条用例结果与四件套聚合指标，并更新 `<suite>-latest.json`

#### Scenario: 失败用例被列出
- **WHEN** 某条 fixture 未通过
- **THEN** 报告列出该用例、失败断言与相关指标，整体通过率相应更新

#### Scenario: 退出码反映结果
- **WHEN** CLI 运行结束
- **THEN** 退出码为 `0/1/2/3`，且按优先级 `3 > 1 > 2 > 0` 判定（同时存在失败与 regression 时返回 `1`，运行错误最高优先）

#### Scenario: 非交互运行
- **WHEN** 在非交互环境运行 CLI
- **THEN** 不弹出交互提示，所有参数由命令行传入

#### Scenario: 不依赖 app 启动
- **WHEN** CLI 在未启动 app 的环境运行
- **THEN** 能正常完成评测并输出报告

### Requirement: baseline 版本化对比

系统 MUST 支持版本化 baseline，存放于 `baselines/<suite>.json`。每次更新 baseline MUST 记录更新原因、指标变化与预期改进或接受退化的说明。更新 baseline MUST 是显式动作，不得由普通运行自动覆盖。

baseline 采样次数 MUST 可配置。确定性 suite MAY 使用 1 次采样；真实 LLM suite MUST 支持多次采样，默认建议 3 次，并允许配置 5、10 或其他次数。baseline MUST 保存每次采样结果、聚合值和波动范围；后续对比 MUST 引用 baseline 版本、采样次数与更新说明。

判定阈值 MUST 写死并在报告中注明：

- 通过率下降 ≥5% 判 `regression`，下降 ≥2% 但 <5% 判 `warning`；
- token 上升 ≥10% 判 `regression`，上升 ≥5% 但 <10% 判 `warning`；
- 耗时变化参照通过率同量级阈值（上升 ≥5% 判 `regression`，≥2% 判 `warning`）；
- 变化在容差内（±<2% 或 ±<5% token）判 `same`；
- 明显变好判 `improvement`。

#### Scenario: 对比 baseline 输出判定
- **WHEN** 本次运行指标与已保存 baseline 对比
- **THEN** 报告按上述阈值给出 `regression / warning / improvement / same` 判定，并引用 baseline 版本与更新说明

#### Scenario: baseline 不被自动覆盖
- **WHEN** 执行一次普通评测运行
- **THEN** 现有 baseline 保持不变；更新 baseline 需要显式命令或人工确认

#### Scenario: baseline 更新留痕
- **WHEN** baseline 被更新
- **THEN** 记录更新原因、指标变化与预期改进或接受退化说明

#### Scenario: 配置真实 LLM baseline 采样次数
- **WHEN** 使用者为真实 LLM suite 创建 baseline
- **THEN** 采样次数可配置，默认建议 3 次，且可设置为 5、10 或其他次数

#### Scenario: baseline 记录波动
- **WHEN** 多次采样完成并写入 baseline
- **THEN** baseline 保存每次采样结果、聚合值和波动范围

## ADDED Requirements

### Requirement: 产物可被 CI 消费

系统 MUST 使 CLI 产物结构化且可被 CI 消费：非交互、退出码语义明确、报告文件路径稳定。本周 MUST NOT 接入 CI 流水线本身；后续接入 SHOULD 只需一条命令，不需要重构。

#### Scenario: 非交互运行并返回状态
- **WHEN** 在非交互环境运行 runner
- **THEN** 不弹出交互提示，产物落盘，且存在回归时返回非零退出码

#### Scenario: 后续 CI 一行接入
- **WHEN** 未来在 CI 中接入评测
- **THEN** 只需执行 `node scripts/eval-runner.mjs --suite <name>` 并依据退出码判断，不需要改动 CLI

### Requirement: 本周明确不做

以下内容本周 MUST NOT 作为验收项：

- CI 流水线接入本身；
- 回放已录制 session 作为评测集；
- 幻觉率自动判定；
- 召回 / 精确率；
- 规划步骤冗余度门禁；
- 子 Span 嵌套深度门禁；
- 上下文 / 成本水位仪表（数据可在 JSONL 中自然带上，趋势图仅附赠）；
- 独立对照表（降级为口述稿差异段落）。

真实 LLM 输出 run 本周参与验收（smoke 路径）：通过 `--real` 真实模型命令完成一次真实 session 联调，导出真实 JSONL 并断言增强字段完整且脱敏；真实 LLM 结果有波动，不进入稳定 baseline，不作为确定性回归基准。

#### Scenario: out-of-scope 不被当作验收项
- **WHEN** 评审本周交付
- **THEN** 上述 out-of-scope 内容不作为验收项

#### Scenario: 真实 LLM smoke 参与验收
- **WHEN** 执行 `--real` 真实模型命令
- **THEN** 完成一次真实 session 联调，真实 JSONL 中 `text` / `toolArgs` 完整且脱敏；该结果作为 smoke 验收，不写入稳定 baseline

### Requirement: 真实模型联调命令

系统 MUST 提供 `--real` 真实模型联调入口（独立 `scripts/real-eval-runner.mjs`）：复用当前 Pi 配置的 provider/model 跑一次真实 session，走真实 HarnessEvent → exporter → JSONL 链路。命令行 MUST 不接受 API Key；允许 `--provider` / `--model` 覆盖配置；真实运行结果 MUST 输出到本地忽略目录，MUST NOT 提交仓库。

#### Scenario: 执行真实模型 smoke
- **WHEN** 执行 `node scripts/real-eval-runner.mjs`
- **THEN** 一次真实 session 完成，导出一份含完整 `text`/`toolArgs` 且脱敏的 JSONL，并输出联调报告

#### Scenario: 不传 API Key
- **WHEN** 执行 `--real` 命令
- **THEN** 命令行不接受明文 API Key；只复用现有 Pi 配置或环境变量

#### Scenario: 真实结果不进 baseline
- **WHEN** 真实模型 smoke 运行结束
- **THEN** 结果写入联调报告/导出文件，但不覆盖或写入稳定 baseline

### Requirement: 重复运行稳定性聚合
系统 MUST 支持按配置重复执行同一 suite 配置，并输出每次重复的个体结果、核心指标、聚合值和波动范围。重复次数 MUST 可配置，默认为 1；演示或真实 LLM 采样可使用更高次数。

#### Scenario: 配置重复执行
- **WHEN** 使用者将重复次数设置为大于 1 的整数
- **THEN** 系统按该次数执行同一 suite 配置

#### Scenario: 输出稳定性结果
- **WHEN** 重复执行完成
- **THEN** 报告列出每次重复的结果，并汇总通过率、token、耗时和工具失败率的波动范围

### Requirement: 确定性断言与 LLM-as-judge 分离
评测结论 MUST 分为确定性程序断言和显式标记的 LLM-as-judge 评估。确定性断言 MUST 覆盖文本包含、工具是否调用、工具次数、token、耗时、错误和脱敏等可程序判定条件，并可作为 baseline 依据。LLM-as-judge MUST 作为附加报告维度展示，MVP MUST NOT 将其混入确定性 PASS/FAIL 或 baseline 判定。

#### Scenario: 确定性断言进入主结论
- **WHEN** 程序断言全部执行完成
- **THEN** 主 PASS/FAIL 与 baseline 对比仅由确定性断言和核心指标决定

#### Scenario: LLM-as-judge 单独展示
- **WHEN** 配置了 LLM-as-judge 评估
- **THEN** 报告显式标记该结果，不将其计入确定性通过率或 baseline 判定

### Requirement: 真实 Pi 会话评测
评测循环 MUST 支持以 pi-harness 中的真实 Pi Agent 会话作为评测对象，消费真实事件、工具调用、session 数据和标准 JSONL 导出。通用 LLM API 调用 MAY 作为 provider 冒烟路径，但 MUST NOT 被表述为 Agent 会话评测。

#### Scenario: 执行真实 Pi 会话评测
- **WHEN** 使用者选择真实 Pi 会话评测模式
- **THEN** 系统基于真实 Agent 会话生成事件、导出 JSONL 并计算报告指标

#### Scenario: 区分通用 API 冒烟
- **WHEN** 使用者执行仅调用 LLM API 的冒烟路径
- **THEN** 报告标记其为 provider/model 冒烟，不将其计为 Agent 会话评测结果
