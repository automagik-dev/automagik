// Your DSH's models for Unfold. This host plugin serves the model routes of the DSH it runs in
// on 127.0.0.1, as the OpenAI chat-completions subset Unfold's agent speaks (src/host/bridge.js),
// behind a key made at each start. Unfold finds the port and the key in this plugin's state
// file (src/host/endpoint-file.js). Sign-ins and their tokens stay in DSH: the bridge sends
// each request through DSH's llm service and returns text, usage and stable failure codes.
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { randomBytes } from 'node:crypto'
import { startBridge } from './src/host/bridge.js'
import { endpointFile, removeEndpoint, writeEndpoint } from './src/host/endpoint-file.js'

export const name = 'unfold-bridge'
export const inject = ['llm']

export function apply(ctx) {
  ctx.effect(() => {
    const key = randomBytes(32).toString('base64url')
    const file = endpointFile()
    let stopped = false
    const running = startBridge({
      llm: ctx.llm,
      key,
      assistant: createAssistantMessage,
      log: line => ctx.logger?.info?.('unfold-bridge: %s', line),
    }).then(bridge => {
      if (stopped) return bridge.close().then(() => undefined)
      writeEndpoint(file, { port: bridge.port, key, pid: process.pid, started: Date.now() })
      ctx.logger?.info?.('unfold-bridge: serving on 127.0.0.1:%d', bridge.port)
      return bridge
    }).catch(error => {
      ctx.logger?.warn?.('unfold-bridge: not serving: %s', error?.message ?? error)
    })
    return async () => {
      stopped = true
      const bridge = await running
      removeEndpoint(file, key)
      await bridge?.close()
    }
  }, 'unfold-bridge: the loopback endpoint')
}
