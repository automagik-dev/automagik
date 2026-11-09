// The agent-image helpers: which calls are image calls, where their PNG comes from, and the
// scrubber that takes the agent's links to its locally saved images out of its streamed reply.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentImageOf, ImageLinks, isImageCall, savedPathsOf, scrubImageLinks } from '../src/host/agent-image.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('an image call is known by its title, and its PNG comes from its update, never its saved file', () => {
  assert.equal(isImageCall({ title: 'Image generation' }), true)
  assert.equal(isImageCall({ title: 'Generate image' }), true)
  assert.equal(isImageCall({ title: 'Run ls', structuredName: 'Bash' }), false)
  const saved = '/home/me/.codex/generated_images/a.png'
  assert.equal(agentImageOf({ title: 'Image generation', content: [{ type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png', uri: saved } }] }), PNG)
  // A block that is not a PNG is not taken.
  assert.equal(agentImageOf({ title: 'Image generation', content: [{ type: 'image', data: PNG, mimeType: 'image/jpeg' }] }), undefined)
  assert.equal(agentImageOf({ title: 'Image generation', content: [], rawOutput: { result: PNG, savedPath: saved } }), PNG)
  // Another call's image is not one the agent made: neither its raw output nor its image block.
  assert.equal(agentImageOf({ title: 'Run', content: [], rawOutput: { result: PNG } }), undefined)
  assert.equal(agentImageOf({ title: 'Read', content: [{ type: 'image', data: PNG, mimeType: 'image/png' }] }), undefined)
  const generate = { title: 'Image generation' }
  assert.deepEqual(savedPathsOf([
    { ...generate, rawOutput: { savedPath: saved } },
    { ...generate, content: [{ type: 'content', content: { type: 'image', uri: '/tmp/x.png' } }] },
    { title: 'Read', content: [{ type: 'image', uri: '/home/me/photo.png' }] },
  ]), [saved, '/tmp/x.png'])
})

test('links to the agent\'s saved images leave the reply; other links stay', () => {
  const at = '/home/me/.codex/generated_images/019a/ig_1.png'
  assert.equal(scrubImageLinks(`Here: ![a fox](${at}) done`), 'Here:  done')
  assert.equal(scrubImageLinks(`See [the fox](${at}).`), 'See the fox.')
  assert.equal(scrubImageLinks(`See [${at}](${at}).`), 'See the image.')
  assert.equal(scrubImageLinks(`Saved to \`${at}\`.`), 'Saved to `the image`.')
  assert.equal(scrubImageLinks('![w](C:\\Users\\me\\.codex\\generated_images\\a.png)'), '')
  assert.equal(scrubImageLinks('![w](file:///home/me/.codex/generated_images/a.png)x'), 'x')
  // A path the agent's own call reported is ours wherever it is.
  assert.equal(scrubImageLinks('![w](/tmp/out/a.png)', ['/tmp/out/a.png']), '')
  // Other links and URLs are the agent's to give.
  for (const kept of ['![w](/repo/docs/a.png)', '[site](https://example.com/generated_images/a.png)', 'https://example.com/generated_images/a.png', '[1] a note']) {
    assert.equal(scrubImageLinks(kept), kept)
  }
})

test('the streamed reply holds a link until it is whole, wherever the chunks split it', () => {
  const reply = 'Here it is: ![a fox](/home/me/.codex/generated_images/a.png) and `~/.codex/generated_images/b.png`. Bye [1] now.'
  const expected = 'Here it is:  and `the image`. Bye [1] now.'
  for (let size = 1; size <= reply.length; size++) {
    const links = new ImageLinks()
    let out = ''
    for (let at = 0; at < reply.length; at += size) out += links.push(reply.slice(at, at + size))
    out += links.flush()
    assert.equal(out, expected, `chunks of ${size}`)
  }
  // Plain words go out at once; only a pending link or path waits.
  const links = new ImageLinks()
  assert.equal(links.push('Hello there '), 'Hello there ')
  assert.equal(links.push('![a'), '')
  assert.equal(links.flush(), '![a')
})
