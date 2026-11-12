// Read the published CSS expressions: rc.2 minifies whitespace and uses template literals.
// Asset URLs do not affect these layout fixtures.
import { runInNewContext } from 'node:vm'

export const nativeCss = bundle => [...bundle.matchAll(/\bconst css(?:\$\w+)?\s*=\s*([\s\S]*?);\s*const tagId/g)]
  .map(match => runInNewContext(match[1], { require: { asset: () => '' } }))
