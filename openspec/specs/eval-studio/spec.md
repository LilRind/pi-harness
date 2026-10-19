# eval-studio Specification

## Purpose
提供本地评测工作台，让使用者通过 Web 页面查看 suite、配置运行参数、触发确定性或真实 Pi 会话评测，并基于持久化历史比较多次运行的质量、效率与稳定性。

## Requirements

### Requirement: 本地评测工作台入口
系统 MUST 提供可在本地启动的 Web 评测工作台。工作台 MUST 提供 suite 查看、运行配置、执行、报告、历史和 trace 查看入口，并仅在本地访问，MUST NOT 要求上传 suite、JSONL 或报告到远端服务。

#### Scenario: 打开本地工作台
- **WHEN** 使用者启动本地评测工作台并打开其页面
- **THEN** 页面显示可用的 suite、运行配置区域、执行入口、报告区域、历史入口和 trace 查看入口

#### Scenario: 本地数据不出机器
- **WHEN** 使用者查看 suite、运行测试或打开历史报告
- **THEN** 相关文件只在本机读取和写入，工作台不将评测数据上传到远端服务

### Requirement: suite 展示与运行参数覆盖
工作台 MUST 展示文件定义的 suite 及其 fixture、断言和默认阈值。使用者 MUST 能在 UI 中编辑 provider、model、prompt、工具、阈值和重复次数等运行参数；这些运行覆盖值 MUST 随运行记录留痕，且普通执行 MUST NOT 自动改写 suite 源文件。

#### Scenario: 查看 suite 定义
- **WHEN** 使用者选择一个 suite
- **THEN** 工作台展示其 fixture、场景说明、断言类型和默认阈值

#### Scenario: 编辑运行覆盖参数
- **WHEN** 使用者修改 provider、model、prompt、工具、阈值或重复次数后执行
- **THEN** 本次运行使用覆盖值，并在运行记录中保存这些覆盖值

#### Scenario: 不改写 suite 源文件
- **WHEN** 使用者仅通过运行表单修改参数并执行
- **THEN** suite 源文件保持不变

### Requirement: suite 回归执行与实时状态
工作台 MUST 能触发 suite 回归执行，按 fixture 输出执行状态、事件流、通过/失败结果和断言失败原因。执行期间页面 MUST 展示当前运行进度；运行失败或被取消时 MUST 保留已产生的事件和部分结果。

#### Scenario: 执行完整 suite
- **WHEN** 使用者选择 suite 并点击执行
- **THEN** 页面逐项展示 fixture 执行状态、事件流、最终 PASS/FAIL 和失败断言原因

#### Scenario: 运行中途失败
- **WHEN** 某个 fixture 或底层会话执行失败
- **THEN** 页面展示错误信息，已完成的 fixture 结果和已产生的事件不被丢弃

#### Scenario: 取消执行
- **WHEN** 使用者在执行完成前点击取消
- **THEN** 工作台停止后续执行，记录取消状态，并保留已产生的部分结果

### Requirement: 真实 Pi 会话隔离执行
工作台执行真实 Pi Agent 会话时，MUST 为每次运行提供独立的 session 目录和临时工作目录，并应用固定工具白名单、超时和取消能力。MVP 的 bash 白名单 MUST 仅覆盖安全演示命令；工作台 MUST NOT 在命令行或 UI 中接受明文 API Key。

#### Scenario: 独立 session 与工作目录
- **WHEN** 工作台启动一次真实 Pi 会话
- **THEN** 该会话使用独立的 session 目录和临时工作目录，不复用其他测试运行的会话状态

#### Scenario: 应用工具白名单
- **WHEN** 真实会话请求工具
- **THEN** 仅固定白名单中的工具可被调用，白名单外工具被拒绝或不可见

#### Scenario: 超时或取消
- **WHEN** 真实会话超过配置超时时间或使用者点击取消
- **THEN** 执行被终止，运行记录标记超时或取消，并保留已产生的导出与报告数据

#### Scenario: 不接受明文密钥
- **WHEN** 使用者配置或启动真实会话
- **THEN** 工作台不接受明文 API Key，只复用本机已有 Pi 配置

### Requirement: 单次即时真实测试
工作台 MUST 支持单次即时测试配置，允许使用者输入一次 prompt、选择 provider/model 和工具限制并执行真实 Pi 会话，然后查看该次运行的事件、导出和指标。该能力 MUST 不依赖 suite 批量回归入口。

#### Scenario: 发起单次测试
- **WHEN** 使用者填写单次测试配置并执行
- **THEN** 工作台运行一次真实 Pi 会话并生成对应的运行记录、JSONL 和报告

#### Scenario: 查看单次测试结果
- **WHEN** 单次测试完成
- **THEN** 页面展示模型输出、工具调用、事件流、耗时、token 和错误状态

### Requirement: 运行报告与 trace 查看
每次运行结束后，工作台 MUST 展示结构化报告，包含整体结果、核心指标、每个 fixture 的结果、断言失败原因、工具调用和重复运行汇总。工作台 MUST 提供该次运行对应 JSONL/span 的查看入口，且该视图 MUST 能基于导出文件渲染事件结构。

#### Scenario: 查看运行报告
- **WHEN** 使用者打开一次完成的运行
- **THEN** 报告展示整体 PASS/FAIL、指标、fixture 明细、失败原因、工具调用和重复运行汇总

#### Scenario: 打开 trace 视图
- **WHEN** 使用者从报告进入 trace 视图
- **THEN** 页面基于该次运行的 JSONL 渲染事件、span 或时间线结构

### Requirement: 测试历史持久化与查询
工作台 MUST 持久化保存每次运行配置、状态、报告、指标、导出文件位置和关联 session 信息。历史 MUST 在工作台重启后仍可查询，并支持按 suite、时间、模式和状态过滤；MVP MUST NOT 要求提供删除功能。

#### Scenario: 重启后查询历史
- **WHEN** 工作台重启后进入历史页
- **THEN** 之前的运行记录和报告仍可查询和打开

#### Scenario: 过滤历史
- **WHEN** 使用者按 suite、时间、模式或状态过滤
- **THEN** 历史列表只显示匹配的运行记录

### Requirement: 任意两次运行对比
工作台 MUST 允许使用者从历史中选择任意两次运行进行对比，并以表格和图表直观展示指标差异。对比 MUST 覆盖通过率、token、耗时、工具失败率等核心指标，并标明每个指标的数值、单位和变化方向。

#### Scenario: 选择两次运行
- **WHEN** 使用者在历史中选择两个运行记录并请求对比
- **THEN** 页面展示两次运行的配置差异和核心指标对比

#### Scenario: 图表展示差异
- **WHEN** 对比结果渲染完成
- **THEN** 图表能直观显示指标变化方向和幅度，不要求使用者手工比较 JSON 文件

### Requirement: 重复运行稳定性展示
当同一 suite 配置被重复执行时，工作台 MUST 展示每次重复的个体结果，以及汇总值和波动范围。波动展示 MUST 覆盖通过率、token、耗时和工具失败率中可用的指标。

#### Scenario: 查看重复运行明细
- **WHEN** 一个配置执行多次
- **THEN** 报告列出每次重复的 PASS/FAIL 和关键指标

#### Scenario: 查看稳定性汇总
- **WHEN** 重复执行完成
- **THEN** 报告展示汇总值和波动范围，便于判断结果是否稳定

### Requirement: 本阶段明确不做
以下内容 MUST NOT 作为本 change 的 MVP 验收项：完整可视化用例编辑器、Electron 桌面端集成、完整工具安全策略、插件化、上下文管理、记忆系统和删除历史记录。A 阶段桌面端集成 MUST 作为后续规划保留。

#### Scenario: MVP 边界不被扩大
- **WHEN** 评审本 change
- **THEN** 上述内容不作为验收项，也不能阻塞本地 Web 工作台的 MVP 交付
