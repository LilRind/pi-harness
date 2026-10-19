# Pi Harness Eval Studio

Eval Studio 是本地 Web 测试工作台，用于把 suite 回归、真实 Pi 会话、历史记录、任意两次运行对比和 trace 查看放在同一个界面中。

## 启动

```powershell
cd C:\Users\13374\IdeaProjects\Learning\pi-harness
pnpm eval-studio
```

该命令会先构建 UI 和本地服务，然后只在 `127.0.0.1` 启动服务。默认输出类似：

```text
Pi Harness Eval Studio: http://127.0.0.1:4621/?token=<random-token>
```

必须使用控制台输出的完整 URL 打开页面；`<random-token>` 是本次启动的 API token。静态页面可以打开，但所有 API 和 SSE 事件流都要求 token。

如只需要构建：

```powershell
pnpm eval-studio:build
```

## Suite 回归

1. 打开工作台后进入 **Suite**。
2. 选择 `sample`，查看 12 条 fixture、场景和断言。
3. 进入 **运行**。
4. 模式选择 `确定性 suite`。
5. 按需覆盖 provider、model、prompt、工具、阈值、重复次数和超时。
6. 点击 **创建运行**，再点击 **启动运行**。
7. 在运行页查看实时事件；完成后进入 **报告**。

参数覆盖只写入本次 run record，不会改写 `scripts/fixtures/sample.mjs`。

## 真实 Pi 会话

模式选择：

- `真实 Pi suite`：按 suite 配置执行真实会话；
- `单次即时真实测试`：不需要选择 suite，直接执行一次真实会话。

真实会话安全边界：

- 只绑定本机 `127.0.0.1`；
- 不接受明文 API Key，只复用本机 Pi 配置；
- 每次 repeat 使用独立 session 目录和临时工作目录；
- MVP 工具白名单只有 `bash`；
- bash 安全命令只允许 `echo ok` 演示命令；
- 超时会终止进程树，页面可取消运行。

真实会话会生成：

- 标准导出 JSONL；
- 运行报告；
- 历史 run record；
- session / work / exports / events 本地产物。

这些内容位于 `harness-obs-output/studio/`，不得提交仓库。

## 历史与对比

进入 **历史** 后可按 suite、模式、状态和时间范围过滤。每条历史显示：

- run id 与状态；
- suite 与模式；
- provider / model；
- 重复次数。

选择任意两条历史记录后进入 **对比**，页面显示：

- 配置差异；
- 通过率；
- token；
- 耗时；
- 工具失败率；
- 数值、单位、绝对变化和变化方向。

服务重启后历史仍在本地 JSON store 中，可重新查询并打开报告与 trace。

## Trace

从历史点击 **Trace**，或完成运行后进入 **Trace** 页。工作台会读取该 run 的导出 JSONL，并显示：

- 摘要；
- 事件树；
- 时间线；
- 错误标记；
- 原始 JSONL。

## Baseline

真实 LLM run 完成后可创建 baseline。推荐使用 3 次重复采样，也可以配置 5、10 或其他次数。baseline 保存：

- 每次个体指标；
- 聚合值；
- 最小值 / 最大值；
- 离散度；
- 版本、原因和更新时间。

baseline 文件位于：

```text
harness-obs-output/studio/baselines/<suite>.json
```

## LLM-as-Judge

LLM-as-Judge 是附加评估，报告页会显式显示 judge 分数、理由、模型、prompt 摘要和引用。它：

- 不影响确定性 PASS/FAIL；
- 不进入 baseline；
- 缺省禁用时不发起任何 judge 调用。

## 已知边界

- 本阶段是 B 阶段独立本地 Web UI，尚未嵌入 Electron 桌面端；
- 完整可视化用例编辑器未实现，suite 仍由文件定义；
- 历史删除未实现；
- 完整工具安全策略未实现，bash 仅允许安全演示命令；
- 插件化、上下文管理和记忆系统是后续讨论项。
