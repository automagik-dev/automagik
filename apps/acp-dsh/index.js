// Automagik ACP for DeepSeek Harness: agents other than DSH's own, over the Agent Client
// Protocol, as DSH models (RFC 0003). A Session on one keeps DSH's history and sidebar; the
// agent's tool calls show as DSH tool cards and ask through DSH's approval dialog.
//
// Host only: no browser half, so nothing here can stop the web UI from loading. With no agent
// configured or found, it registers no route at all.
import z from '@deepseek-ai/schemastery'
import { AcpAdapter, aside } from './src/host/adapter.js'

export const name = 'acp-dsh'
export const inject = ['llm', 'agents']

export const Config = z.object({
  fakeAgent: z.string().description('Tests only: a script that speaks ACP, served as the acp-fake model. The command comes from these host settings, never from a client route.'),
})

export function apply(ctx, config = {}) {
  const agents = new Map()
  if (config.fakeAgent) {
    agents.set('acp-fake', {
      name: 'Fake agent',
      model: { id: 'fake', name: 'Fake agent' },
      spawn: () => ({ command: process.execPath, args: [config.fakeAgent] }),
    })
  }
  if (agents.size === 0) return
  const adapter = new AcpAdapter(ctx, agents)
  ctx.llm.registerAdapter([...agents.keys()], adapter)
  ctx.on?.('llm/stream', aside(agents))
  ctx.on?.('dispose', () => adapter.dispose())
}
