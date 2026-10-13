/**
 * Deterministic sample eval suite (10-15 fixtures).
 *
 * Each fixture declares a complete ordered HarnessEvent sequence plus explicit
 * assertions. The runner turns the sequence into a JSONL export line-by-line
 * (through the same schema), then computes the four metrics and evaluates the
 * assertions against ONLY the exported JSONL — no model, no network, no app.
 */
export const suite = {
  id: 'sample',
  name: 'sample',
  fixtures: [
    {
      id: 'qa-basic',
      scenario: 'simple-qa',
      prompt: '1+1 等于几？',
      secretSeed: 'TEST_SECRET_0001',
      events: [
        { type: 'run.started', timestamp: 1000, runId: 'run-qa-basic', prompt: '1+1 等于几？' },
        { type: 'message.started', timestamp: 1010, runId: 'run-qa-basic' },
        { type: 'message.completed', timestamp: 1200, runId: 'run-qa-basic', usage: { input: 12, output: 6, cacheRead: 0, cacheWrite: 0, total: 18, cost: 0.001 }, model: 'glm-test', provider: 'test', text: '答案是 2。' },
        { type: 'run.completed', timestamp: 1205, runId: 'run-qa-basic', status: 'success' }
      ],
      assertions: [
        { kind: 'containsText', text: '2' },
        { kind: 'maxTokens', max: 200 },
        { kind: 'maxDurationMs', max: 10000 },
        { kind: 'noUnredactedSecret', secretSeed: 'TEST_SECRET_0001' }
      ]
    },
    {
      id: 'multi-turn',
      scenario: 'multi-turn',
      prompt: '先记住名字叫小明，然后回答我的名字。',
      secretSeed: 'TEST_SECRET_0002',
      events: [
        { type: 'run.started', timestamp: 2000, runId: 'run-multi', prompt: '先记住名字叫小明，然后回答我的名字。' },
        { type: 'message.started', timestamp: 2010, runId: 'run-multi' },
        { type: 'message.completed', timestamp: 2200, runId: 'run-multi', usage: { input: 20, output: 8, cacheRead: 4, cacheWrite: 0, total: 32, cost: 0.002 }, model: 'glm-test', provider: 'test', text: '你的名字是 小明。' },
        { type: 'message.started', timestamp: 2210, runId: 'run-multi' },
        { type: 'message.completed', timestamp: 2400, runId: 'run-multi', usage: { input: 32, output: 5, cacheRead: 4, cacheWrite: 0, total: 41, cost: 0.0025 }, model: 'glm-test', provider: 'test', text: '你的名字是 小明。' },
        { type: 'run.completed', timestamp: 2405, runId: 'run-multi', status: 'success' }
      ],
      assertions: [
        { kind: 'containsText', text: '小明' },
        { kind: 'maxTokens', max: 400 },
        { kind: 'maxDurationMs', max: 10000 }
      ]
    },
    {
      id: 'tool-success',
      scenario: 'tool-success',
      prompt: '查一下北京的天气。',
      secretSeed: 'TEST_SECRET_0003',
      events: [
        { type: 'run.started', timestamp: 3000, runId: 'run-tool-ok', prompt: '查一下北京的天气。' },
        { type: 'tool.started', timestamp: 3010, runId: 'run-tool-ok', toolCallId: 't1', toolName: 'get_weather' },
        { type: 'tool.completed', timestamp: 3100, runId: 'run-tool-ok', toolCallId: 't1', toolName: 'get_weather', isError: false },
        { type: 'message.started', timestamp: 3105, runId: 'run-tool-ok' },
        { type: 'message.completed', timestamp: 3250, runId: 'run-tool-ok', usage: { input: 40, output: 12, cacheRead: 0, cacheWrite: 0, total: 52, cost: 0.003 }, model: 'glm-test', provider: 'test', text: '北京今天晴，25 度。' },
        { type: 'run.completed', timestamp: 3255, runId: 'run-tool-ok', status: 'success' }
      ],
      assertions: [
        { kind: 'toolCalled', toolName: 'get_weather' },
        { kind: 'maxToolFailures', max: 0 },
        { kind: 'containsText', text: '25' },
        { kind: 'maxTokens', max: 500 }
      ]
    },
    {
      id: 'tool-failure',
      scenario: 'tool-failure',
      prompt: '删除文件 x.txt',
      secretSeed: 'TEST_SECRET_0004',
      events: [
        { type: 'run.started', timestamp: 4000, runId: 'run-tool-fail', prompt: '删除文件 x.txt' },
        { type: 'tool.started', timestamp: 4010, runId: 'run-tool-fail', toolCallId: 't2', toolName: 'remove_file' },
        { type: 'tool.completed', timestamp: 4090, runId: 'run-tool-fail', toolCallId: 't2', toolName: 'remove_file', isError: true },
        { type: 'tool.started', timestamp: 4100, runId: 'run-tool-fail', toolCallId: 't3', toolName: 'remove_file' },
        { type: 'tool.completed', timestamp: 4170, runId: 'run-tool-fail', toolCallId: 't3', toolName: 'remove_file', isError: false },
        { type: 'message.started', timestamp: 4180, runId: 'run-tool-fail' },
        { type: 'message.completed', timestamp: 4290, runId: 'run-tool-fail', usage: { input: 60, output: 10, cacheRead: 0, cacheWrite: 0, total: 70, cost: 0.004 }, model: 'glm-test', provider: 'test', text: '已删除。' },
        { type: 'run.completed', timestamp: 4295, runId: 'run-tool-fail', status: 'success' }
      ],
      assertions: [
        { kind: 'toolCalled', toolName: 'remove_file' },
        { kind: 'maxToolFailures', max: 1 },
        { kind: 'containsText', text: '删除' },
        { kind: 'maxTokens', max: 500 }
      ]
    },
    {
      id: 'tool-retry',
      scenario: 'tool-retry',
      prompt: '重试下载资源。',
      secretSeed: 'TEST_SECRET_0005',
      events: [
        { type: 'run.started', timestamp: 5000, runId: 'run-retry', prompt: '重试下载资源。' },
        { type: 'tool.started', timestamp: 5010, runId: 'run-retry', toolCallId: 't4', toolName: 'download' },
        { type: 'tool.completed', timestamp: 5080, runId: 'run-retry', toolCallId: 't4', toolName: 'download', isError: true },
        { type: 'tool.started', timestamp: 5090, runId: 'run-retry', toolCallId: 't5', toolName: 'download' },
        { type: 'tool.completed', timestamp: 5180, runId: 'run-retry', toolCallId: 't5', toolName: 'download', isError: false },
        { type: 'message.started', timestamp: 5185, runId: 'run-retry' },
        { type: 'message.completed', timestamp: 5300, runId: 'run-retry', usage: { input: 55, output: 9, cacheRead: 0, cacheWrite: 0, total: 64, cost: 0.004 }, model: 'glm-test', provider: 'test', text: '下载完成。' },
        { type: 'run.completed', timestamp: 5305, runId: 'run-retry', status: 'success' }
      ],
      assertions: [
        { kind: 'toolCalled', toolName: 'download' },
        { kind: 'maxToolFailures', max: 1 },
        { kind: 'containsText', text: '完成' }
      ]
    },
    {
      id: 'long-context',
      scenario: 'long-context',
      prompt: '请总结一篇长文。',
      secretSeed: 'TEST_SECRET_0006',
      events: [
        { type: 'run.started', timestamp: 6000, runId: 'run-long', prompt: '请总结一篇长文。' },
        { type: 'message.started', timestamp: 6010, runId: 'run-long' },
        { type: 'message.completed', timestamp: 7000, runId: 'run-long', usage: { input: 8000, output: 120, cacheRead: 3000, cacheWrite: 0, total: 11120, cost: 0.05 }, model: 'glm-test', provider: 'test', text: '已总结要点。' },
        { type: 'run.completed', timestamp: 7005, runId: 'run-long', status: 'success' }
      ],
      assertions: [
        { kind: 'containsText', text: '要点' },
        { kind: 'maxTokens', max: 20000 },
        { kind: 'maxDurationMs', max: 30000 }
      ]
    },
    {
      id: 'empty-input',
      scenario: 'empty-input',
      prompt: '',
      secretSeed: 'TEST_SECRET_0007',
      events: [
        { type: 'run.started', timestamp: 8000, runId: 'run-empty', prompt: '' },
        { type: 'message.started', timestamp: 8010, runId: 'run-empty' },
        { type: 'message.completed', timestamp: 8200, runId: 'run-empty', usage: { input: 2, output: 4, cacheRead: 0, cacheWrite: 0, total: 6, cost: 0.0005 }, model: 'glm-test', provider: 'test', text: '请输入内容。' },
        { type: 'run.completed', timestamp: 8205, runId: 'run-empty', status: 'success' }
      ],
      assertions: [
        { kind: 'containsText', text: '请输入' },
        { kind: 'maxTokens', max: 50 }
      ]
    },
    {
      id: 'invalid-input',
      scenario: 'invalid-input',
      prompt: '非法输入测试',
      secretSeed: 'TEST_SECRET_0008',
      events: [
        { type: 'run.started', timestamp: 9000, runId: 'run-invalid', prompt: '非法输入测试' },
        { type: 'message.started', timestamp: 9010, runId: 'run-invalid' },
        { type: 'message.completed', timestamp: 9200, runId: 'run-invalid', usage: { input: 20, output: 8, cacheRead: 0, cacheWrite: 0, total: 28, cost: 0.002 }, model: 'glm-test', provider: 'test', text: '输入参数不合法。' },
        { type: 'run.completed', timestamp: 9205, runId: 'run-invalid', status: 'success' }
      ],
      assertions: [
        { kind: 'containsText', text: '不合法' },
        { kind: 'toolNotCalled' }
      ]
    },
    {
      id: 'timeout',
      scenario: 'timeout',
      prompt: '长时间任务示例',
      secretSeed: 'TEST_SECRET_0009',
      events: [
        { type: 'run.started', timestamp: 10000, runId: 'run-timeout', prompt: '长时间任务示例' },
        { type: 'message.started', timestamp: 10010, runId: 'run-timeout' },
        { type: 'message.completed', timestamp: 10100, runId: 'run-timeout', usage: { input: 30, output: 12, cacheRead: 0, cacheWrite: 0, total: 42, cost: 0.003 }, model: 'glm-test', provider: 'test', text: '任务耗时过长，已中止处理。' },
        { type: 'run.completed', timestamp: 10105, runId: 'run-timeout', status: 'success' }
      ],
      assertions: [
        { kind: 'containsText', text: '中止' },
        { kind: 'maxDurationMs', max: 3000 }
      ]
    },
    {
      id: 'model-error',
      scenario: 'model-error',
      prompt: '触发模型错误',
      secretSeed: 'TEST_SECRET_0010',
      events: [
        { type: 'run.started', timestamp: 11000, runId: 'run-model-err', prompt: '触发模型错误' },
        { type: 'message.started', timestamp: 11010, runId: 'run-model-err' },
        { type: 'runtime.error', timestamp: 11100, runId: 'run-model-err', message: 'model unavailable' },
        { type: 'run.failed', timestamp: 11105, runId: 'run-model-err', error: 'model unavailable' }
      ],
      assertions: [
        { kind: 'failed' }
      ]
    },
    {
      id: 'user-abort',
      scenario: 'user-abort',
      prompt: '用户中途取消',
      secretSeed: 'TEST_SECRET_0011',
      events: [
        { type: 'run.started', timestamp: 12000, runId: 'run-abort', prompt: '用户中途取消' },
        { type: 'message.started', timestamp: 12010, runId: 'run-abort' },
        { type: 'runtime.aborted', timestamp: 12100, runId: 'run-abort' },
        { type: 'run.aborted', timestamp: 12105, runId: 'run-abort' }
      ],
      assertions: [
        { kind: 'aborted' }
      ]
    },
    {
      id: 'redaction',
      scenario: 'redaction',
      prompt: '包含敏感信息',
      secretSeed: 'TEST_SECRET_0012',
      events: [
        { type: 'run.started', timestamp: 13000, runId: 'run-redact', prompt: '包含敏感信息' },
        { type: 'message.started', timestamp: 13010, runId: 'run-redact' },
        { type: 'message.completed', timestamp: 13200, runId: 'run-redact', usage: { input: 30, output: 9, cacheRead: 0, cacheWrite: 0, total: 39, cost: 0.003 }, model: 'glm-test', provider: 'test', text: '密钥是 TEST_SECRET_0012，请不要外泄。' },
        { type: 'run.completed', timestamp: 13205, runId: 'run-redact', status: 'success' }
      ],
      assertions: [
        { kind: 'containsText', text: '密钥' },
        { kind: 'noUnredactedSecret', secretSeed: 'TEST_SECRET_0012' }
      ]
    }
  ]
}