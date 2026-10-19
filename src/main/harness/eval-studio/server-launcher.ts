import { createEvalStudioServer } from './server'

const port = Number(process.env.EVAL_STUDIO_PORT ?? 4621)
const server = createEvalStudioServer({
  ...(process.env.EVAL_STUDIO_DATA_ROOT
    ? { dataRoot: process.env.EVAL_STUDIO_DATA_ROOT }
    : {})
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Pi Harness Eval Studio: http://127.0.0.1:${port}/?token=${server.evalStudioToken}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0))
  })
}
