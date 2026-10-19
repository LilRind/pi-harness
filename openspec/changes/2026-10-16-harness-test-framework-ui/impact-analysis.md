# Impact Analysis

Date: 2026-10-16

Repository index was rebuilt successfully with GitNexus 1.6.12:

- 19,998 nodes
- 49,751 edges
- 576 clusters
- 1,117 flows

## Eval runner extraction

Target: `renderJsonl` in `scripts/eval-runner.mjs`

- Risk: LOW
- Direct dependents: `exportFixture`
- Indirect dependents: `main`, `scripts/eval-runner.mjs`
- Affected process: `Main → MaskSecret`

Protection: extract pure helpers without changing the CLI contract. Preserve the existing report paths, exit-code priority, and summary output while adding direct unit tests around the extracted helpers.

## Real runner extraction

Target: `eventsFromEntries` in `scripts/real-eval-runner.mjs`

- Risk: LOW
- Direct dependents: `main`
- Indirect dependents: `scripts/real-eval-runner.mjs`

Protection: keep process spawning at the CLI boundary and extract session reading, event conversion, and export assertions into testable pure/core functions. Do not require a real model for unit tests.

## Viewer parsing extraction

Target: `renderTree` in `viewer/viewer.mjs`

- Risk: LOW
- Direct dependents: `load`
- Indirect dependents: `viewer/viewer.mjs`

Protection: extract parsing/tree/summary calculations before changing UI code. Keep the standalone viewer behavior unchanged and add tests for event rows, footer rows, malformed lines, token fallback, and tree reconstruction.

## Harness exporter boundary

Target: `HarnessEventExporter` in `src/main/harness/export/harness-event-exporter.ts`

- Risk: HIGH
- Impacted count: 10
- Direct dependents: 4
- Affected processes: 2 (`HarnessRuntime.constructor`, Electron `bootstrap`)
- Affected modules: Export, Runs, Services

Important direct consumers include `harness-event-exporter.test.ts`, `harness-runtime.ts`, `HarnessRuntime.constructor`, and `HarnessRuntime.shutdownAll`. Indirect consumers include runtime tests, orchestrator host, Electron main entry, and harness IPC registration.

Mitigation: this change MUST NOT modify `HarnessEventExporter` semantics. The eval studio consumes exported JSONL and the existing exporter API only. Any required exporter behavior change would require a separate impact-reviewed change.
