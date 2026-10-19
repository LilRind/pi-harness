# Spec Delta

## MODIFIED Requirements

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
