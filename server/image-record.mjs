#!/usr/bin/env node
// The release's own record of the server image that was pushed for it (RFC 0024 (g) and
// delivery 4's acceptance; issue #910): `server-image.json`, an asset of the content release.
// A workspace pins the image by the digest in that record, never by `:latest` or another tag.
//
// The record is written only from what the push itself printed: the manifest digest, the
// registry name, the content release, the workflow commit and the tag. Anything that is not
// exactly a sha256 manifest digest, a release version or a full commit is refused, so a bad
// push can never leave a record that names a tag or an empty digest.
//
//   node server/image-record.mjs write --image ghcr.io/o/n --digest sha256:… --version 3.93.0 \
//     --revision <40 hex> --tag 3.93.0-<8 hex> [--out server-image.json]
//   node server/image-record.mjs check <file> --digest sha256:…   (the posted asset, read back)
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The asset's name on the release; desktop-build.yml's asset sweep spares it by this name. */
export const RECORD_ASSET = 'server-image.json'
export const RECORD_SCHEMA = 1
const DIGEST = /^sha256:[0-9a-f]{64}$/
const IMAGE = /^[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._-]+)+$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const REVISION = /^[0-9a-f]{40}$/
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/

/** The record for one pushed image; throws on any field that is not what a push produces. */
export function imageRecord({ image, digest, version, revision, tag }) {
  if (!DIGEST.test(digest ?? '')) throw new Error('the digest must be sha256:<64 hex>, the manifest digest the push printed')
  if (!IMAGE.test(image ?? '')) throw new Error('the image must be a registry name without a tag or digest')
  if (!VERSION.test(version ?? '')) throw new Error('the version must be the content release, without its v')
  if (!REVISION.test(revision ?? '')) throw new Error('the revision must be the full workflow commit')
  if (!TAG.test(tag ?? '') || tag === 'latest') throw new Error('the tag must be the pushed :<content>-<short sha> tag')
  if (tag !== `${version}-${revision.slice(0, 8)}`) throw new Error('the tag must be <version>-<the first 8 of the revision>')
  return { schema: RECORD_SCHEMA, image, digest, ref: `${image}@${digest}`, version, revision, tag }
}

/** Read a record back: the same checks, and `ref` must be the image at that digest. */
export function parseRecord(text) {
  const value = JSON.parse(text)
  if (value?.schema !== RECORD_SCHEMA) throw new Error(`unknown record schema ${value?.schema}`)
  const record = imageRecord(value)
  if (value.ref !== record.ref) throw new Error('the record ref is not its image at its digest')
  return record
}

function argsOf(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) { args._.push(name); continue }
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`${name} needs a value`)
    args[name.slice(2)] = value
    index += 1
  }
  return args
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = argsOf(process.argv.slice(2))
    const [command, file] = args._
    if (command === 'write') {
      const record = imageRecord(args)
      const out = args.out ?? RECORD_ASSET
      writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`)
      console.log(`[image-record] ${out}: ${record.ref}`)
    } else if (command === 'check' && file) {
      const record = parseRecord(readFileSync(file, 'utf8'))
      if (record.digest !== args.digest) throw new Error(`the release records ${record.digest}, not the pushed ${args.digest}`)
      console.log(`[image-record] the release records ${record.ref}`)
    } else {
      throw new Error('usage: node server/image-record.mjs write --image … --digest … --version … --revision … --tag … [--out <file>]\n'
        + '       node server/image-record.mjs check <file> --digest …')
    }
  } catch (error) {
    console.error(`[image-record] FAILED: ${error?.message ?? error}`)
    process.exitCode = 1
  }
}
