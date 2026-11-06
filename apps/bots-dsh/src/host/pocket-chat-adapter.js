// The Session Controller adapter for Pocket chat (#517), imported only when the runtime has the
// methods (pocket-chat.js hasSessionApi). It speaks DSH 0.2.2-rc.1's Host Remote shapes
// (@deepseek-ai/dsh-api-session-controller lib/types/index.d.ts:203-246, types.d.ts:386-473 and
// 578-592) and imports no DSH package: the controller is the plugin's injected service.
//
// Only reads. Every request names an ordinary Session address (`kind: 'session'`), never a
// subagent address; nothing here calls prompt, cancel, updateQueue or a Remote event.

/** @param {any} controller  `ctx.sessionController` */
export function createAdapter(controller) {
  const address = sessionId => ({ kind: 'session', sessionId })
  return {
    // A passive follow (no `activate`), without the Web client's assistant frames.
    follow: (sessionId, signal) => controller.follow({ address: address(sessionId) }, signal),
    events: (sessionId, { beforeSeq, maxMessages } = {}, signal) => controller.events({
      address: address(sessionId),
      ...(Number.isSafeInteger(beforeSeq) ? { beforeSeq } : {}),
      ...(Number.isSafeInteger(maxMessages) ? { maxMessages } : {}),
    }, signal),
    state: (sessionId, signal) => controller.state({ sessionId }, signal),
    observeState: (sessionId, signal) => controller.observeState({ sessionId }, signal),
  }
}
