# Route-first model selector: screenshots

Captured from a running Automagik desktop build carrying this branch, in a Bot's real chat
(`Selector`), with the repository's English scripted model. Light and dark are the app's own
theme (`prefers-color-scheme` through DSH's theme preference), not a recolored mockup. The
model menu is opened from the **composer's model button** (bottom right), not from the
`change` link under the greeting.

| Screenshot | What it shows |
|---|---|
| `route-{light,dark}.png` | The first level: Native, ACP and Herdr, in that order, with the current route marked and ACP's full expansion on the row. The menu is anchored above the composer button. |
| `native-models-{light,dark}.png` | Native's models, one list under their provider; the Bot's model is ticked. |
| `acp-agents-{light,dark}.png` | ACP's second level: Claude Code and Codex with their own marks, then Hermes, Antigravity and omp shown dimmed and `Not available yet` until #973 serves them (their own marks are shown too). |
| `acp-models-{light,dark}.png` | One ACP agent's models, reached after the agent. |
| `route-confirm-{light,dark}.png` | The crossing, after a model on another route is picked and before anything is applied: the new conversation and the handoff note are named, with Keep this conversation and Change route. |
| `herdr-{light,dark}.png` | Herdr's interim state: its agents are shown with their marks, dimmed and `Not available yet`, with no chevrons, until #1007/RFC 0030 wires the terminal. |

The sample team is English throughout. The screenshots carry no token, machine name or
filesystem path.
