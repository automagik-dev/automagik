# Route-first model selector: screenshots

Captured from a running Automagik desktop build carrying this branch, in a Bot's real chat
(`Selector`), with the repository's scripted model. Light and dark are the app's own theme
(`prefers-color-scheme` through DSH's theme preference), not a recolored mockup.

| Screenshot | What it shows |
|---|---|
| `route-{light,dark}.png` | The first level: Native, ACP and Herdr, in that order, with the current route marked and ACP's expansion on the row. |
| `native-models-{light,dark}.png` | Native's models, one list under their provider; the Bot's model is ticked. |
| `acp-agents-{light,dark}.png` | ACP's second level: the agents acp-dsh serves (Claude Code and Codex here; Hermes, Antigravity, omp and any later agent appear without a selector change). |
| `acp-models-{light,dark}.png` | One ACP agent's models, reached after the agent. |
| `route-confirm-{light,dark}.png` | The crossing, after a model on another route is picked and before anything is applied: the new conversation and the handoff note are named, with Keep this conversation and Change route. |
| `herdr-{light,dark}.png` | Herdr's interim state: its agents and models are shown, clearly labelled `Not available yet`, until #1007/RFC 0030 wires the terminal. |

The screenshots carry no token, machine name or filesystem path.
