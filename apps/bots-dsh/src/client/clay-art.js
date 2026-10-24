import { genieExpressions, lamp, omniExpressions } from './art/inline.js'

// -------------------------------------------------------------------------
// Clay characters: Omni and Genie as the Automagik clay universe draws them, in place of the
// vector characters (characters.js) where the team shows them. Each is one row of seven
// faces from the owner's clay kit (dev/art/clay-kit.py): Genie in 192x208 cells, Omni in
// 192x192. CLAY_OMNI false puts the vector octopus back everywhere.
export const CLAY_OMNI = true
export const GENIE_ATLAS = genieExpressions
export const OMNI_ATLAS = omniExpressions
export const LAMP = lamp
export const FACES = Object.freeze(['calm', 'pleased', 'delighted', 'focused', 'curious', 'asleep', 'sad'])

// A mark's state (mark.js STATES: what the Bot is doing, from its Session and its work) as a
// face, the same for Omni and Genie. Work of every kind concentrates; `alert` (a question or
// an approval waits for the person) looks up, expectant; `waiting` (work it handed on has not
// come back) stays calm, the mark's sway says it waits; `done` (the settle after a run) is
// delighted. A poke is a greeting. Failure is sad and powered off is asleep: the team's marks
// have neither state, the welcome's Omni card has both.
const FACE_OF_STATE = Object.freeze({
  idle: 'calm',
  thinking: 'focused',
  searching: 'focused',
  working: 'focused',
  sending: 'focused',
  orbit: 'focused',
  waiting: 'calm',
  alert: 'curious',
  done: 'delighted',
  failed: 'sad',
  asleep: 'asleep',
})
export const faceOf = (state, poked = false) => (poked ? 'pleased' : FACE_OF_STATE[state] ?? 'calm')
export const faceAt = face => Math.max(0, FACES.indexOf(face))

/**
 * Which clay character draws a Bot, or null for its own look. A photo always wins. Genie is
 * the Bot of kind `genie` (a team member its own plugin adds); Omni is Omni's own look, the
 * octopus in Omni's colour (MAIN_LOOK, and the Omni Bot the welcome adds), so an octopus
 * someone recoloured stays the vector one they chose.
 */
export function clayArtOf(bot, look) {
  if (look?.image) return null
  if (bot?.kind === 'genie') return 'genie'
  if (CLAY_OMNI && look?.shape === 'octopus' && look?.color === 'deepseek') return 'omni'
  return null
}
