# Auto review of a bridge call

Design note for WISH 3 (e), tracker #516, on top of RFC 0003's amendment, "DSH's tool set on ACP
routes, and live switching". Approved in direction by the DSH captain with five binding edits;
this note records them before the build.

## Problem

DSH's Auto preset is full access's sandbox (`danger-full-access`) with approval policy `ask`;
its one gate is the experimental auto-review plugin. That plugin reviews every tool call in a
`tools/pre-execute` listener, before the tool body runs:

- it reads the pending call from `tools.execute`'s execution (`callId`, `rootCallId`, `name`,
  parsed `arguments`, `agent`);
- it rebuilds the reviewer input from the Session's durable surface and log
  (`session.surface.nodes`, `session.snapshotEvents()`, `session.requestHeader()`);
- it requires an open step, one logged `tool/call` for the pending root call in that step, and
  an `assistant/message` on the surface whose content has a `tool-call` block with the same id,
  name and raw arguments;
- it resolves that tool's schema from the latest `request/header` (`description`, `parameters`);
- it calls the model named by that header with `purpose: 'auto-review'` and turns its JSON
  decision into `allow`, `deny`, or `ask` (deny when the Session's approval override is
  `never`, else the user is asked).

A bridge call is out-of-band: the agent's child bridge reaches `Backchannel.call` over loopback,
runs `tools.execute`, and DSH's surface has no assistant block for that call. The auto-review
listener therefore fails its snapshot (`the pending root call is missing from the current
surface`, or `no open step`), returns its fail-closed `AUTO_REVIEW_FAILED` denial, and the body
never runs. `apps/acp-dsh/src/host/backchannel.js` currently avoids the dialog on Auto and says
the call "routes through the pipeline"; the pipeline is exactly what refuses it. Manual works
because the bridge raises `approval.request` itself and the auto-review gate is inactive;
Full access works because `never` and Auto are different levels.

A second, independent refusal sits on the same path: the reviewer's `llm.stream` call uses the
Session's request-header route, which on an ACP Session is the agent's route. `aside()` in
`apps/acp-dsh/src/host/adapter.js` refuses every side request on an agent route except a Session
title, so even a correct snapshot would end in `UNSUPPORTED` and a failed review.

## The seam

Two changes, one per refusal. Neither touches the level filter, the tool set, or the approval
policy.

### 1. `Backchannel.call`: the bridge call becomes a synthetic root call

`apps/acp-dsh/src/host/backchannel.js`, in `call(record, {name, arguments, callId})`, after the
offered-tool check and before the `tool/call` row and `tools.execute`:

- **Auto only** (`level.auto`): append the assistant block the reviewer reads, at the same
  `turn`/`step` the open step carries (the same position `positionOf` reads):

  ```js
  session.append('assistant/message', {
    turn, step, stream: [],
    message: createAssistantMessage({
      // The marker is what keeps this block out of provider history.
      source: { provider, model, bridge: true, synthetic: SYNTHETIC_KIND },
      content: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args ?? {}) }],
    }),
  }, { surfaceOp: 'append' })
  ```

  `SYNTHETIC_KIND` is a shared constant (`acp-bridge` in `names.js`). The block is tool-only and
  unmistakably marked in its `source`; it is not a real assistant turn.

- Then append the existing `tool/call` row with the same `turn`, `step`, `callId`, `name` and
  raw `arguments`.
- Then call `tools.execute` exactly as today. `tools.execute` mints `rootCallId = callId` and
  runs the real `tools/pre-execute` waterfall, so the auto-review listener sees this execution.

Manual and Full access append no assistant block: their paths keep today's rows, so the chat and
the dialog count do not change.

**Reviewer-only, never provider history.** The block is removed from the Session surface as soon
as the call settles: the bridge appends an empty `developer/message` replacement over exactly
that surface node (`surfaceOp: { op: 'replace', startSeq, endSeq }`,
`sourceEventSeqs: [syntheticSeq]`, source kind `SYNTHETIC_KIND`). An empty developer message
derives to no model message, so no later request sees the block. The replay path is guarded too:
`renderMessage()` in `switch.js` returns `undefined` for a message whose
`source.synthetic === SYNTHETIC_KIND`, and `lastProviderOf()` skips it, so a block that survives
a crash or a failed replacement still cannot cross to another provider. A test asserts the
synthetic call is absent from the prompt after a crossing.

**Attribution.** The synthetic block uses the open step's `turn`/`step` (the same position
`positionOf` reads) and the bridge call's own id, name and raw arguments. The `tool/call` row
remains the single source of the chat's tool card; the assistant block never becomes a second
visible card. DSH's chat renders an assistant message whose only block is a `tool-call` as
nothing, and the card is still keyed by the `tool/call` + `tool/result` pair.

**Preflight, fail closed.** Before appending anything, the bridge checks what the reviewer will
require, and refuses without executing when it is missing:

- an open step: the last turn boundary is `step/start` with the same `turn`/`step` as
  `positionOf`;
- a complete header route: `session.requestHeader()` has non-empty `config.provider` and
  `config.model`;
- exactly one `tools` entry for `name` with a string `description` and object `parameters`.

If a check fails, the bridge returns a named `AUTO_REVIEW_*` error to the agent and writes no
`tool/call` row it cannot close. It never runs the body unreviewed.

### 2. `aside()`: the reviewer gets a model that answers on its own

`apps/acp-dsh/src/host/adapter.js`, `aside(providers, ctx, sideModel, redact)`: add
`'auto-review'` to the side-request purposes that may cross an agent route, beside
`session-title`. The chosen model is the same fallback chain the title uses: DSH's
`agentDefaultModel` selection when it is not an agent route, else `sideModel()` (DeepSeek Flash
by default), with the agent's `reasoningEffort` removed; the request keeps its `system`,
`messages`, `temperature`, `sessionId`, `purpose` and `signal`. If neither is a usable non-agent
model, the request is refused with `UNSUPPORTED`, as today.

**Redact before the reviewer.** For `auto-review`, every text block in the review's `messages`
(and the `system` text) passes the shared redactor (`redactorFor(ctx)`: the Bot team's saved
secrets, then the credential-shape table) before the nested `ctx.llm.stream` call. The reviewer
sees the bridge tool's name, redacted arguments and schema, never a raw credential-shaped value.
The agent still never receives the reviewer request: `isAgentLoopRequest` requests and every
other side purpose are unchanged, and the nested call lands on a non-agent route.

## Ordering guarantees

1. Off-line gate: the bridge refuses an unoffered tool before any row or execution (unchanged).
2. Auto preflight (open step, header route, unique tool schema) before any row.
3. `assistant/message` (surface, marked) before `tool/call` (log), both before `tools.execute`.
4. `tools.execute` runs `tools/pre-execute`; auto-review's allow/deny/ask decision is final for
   the dispatch stage: `deny` and `cancel` become an error result and the body is never invoked;
   `ask` uses the approval service; only `allow` dispatches.
5. The bridge's `tool/result` row closes the call, error or success; its revocation re-check
   after the await still wins over a late allow.
6. On Auto the bridge does not raise its own `approval.request`, so a reviewer `ask` (or a
   final denial surfaced by the level) is the one user decision, not two.
7. The synthetic block is replaced with an empty developer message once the call settles, before
   any other model request can see it.

## What the reviewer is shown

The bridge contributes the pending call: the tool name, its arguments (redacted on the way to
the reviewer), and the tool's schema from the Session's request header (description and
parameters), at the end of the Session's retained history. It contributes no separate "tier";
auto-review derives the risk tier from the tool and arguments under its fixed policy. The
synthetic assistant block carries no text, so the reviewer never sees an empty or invented
action.

## One card, one dialog

- The synthetic assistant block is tool-only and is not a card source. The single card for a
  bridge call is still the one `tool/call` + one `tool/result` pair the bridge writes, for both
  an allowed run and a refusal. Tests assert exactly one pair and no second `tool/call`.
- Manual: one DSH dialog, as today. Auto: the bridge raises no dialog of its own; a reviewer
  denial under `never` is final, and under `ask` it is the one approval dialog Auto promises.
  Full access: no dialog, as today. Tests assert the counts; no extra review dialog appears on
  Full.

## Failure modes, all fail closed

| Condition | Code | Outcome |
|---|---|---|
| No open step | `AUTO_REVIEW_NO_STEP` | Bridge error before any row; no `tools.execute` |
| No complete header route | `AUTO_REVIEW_NO_ROUTE` | Bridge error before any row; body does not run |
| No unique tool schema in the header | `AUTO_REVIEW_NO_SCHEMA` | Bridge error before any row; body does not run |
| Reviewer model missing, refused, errors, or emits invalid JSON | `AUTO_REVIEW_FAILED` (from auto-review) | Denial; body does not run |
| Reviewer does not answer within the bridge's review timeout | `AUTO_REVIEW_TIMEOUT` | Per-call signal aborts; body does not run |
| Level stops being Auto while the review is pending | `AUTO_REVIEW_LEVEL_CHANGED` | Per-call signal aborts; body does not run |
| Credential revoked mid-call | `BRIDGE_REVOKED` | 401 to the bridge; body does not run |
| Reviewer denies | `AUTO_REVIEW_DENIED` (from auto-review) | Error result; body does not run |
| Manual / Full access | — | No synthetic block; Manual's one dialog and Full's no dialog unchanged |
| Append of the synthetic block or `tool/call` throws | `AUTO_REVIEW_FAILED` | Bridge error; no `tools.execute` |

Each row has its own test (see below). The level guard subscribes to the Session's
`permission/preset`, `sandbox/mode` and `approval/policy` events, re-evaluates the level and
aborts the call's signal when it is no longer Auto; a re-check immediately before
`tools.execute` covers a host without the subscription. The review timeout is a per-call timer
(default 120 s) on the same signal.

## Interaction with the level filter and the drift detector

- **Level filter.** `offeredTools` still decides what the bridge offers: the Session's preset
  minus the mirror, minus file-only mutators in a read-only sandbox. Auto is
  `danger-full-access`, so its offered set is the full preset; every offered call is now
  reviewed. No new tool reaches Auto, and the filter is read before the synthetic rows.
- **Drift detector.** `checkDrift` runs on ACP tool-call updates, not on the bridge's synthetic
  Session rows; the new rows cannot be mistaken for a built-in call. A drifted built-in call is
  still recorded and its turn cancelled, and the bridge path is not involved.

## Test that proves it

`apps/acp-dsh/test/backchannel.test.js`, over the real bridge and `Backchannel`, with the real
`@deepseek-ai/dsh-experimental-auto-review` `apply()` listener as the fake `tools.execute`
pre-execute gate (the harness ships the package), Session preset `auto` and
`approval.overrideOf` `never`:

- **allow:** reviewer returns `{"risk":"low","decision":"allow"}`; the body runs; one
  `tool/call` and one `tool/result`; the synthetic node is replaced and absent from the surface.
- **deny:** reviewer returns `{"risk":"high","decision":"deny","reason":"no"}`; the body does
  not run; the bridge result carries `AUTO_REVIEW_DENIED`; one card pair.
- **matrix:** no open step, no route, duplicate schema, reviewer error, reviewer timeout,
  revocation mid-review and a level flip during review each return their named code and execute
  nothing.
- **redaction:** a credential-shaped argument is masked in the `messages` the reviewer receives.
- **counts:** Manual asks once, Full asks none, Auto's final denial asks none; each run has one
  tool card pair.

`apps/acp-dsh/test/adapter.test.js` adds the routing half and the replay half:

- `purpose: 'auto-review'` on an agent route goes to the same non-agent model as a title, keeps
  system/messages/temperature, redacts text, and is refused (`UNSUPPORTED`) when no non-agent
  model exists; title, `compaction` refusal, agent loop and non-agent routes keep their current
  outcomes.
- a marked synthetic assistant block is absent from the prompt after a provider crossing.

`apps/acp-dsh/test/switch.test.js` adds `renderMessage()`/`lastProviderOf()` unit cases for the
synthetic marker.

## Limits

- The reviewer is the Session's side model, not the ACP agent: an ACP agent cannot answer an
  out-of-band request without becoming a prompt of its own.
- The synthetic assistant block is model-visible only to the review that asks for it; it is
  deliberately removed from the surface afterwards and filtered from replay.
- `dshTools` remains off unless set. With it off, no bridge exists and none of this runs.
