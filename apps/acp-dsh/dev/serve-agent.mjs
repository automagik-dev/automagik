// The agent side of one ACP connection, for the fake agents: SDK 2.x has no connection class, so
// each request an implementation answers is registered by its method name, and what the agent
// asks its client goes through the peer context. A method the implementation lacks stays
// unregistered and answers Method Not Found, as a real adapter without it does.
import { agent, methods } from '@agentclientprotocol/sdk/unstable'

const { session } = methods.agent
const REQUESTS = {
  initialize: methods.agent.initialize,
  authenticate: methods.agent.authenticate,
  newSession: session.new,
  forkSession: session.fork,
  closeSession: session.close,
  setSessionMode: session.setMode,
  setSessionConfigOption: session.setConfigOption,
  prompt: session.prompt,
}

/**
 * @param {Record<string, (params: any) => Promise<any>>} implementation
 * @param {import('@agentclientprotocol/sdk/unstable').Stream} stream
 */
export function serveAgent(implementation, stream) {
  const app = agent({ name: 'fake-agent' })
  for (const [name, method] of Object.entries(REQUESTS)) {
    if (typeof implementation[name] !== 'function') continue
    app.onRequest(method, async ({ params }) => (await implementation[name](params)) ?? {})
  }
  if (typeof implementation.cancel === 'function') {
    app.onNotification(session.cancel, ({ params }) => implementation.cancel(params))
  }
  const { client } = app.connect(stream)
  return {
    sessionUpdate: params => client.notify(methods.client.session.update, params),
    // `options.cancellationSignal` takes the question back (`$/cancel_request`) when it aborts.
    requestPermission: (params, options) => client.request(methods.client.session.requestPermission, params, options),
  }
}
