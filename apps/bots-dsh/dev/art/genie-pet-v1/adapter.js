// Genie's Codex-format v1 atlas (spritesheet.webp, built by dev/art/clay-kit.py), read by the
// team's mark states (src/client/mark.js STATES). Not wired into the app yet: the marks show
// Genie's still faces (src/client/clay-art.js) and move them with CSS. This is the map a
// sprite player would use.
export const CELL = Object.freeze({ width: 192, height: 208, columns: 8 })
// Row index and frame count, in the atlas's order.
export const ROWS = Object.freeze({
  idle: [0, 6], 'running-right': [1, 8], 'running-left': [2, 8], waving: [3, 4], jumping: [4, 5],
  failed: [5, 8], waiting: [6, 6], running: [7, 6], review: [8, 6],
})

// The team's states: work runs (searching reads and checks, so it reviews); a question or an
// approval waits for the person; work handed on is a quiet wait (idle); the settle after a
// run is one jump; a poke waves. The team has no failed Bot state; `failed` is for a caller
// that has one (a task that stopped with an error).
const ROW_OF_STATE = Object.freeze({
  idle: 'idle', thinking: 'running', searching: 'review', working: 'running', sending: 'running', orbit: 'running',
  waiting: 'idle', alert: 'waiting', done: 'jumping', poked: 'waving', failed: 'failed',
})
export const rowOf = state => ROW_OF_STATE[state] ?? 'idle'
// Rows that play once and hand back to the state's loop.
export const ONCE = Object.freeze(['waving', 'jumping'])

/** The background position of `frame` in `row`, for a cell drawn at `scale`. */
export function framePosition(row, frame, scale = 1) {
  const [index, count] = ROWS[row]
  return `${-(frame % count) * CELL.width * scale}px ${-index * CELL.height * scale}px`
}
