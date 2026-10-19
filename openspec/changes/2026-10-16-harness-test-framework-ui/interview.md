# Interview: harness-test-framework-ui

## Status

- Stage: interview conclusions captured; ready for `openspec new change`
- Date: 2026-10-16
- Rule: no implementation before user-reviewed specs and `.spec-frozen`

## Product direction

The project's overall goal is to build a personal Agent platform using an SDD + TDD workflow, with a desktop-style front end and a test framework. The current change focuses on the test framework. Context management and memory are deferred; lightweight, self-developed pluginization is a future option and must not become a blocking stage.

The UI's primary value is interview/demo storytelling. Secondary value is fast daily configuration and execution. If quality is sufficient, it may later become usable by others.

## Current interview decisions

### Q1: UI motivation

The UI must first support a persuasive closed loop: configure inputs, run tests, inspect events/results, and explain conclusions. It should then become convenient for daily use, and eventually could be shared.

### Q2: Delivery path: B first, then A

- B: standalone local web UI plus a local service.
- A: later embed/integrate the B service and UI into the pi-harness Electron desktop app.
- A is the eventual product shape: a pi-harness feature visible directly in the desktop app.
- **Do not forget:** the A-phase Electron integration plan must be explicitly designed later; B is not a throwaway prototype.

### Q3: Supported test forms

Both forms are required:

1. Suite regression testing (priority): run multiple fixtures, evaluate assertions, aggregate metrics, compare history/baseline.
2. Single ad-hoc real test (second): configure one prompt/model/tool input and inspect the resulting run.

### Q4: Result completeness

The UI progresses from:

1. PASS/FAIL plus the four core metrics;
2. per-fixture details, event/JSONL inspection, failure assertions;
3. complete persisted history, arbitrary two-run comparison, charts, and trends.

The complete level is the MVP boundary.

### Q5: History and comparison

- History must be persisted.
- Any two runs must be comparable.
- Differences must be visually obvious in the front end and charts.
- Query/storage abstractions are required.
- Deletion can be deferred.

### Q6: Test target

The current test target is a real Pi Agent session running inside pi-harness, because it includes tools, events, state, and run lifecycle. Generic LLM API testing has value as a provider/model smoke layer, but it is not the main Agent-session scenario and should not be the primary UI path.

Future target: connect the framework to first-agent once first-agent is sufficiently complete.

## Confirmed interview decisions

### Q7: B-phase definition

B should be the first usable local product, not a disposable mock. A later migrates the same capabilities into Electron.

### Q8: Test case authoring

Confirmed MVP: suites remain file-defined, while the web UI can inspect and edit parameters such as provider, model, prompt, tools, thresholds, and repeat count. A complete visual case editor is not required for the first MVP. A simplified visual editor is deferred to phase two.

The existing viewer is not the whole front end. The B-phase web UI is a new local application covering suite inspection, parameter editing, execution, live events, reports, history, comparison, and run trace/JSONL viewing. The current viewer can be reused as one part of that experience.

### Q9: Metrics

Confirmed MVP metrics beyond pass rate and the existing four-metric aggregate:

- per-case pass rate and overall pass rate;
- assertion failure reason;
- first-event latency;
- tool failure rate;
- tool error count;
- event completeness;
- repeat-run variability/stability.

Token/cost should be recorded when provider data exists; otherwise leave fields stable but empty. Tool-call semantic correctness is deferred because current scenarios have limited ability to distinguish wrong-but-similar tool choices. Implement every metric rated easy through moderate in the MVP.

Definitions:

- Tool failure rate = failed `tool.completed` events / all `tool.completed` events.
- Tool error count = count of `tool.completed` events with `isError: true`; do not merge broader runtime errors in MVP.
- Event completeness means the exported run has a structurally closed lifecycle: run start/terminal pair, message and tool start/completion pairs where applicable, no missing terminal state, and parsed line count consistent with footer metadata.
- Repeat-run variability measures stability across repeated executions of the same suite/configuration; report individual values plus aggregate and dispersion/range.

### Q10: Deterministic assertions and LLM-as-judge

Split evaluation into two classes:

1. Deterministic program checks: text containment, tool called/not called, tool count, token limit, duration limit, errors, and redaction. These are baseline-eligible.
2. Explicitly labeled LLM-as-judge checks: useful as auxiliary qualitative evidence. They must not be silently mixed with deterministic results. Confirmed for MVP: LLM-as-judge does not enter baseline and appears only as an additional report dimension. Whether it may ever enter baseline remains a future discussion.

### Q11: History storage

Start with a structured JSON store and expose run/report query abstractions. Migrate to SQLite only if query complexity or data volume justifies it. Do not build a full database layer in the first version.

### Q12: Repeats and baseline

Runs should support a configurable repeat count, defaulting to 1. Demos can use 3. Reports should show individual repeats and variability.

Confirmed:

- Deterministic suites may use one baseline run because inputs and assertions are stable.
- Real-LLM suites need repeated baseline runs for reproducibility.
- Baseline repeat count is configurable rather than hard-coded; 3 is recommended, and 5/10/other values are allowed. Avoid unnecessarily high counts in this personal project because of quota/time cost.
- Baselines record individual runs, aggregate statistics, and dispersion/range.

### Q13: Real-session isolation

Each suite/run should use:

- an independent session directory;
- a temporary working directory;
- a fixed tool allowlist;
- timeout handling;
- a cancel action.

Bash in the MVP should permit only safe demonstration commands such as `echo ok`. A fuller safety policy/tool allowlist is a future discussion.

### Q14: MVP demo story

Target demonstration:

1. Open the web UI and select `suite sample`.
2. Configure provider, model, and repeat count.
3. Start the run.
4. See live status and events.
5. After completion, see PASS/FAIL, core metrics, tool calls, and failure details.
6. Open history and choose any two runs.
7. Compare token usage, duration, pass rate, and tool failure rate visually.
8. Open a run's JSONL/span view.
9. Later, the same capability is visible inside the pi-harness desktop app.

## Explicit future discussions

- A-phase Electron integration architecture and UI placement.
- Minimal visual test-case editor scope and workload.
- Additional metrics and their computation plan.
- Whether LLM-as-judge may ever enter baseline.
- Baseline repeat count and aggregation policy.
- Full tool-safety policy beyond `echo ok`.
- Presentation/demo polish after the functional MVP.
- Lightweight self-developed plugin contract for suites/assertions/reporters, deferred until after the core framework.

## MVP slicing

1. M1 — standalone local web UI, suite execution, and reports.
2. M2 — persisted history, arbitrary two-run comparison, and charts.
3. M3 — real Pi sessions, repeat execution, and variability metrics.
4. M4 — integrate the capability into the pi-harness Electron desktop app.
