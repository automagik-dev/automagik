# Unfold bridge (`@automagik/unfold-bridge-dsh`)

Use the models of your own [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) in Unfold. This DSH host plugin serves your DSH's model routes on `127.0.0.1` as an OpenAI-compatible chat-completions endpoint. A new key is made each time it starts. Unfold finds the endpoint and offers it as one more model provider.

The routes are whatever your DSH has: an API key, DSH's own sign-ins, or a provider plugin you installed. Your sign-ins and their tokens stay in DSH. The bridge hands each request to DSH's `llm` service and returns only text, token usage and stable failure codes.

## What it serves

| Route | What |
|---|---|
| `GET /v1/models` | Every model of every provider route, as `provider/model`. Each entry has the model's and the provider's display names, and nothing else. |
| `POST /v1/chat/completions` | One model call, streamed (`stream: true`, OpenAI SSE, with `stream_options.include_usage`) or whole. |

**A request may carry:**
- `system`, `developer`, `user` and `assistant` messages, as text;
- `temperature`, `max_tokens` (or `max_completion_tokens`) and `stop`.

Other fields are ignored.

**Refused with 400, before any model is called:**
- tools, or tool messages;
- images;
- a model that isn't in `provider/model` form.

Reasoning text isn't passed on.

**Failures:**
- A failure before the first token is an HTTP error that carries DSH's stable code (`RATE_LIMIT` → 429, `NO_ADAPTER` → 404, `CONTEXT_WINDOW_EXCEEDED` → 400, any other → 502).
- A failure after the first token ends the stream with one `error` event and no `[DONE]`.
- The provider's own error text is never passed on, because it can name an account.

## Who can reach it

Every request needs all three of these:
- `Authorization: Bearer <key>`, compared in constant time;
- the exact `Host` it listens on (`127.0.0.1:<port>`);
- no `Origin` header.

**What that stops:**
- A web page can't call it, even through DNS rebinding.
- No CORS header is ever sent.
- It binds `127.0.0.1` only: never another interface, and it doesn't announce itself on the network.

**What it doesn't stop:** the key keeps out web pages and other users of the computer. It doesn't protect against programs you run yourself, because those can already read DSH's own files.

**The log:** one line per request, with the method, path, status and time. It never contains the key, a prompt or a reply.

## How an app finds it

At start, the bridge writes `endpoint.json` into `$XDG_STATE_HOME/unfold-bridge/`, which defaults to `~/.local/state/unfold-bridge/`. The folder is 0700 and the file 0600:

```json
{ "v": 1, "port": 51234, "key": "<32 random bytes, base64url>", "pid": 4242, "started": 1792997825000 }
```

**Lifecycle:**
- The file is replaced at every start.
- It is removed when the plugin stops (switched off, or DSH quits).
- A stopped bridge's key no longer opens anything.

**Reading it:** an app checks that the file is its user's, mode 0600, and that `pid` is alive. It then keeps the key in memory only.

## Install

1. Add the Automagik market to DSH's plugin market ([marketplace/README.md](../../marketplace/README.md) has the URL).
2. Install **Unfold bridge**.

DSH asks before it installs, and you switch the bridge on and off on its Plugins page. Switching it off stops the endpoint at once.

The plugin declares `inject: ['llm']` and nothing else. It needs no settings.

## Develop

```sh
bun install          # nothing to build: host code only
bun run harness      # the pinned DSH release the tests and the linter run against
bun run test         # on Node, as DSH runs; a fake llm service, no model is called
bun run lint
```
