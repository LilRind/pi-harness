# 端到端演示（4.1）

1. 运行样例评测：`node scripts/eval-runner.mjs --suite sample --update-baseline --reason "demo"`
   - 产出 `harness-obs-output/exports/*.jsonl`、`reports/sample-*.json`、`reports/sample-*.md`、`baselines/sample.json`。
2. 打开 `viewer/index.html`，拖入 `harness-obs-output/exports/` 里任意 `.jsonl`，看到 span 树、时间线、错误标记与趋势。
3. 再次运行 `node scripts/eval-runner.mjs --suite sample`，退出码为 `0`（无 regression），报告 Verdict 为 `same`。
4. 若需演示 regression：临时改 fixture 断言（如把 token 上限调低）或用 `--update-baseline` 制造基线差异后对比。
