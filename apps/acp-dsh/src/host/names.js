// Names that cross a process or a provider boundary, kept in one module so the bridge, the
// back-channel and the adapter cannot drift apart on them (RFC 0003, amendment, "The bridge").
// The server name is a contract: a Claude Code allow rule reads `mcp__dsh__*`.
export const BRIDGE_NAME = 'dsh'
export const CREDENTIAL_ENV = 'DSH_BRIDGE_CREDENTIAL'
export const URL_ENV = 'DSH_BRIDGE_URL'
// The source marker of the tool-call block a bridge call adds for Auto review only. It keeps
// that block out of provider history: the surface replaces it, and replay skips it.
export const SYNTHETIC_KIND = 'acp-bridge'

/** The structured tool name an MCP server's tool gets in the agent. */
export const mcpName = (server, tool) => `mcp__${server}__${tool}`

/** Whether a structured tool name belongs to the bridge. */
export const isBridgeName = (name, server = BRIDGE_NAME) => typeof name === 'string' && name.startsWith(`mcp__${server}__`)
