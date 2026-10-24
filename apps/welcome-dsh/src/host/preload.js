// The product the Automagik desktop app was opened for: `omni desktop` starts it with Omni
// preloaded, `genie desktop` with Genie (apps/desktop src/dsh.js preloadOf), and the app hands
// it to DSH as AUTOMAGIK_PRELOAD. The team step lists that one first and starts with it
// chosen. Anything else, or nothing, is no preference.
import { z } from 'zod'

export const PRELOADS = Object.freeze(['omni', 'genie'])
const Preload = z.string().trim().toLowerCase().pipe(z.enum(PRELOADS))

/** 'omni', 'genie', or null for none. */
export function preloadOf(env = process.env) {
  const parsed = Preload.safeParse(env?.AUTOMAGIK_PRELOAD)
  return parsed.success ? parsed.data : null
}
