# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
