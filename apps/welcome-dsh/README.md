# Omni AI for DSH

`@automagik/welcome-dsh` is the first thing a DeepSeek Harness (DSH) shows with Omni
installed: the Omni octopus says hello, then helps you connect an AI. It adds no provider
code. Every sign-in it offers is one DSH 0.2.1-rc.3 already ships, and every route it
writes goes through DSH's own settings and credential store.

## What it does

Two steps on DSH's `settings.onboarding` slot, shown once each on a fresh start (a new
chat with nothing in it), ahead of DSH's own steps:

| Step | Order | What it shows |
|---|---|---|
| `omni-welcome` | −300 | The octopus, a typewriter speech bubble and a glitch, on a starfield. |
| `omni-connect-ai` | −200 | Connect AI: one switch per AI, Continue and Skip. |

The Omni channels plugin (`@automagik/omni-channels-dsh`) adds `omni-connect` (−250) between them when it
is installed. DSH's `welcome-notice` (−100) and `deepseek-official` (0) follow.

Each step draws its own modal and makes `#root` inert while it shows. When you finish or
skip a step, the plugin records it in its own settings entry, `omni-ai`, in three live
fields (`welcomeDone`, `connectAiDone`, `connectOmniSkipped`), so the step does not come
back after a restart. A step whose flag is already set completes without showing.

Connect AI is a list of switches, and several can be on. What this computer already has
comes first, under **Found on this computer**: Claude Code signed in, a key in DSH's store
or in the environment, a sign-in DSH already holds, a CLIProxyAPI route, Ollama answering
on `127.0.0.1:11434`. **Add another** shows four more, then the rest on demand. Continue
needs one AI really on; Skip finishes the step either way.

Flipping a switch on turns on what is set up, or opens its setup in the row: a key field,
the provider's own sign-in in DSH, or a terminal for Claude Code's own login. Off stops
using an AI and keeps its key, sign-in or account:

| Kind | On | Off |
|---|---|---|
| Key | writes the pi-ai route that names the key | removes the route; the key stays |
| Sign-in | the route is written once the sign-in succeeds | removes the route; the sign-in stays |
| Claude | enables the Claude Code plugin (`dsh-oh-my-claude`) in DSH's plugin manager | disables that plugin |
| CLIProxyAPI | the gateway form writes its route | removes the route; the key stays |
| Ollama | lists its models into a local OpenAI-compatible route | removes the route |
| dsh-subscriptions | shows the vendor's models again | hides them in that plugin's picker settings; the account stays |

DeepSeek is DSH's own route: its row turns on with a key or a DeepSeek account, and its key
is removed in Settings → Models. Every other provider DSH knows stays one link away, in
Settings → Models.

On a fresh install (no step finished before), the first step finished also hides the hint
above the composer, "Type a prompt to start. Save it here…": that is the starter card of
the Claude Code plugin (`dsh-oh-my-claude`), and its `starterOff` hint hides it. The hint
lives in the plugin's `hints.json` (`$DSH_OMC_STATE_DIR`, default
`~/.local/state/dsh-oh-my-claude`), one file for every DSH profile on the computer, so the
welcome adds `starterOff: true` only when the file has no `starterOff` yet, changes no key
that is there, and does it once (`starterSeeded` in its own entry). The plugin's own
setting turns the card back on.

Continue gives the companion and the Omni Bot their model. Both are made without one, so
joining the team sends nothing anywhere; once Connect AI finishes with an AI on, each gets
the team's default model and its held greeting goes out, without a further click. With no
model that can run (Skip, or only a provider that still needs its key), they keep waiting
and their chats offer the ways to set one up.

### The team step and the preload

The team step (`omni-team`) asks who joins the companion's team: Omni and Genie, each a card
with what it starts with. Omni's card starts asleep; its power button installs what a plain
DSH lacks (below), then looks for an Omni to connect. Genie has no DSH plugin yet, and
says so; it can still be added to the team.

The Automagik desktop app passes the product it was opened for (`omni desktop` →
`--preload=omni`, `genie desktop` → `--preload=genie`) to DSH as `AUTOMAGIK_PRELOAD`, which
`state` reports as `preload` (`src/host/preload.js`; anything but `omni` or `genie` is
none). That card comes first and starts chosen: Omni's powers on by itself, through the
same box and steps as a press, and Remove still sends it back to sleep; Genie's starts on
the team. The other card stays to add, then or later. Without a preload Omni comes first
and nothing is chosen.

### What the power button installs

The Bot team (`@automagik/bots-dsh`) is this repository's, at this plugin's version: from
the source this plugin came from, pointed at `apps/bots-dsh` (the same commit, or a linked
checkout), else that release by name. A DSH that has the team under its former name,
`@automagik/omni-dsh`, has the team: it is switched on, not installed over. Omni's channels
and canvases (`@automagik/omni-channels-dsh`, `@automagik/omni-canvas-dsh`) are Omni's, at
Omni's version: they install as a git source from Omni's repository at the release
`package.json` pins under `automagik.omni`, the same one the desktop app carries
(`apps/desktop/omni.json`; `follow-omni.yml` moves both).

### One way to each AI

| AI | Through | Not offered |
|---|---|---|
| Claude | the Claude Code app (`dsh-oh-my-claude`), signed in with `claude auth login` | DSH's own Claude sign-in and dsh-subscriptions' `claude`: both present as Claude Code |
| ChatGPT | DSH's sign-in (`openai-codex`) | dsh-subscriptions' `codex` |
| Kimi | DSH's sign-in (`kimi-coding`) | dsh-subscriptions' `kimi` |
| Copilot | DSH's sign-in (`github-copilot`) | dsh-subscriptions' `copilot` |
| Grok | DSH's sign-in (`xai`), or an `XAI_API_KEY` | dsh-subscriptions' `grok` |
| DeepSeek | DSH's key or account | pi-ai's `deepseek` route |
| Ollama | a local pi-ai route | dsh-subscriptions' `ollama` |

dsh-subscriptions keeps the vendors nothing else reaches (Cursor, Kiro, GLM, Qwen,
Perplexity, JetBrains, Cody, Replit and the rest). When an AI is turned on, the other ways
it is connected stop showing: their models are hidden and DSH's Claude sign-in loses its
route, and no account or stored sign-in is deleted. A row says when its AI is also
connected another way.

### Subscription sign-ins and vendor terms

A sign-in with a consumer plan is **personal use under the vendor's terms**: check that
provider's terms before you use a personal plan for work.

## Install into a raw DSH

The plugin needs DSH `>=0.2.1-rc.2 <0.3.0`. Add the Automagik marketplace index to DSH's
plugin market ([marketplace/README.md](../../marketplace/README.md) has the URL and the
steps) and install `@automagik/welcome-dsh` from it. DSH asks before it installs, then
applies the bundle patch (`cordis.patch.yml`), which adds one row, `id: omni-ai`, and
changes nothing else.

Restart DSH and start a new chat to see the octopus.

## The CLIProxyAPI route

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) serves an OpenAI-compatible
API for the providers you sign into on it. The form asks for its address (for example
`http://localhost:8317/v1`; an address without a path gets `/v1`) and its API key. On
Connect, the host:

1. Checks the address is `http://` or `https://`, with no user name, query or fragment.
2. Lists the gateway's models with `GET {baseURL}/models` and `Authorization: Bearer <key>`,
   without following redirects. An empty list refuses the save.
3. Stores the key with `ctx.credentials.set('OMNI_AI_CLIPROXY_API_KEY', key)`.
4. Writes the route into pi-ai's settings entry with
   `ctx.settings.update('llm-pi-ai', patch, revision)`, the revision read from
   `ctx.settings.describe()`:

   ```yaml
   providers:
     cliproxy:
       displayName: CLIProxyAPI
       api: openai-completions
       baseURL: http://localhost:8317/v1
       apiKeyEnv: OMNI_AI_CLIPROXY_API_KEY
       models:
         - { id: <model id>, name: <model id> }
   ```

The key never enters a settings file, a reply or a log: the route names it by the
env-shaped credential reference, which DSH resolves for each request. Saving again
replaces this route's model list and keeps every other route. Use `https://` for a
gateway that is not on your own machine, since the key travels with each request.

The shape was read from DSH 0.2.1-rc.2:

- `dsh-llm-pi-ai`: `Config = z.object({ providers: z.dict(profile).default({}).volatile() })`,
  where a profile has `apiKeyEnv` (a credential reference), `displayName`, `api`, `baseURL`
  and `models: [{ id, name, … }]`. Its README: a route pi-ai does not ship needs `api`,
  `baseURL` and a non-empty `models` list. The base bundle mounts it as entry `llm-pi-ai`.
- `dsh-settings`: `update(ns, patch, expectedRevision)` deep-merges plain objects and
  replaces arrays, so other routes stay and this route's `models` is replaced.
- `dsh-credentials`: a reference matches `/^[A-Za-z_][A-Za-z0-9_]*$/`.

## Host endpoint

`POST /api/omni-ai` with `{ endpoint, payload }`, answered `{ ok: true, value }` or
`{ ok: false, error: { code, message } }`:

| Endpoint | Payload | Does |
|---|---|---|
| `state` | none | The flags; `deepseek` (a `DEEPSEEK_API_KEY` or a DeepSeek account sign-in is stored); `piAiRoutes`; `aiConnected`; `preload` (`omni`, `genie` or null). |
| `done` | `{ stepId, connected? }` | Sets the flag for `omni-welcome`, `omni-connect-ai` or `omni-connect`. Connect AI's Continue sends `connected: true`: the companion and the Omni Bot, made without a model, then get the team's default model (DSH's default model when it is served and has its key, else the first model that can run), and their held greetings go out. Skip sets nothing. |
| `cliproxy` | `{ baseURL, apiKey }` | The route above; answers `{ route, baseURL, models }`. |
| `ais` | none | Every row: `{ id, name, via, kind, ready, on, found, needs?, detail?, duplicates? }`, and dsh-subscriptions' accounts and hidden vendors. Names and states only. |
| `ai-switch` | `{ id, on }` | Turns a row that is set up on or off (table above). |
| `ai-dedupe` | `{ id }` | Stops the other ways that row's AI is connected. |
| `ai-subscription` | `{ provider, on }` | Shows or hides a dsh-subscriptions vendor's models. |
| `provider-key`, `signin-*` | see `src/host/providers.js` | A key, or a sign-in run through DSH's authorization service. |
| `ai-terminal-open`, `-read`, `-write`, `-resize`, `-close` | `{ kind: 'claude-login' }`, then the terminal id | The terminal that runs `claude auth login`, typed at a prompt and run with Enter. |
| `omni-plugins` | none | The Omni plugins (`@automagik/bots-dsh`, `@automagik/omni-channels-dsh`, `-canvas-dsh`): each one's version and whether it is installed, `ready` once they run here, and the install in progress. |
| `omni-plugins-install` | none | Installs the missing ones in order through DSH's plugin manager (`installBundle`: the Bot team from this plugin's own source pointed at its sibling, else this release by name; Omni's from Omni's repository at the pinned release), switching on any that are off. Pressing Omni's power button in the team step calls it. |
| `bot-type` | `{ type: 'omni' }` | What the Omni Bot starts with, as groups: model and thinking (DSH's default), plugins with versions, tool groups with their switches, skills, folder and permissions. |

The host declares `inject: ['settings', 'credentials', 'connection']`; `connection` serves
the route. It reads DSH's `llm`, `authorization`, `pluginManager`, `agentDefaultModel`, `tools`, `skills`
and `permissionPresets` services and its process
service (`subprocess`, for the terminal) when they are there.

## Develop

```sh
bun install          # esbuild, for the client bundle
bun run harness      # the pinned DSH release the tests and the linter run against
bun run test         # on Node, as DSH runs
bun run lint
bun run build        # rewrites client.js; commit it
node scripts/build-client.mjs --check
```

`client.js` is generated from `src/client` and committed, so git and `link:` installs need
no build step.
