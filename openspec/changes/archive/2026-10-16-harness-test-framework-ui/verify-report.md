# Verify Report — 2026-10-16-harness-test-framework-ui

- 校验时间：2026-10-19 21:23–21:29（Asia/Shanghai）
- 校验人：Codex（/opsx:verify 收尾轮）
- 结论：**代码与自动化校验全部通过；9.3 真实 Pi 会话受控验收被外部 provider 403 阻塞，已如实记录（见下文 §4）。**

## 1. 全量校验结果（最终重跑）

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck`（vue-tsc node + web 两个 project） | 退出码 0，通过 |
| 目标单元测试 | `node node_modules/vitest/vitest.mjs run src/main/harness/eval-studio src/shared/schemas/eval-studio.test.ts scripts/lib viewer/viewer-core.test.mjs src/main/harness/export` | 14 个测试文件 / 80 个测试全部通过（3.77s） |
| Lint | `pnpm lint`（eslint .） | 退出码 0；0 errors / 15 warnings（全部为 CLI 脚本既有 `no-console` 风格警告与 1 处测试未用变量，非本 change 引入的错误） |
| 图变更分析 | GitNexus `detect_changes(scope=all)` | 54 个变更符号 / 11 个文件，风险等级 **medium**，无 HIGH/CRITICAL；仅 1 条受影响流程 `Main → MaskSecret`（`renderJsonl → maskSecret` 脱敏链路），已被 `src/main/harness/export` 与 `scripts/lib` 测试覆盖 |

说明：Playwright e2e（任务 9.2，`pnpm test:e2e`）已在 apply 阶段通过并勾选；本轮收尾按计划重跑上述四项，未重复执行 e2e。

## 2. 真实 schema 修复复核

- 问题：ad-hoc 真实会话路径在持久化 run record 时，`failureReasons` 条目携带 `fixtureId`，被 `z.strictObject` 拒绝，导致 record 落盘失败（证据：`harness-obs-output/studio-debug2/history/runs/studio-1792378913550-…/record.json` 内嵌 zod `unrecognized_keys` 错误）。
- 修复：`src/main/harness/eval-studio/server.ts`（真实路径 `failureReasons` 改为仅含 `assertionType/expected/actual/message`，`fixtureId` 保留在 fixtureResult 层），修复时间晚于上述失败 run，已生效。
- 回归覆盖：`src/main/harness/eval-studio/server.test.ts` 中 "runs an injected real Pi suite through exporter, report, and history"、"creates and runs an ad-hoc real session without a suite fixture file"、"creates a repeated real-LLM baseline with samples and dispersion" 三个真实路径测试全部通过。

## 3. 已完成任务的验收证据（摘要）

- 确定性 suite 全链路（suite 加载 → 运行 → SSE → 报告 → 历史 → 对比）：`harness-obs-output/studio/` 下 3 次 run 的 events/exports/reports/history 齐全；12 fixture 两次全量导出完整。
- 脱敏：studio 导出 footer 中 `totalTokens` 被掩码为 `••••••••••`；`redaction.jsonl` fixture 场景通过。
- 历史重启可恢复：`server.test.ts` "reopens completed history and trace after a service restart" 通过。
- 安全边界：非 localhost Host 拒绝、缺失/错误 token 拒绝、路径穿越拒绝测试均通过。

## 4. 9.3 真实 Pi 会话受控验收 — 外部阻塞（未完成，保持未勾选）

**阻塞现象**：真实会话请求 Zhipu API 一律返回 `403 status code (no body)`，assistant 消息 `stopReason=error`，无任何模型输出，导致导出缺失 enrich 字段（断言 `missing enriched fields` 正确判 FAIL）。

**证据**：

| 时间（本地） | run | 模型 | 结果 |
| --- | --- | --- | --- |
| 2026-10-19 10:58 | `real-1792378726961` | glm-5.3 | 403，entries=6，toolCalls=0，FAIL |
| 2026-10-19 21:01 | `studio-1792378913550-…`（ad-hoc real，glm-5.3） | glm-5.3 | 403 导致无内容；叠加当时 record schema bug（已修复） |
| 2026-10-19 21:28 | `real-1792416488463` | glm-5.2 | **同样 403**，entries=6，toolCalls=0，FAIL |

**定位**：glm-5.2 在本 change 早前曾 PASS（用户终端 "Real smoke: PASS (entries=16, toolCalls=2)"，产物 `harness-obs-output/real/exports/real-1791999296308.jsonl`），现同 key 同 provider 返回 403 —— 判定为 **provider 侧密钥/配额/授权状态变化**，非本 change 代码缺陷，也与具体模型无关。

**尽管被阻塞，9.3 的流水线机制已由受控运行证明**（403 前后各环节均正常）：

- 隔离 session 目录按 repeat 独立创建，真实 pi 会话原始 JSONL 完整落盘（71KB，`harness-obs-output/studio-debug2/sessions/…-repeat-1/` 与 `harness-obs-output/real/session/run-…/`）；
- 导出 JSONL 符合 schemaVersion=1，footer 指标生成，脱敏生效（totalTokens 掩码）；
- 失败断言正确将 run 判为 failed（`missing enriched fields`），SSE 事件顺序 `run.created → run.started → session.started → run.failed` 稳定；
- 历史 record 与事件日志持久化正常，可直接在历史/trace 中打开。

**解除阻塞条件**：恢复 Zhipu API 密钥可用性（控制台检查配额/授权，或 cc-switch 更新密钥）后，重跑：

1. `node scripts/real-eval-runner.mjs --provider zhipu --model glm-5.2`（应恢复 PASS）
2. eval-studio ad-hoc 真实会话（安全命令 `echo "ok"`）→ 确认导出含工具调用、进入历史、任选两次运行对比

## 5. 后续门禁

- 9.3 保持未勾选；推送/合并前需用户二选一：
  1. 恢复 provider 访问 → 补跑 9.3 → 勾选后走推送/合并/归档流程；
  2. 明确接受 403 阻塞作为已知外部限制 → 以本报告为准进入推送/合并（合并后仍可补跑 9.3）。
- 其余 9.1/9.2/9.4/9.5 已完成并通过本轮复核。
