# Route-first selector and the one-row chat bar: screenshots

Captured from a running Automagik desktop build carrying this branch, in a Bot's real chat
(`Selector`), with the repository's English scripted model. Light and dark are the app's own
theme (`prefers-color-scheme` through DSH's theme preference), not a recolored mockup.

| Screenshot | What it shows |
|---|---|
| `bar-{light,dark}.png` | The one-row composer bar: `+`, the always-visible permission chip (shield and level in the accent ink), then on the right the model (one plain line: route mark, name, muted effort, chevron), the mic and the round voice button. No box, no second line, no tile. |
| `plus-menu-{light,dark}.png` | The `+` menu as one list: an icon, the action's name and its muted description on the same line. |
| `permission-menu-{light,dark}.png` | The permission chip's explained levels, saved through the same path as Details. |
| `route-{light,dark}.png` | The approved selector's first level: Native, ACP and Herdr, in that order, with the current route marked and ACP's full expansion. The menu opens from the bar's model button and anchors above it. |
| `native-models-{light,dark}.png` | Native's models, one list under their provider; the Bot's model is ticked. |
| `acp-agents-{light,dark}.png` | ACP's second level: Claude Code and Codex with their own marks, then Hermes, Antigravity and omp dimmed and `Not available yet` until #973 serves them. |
| `acp-models-{light,dark}.png` | One ACP agent's models, reached after the agent. |
| `route-confirm-{light,dark}.png` | The crossing, after a model on another route is picked and before anything is applied. For a Full access Bot, the last line says what Full access means on the route it is moving to; this shot is ACP Claude Code → Native, so it names DSH's own tools. |
| `herdr-{light,dark}.png` | Herdr's interim state: its agents shown with their marks, dimmed and `Not available yet`, with no chevrons, until #1007/RFC 0030 wires the terminal. |

The small route mark before the model name is the open point proposed for the owner: it is in
these shots so he can say yes or no without opening the menu.

The sample team is English throughout. The screenshots carry no token, machine name or
filesystem path.
