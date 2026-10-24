// Copied from apps/bots-dsh/src/client/clay-art.js (the pictures in art/ from
// apps/bots-dsh/src/client/art), not imported: this plugin installs on its own.
//
// Omni and Genie in clay: one row of seven faces each from the owner's clay kit (genie in
// 192x208 cells, omni in 192x192). CLAY_OMNI false puts the vector octopus (octopus.js
// OCTOPUS_SVG) back.
import { genieExpressions, lamp, omniExpressions } from './art/inline.js'

export const CLAY_OMNI = true
// The clay lamp a wish comes out of (the owner's kit), beside Genie's promise.
export const LAMP = lamp
export const FACES = Object.freeze(['calm', 'pleased', 'delighted', 'focused', 'curious', 'asleep', 'sad'])
export const faceAt = face => Math.max(0, FACES.indexOf(face))
export const CLAY_ART_CSS = `.oai-overlay{--oai-genie:url("${genieExpressions}");--oai-omni:url("${omniExpressions}")}`
