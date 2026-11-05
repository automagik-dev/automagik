// The framed stdio between Electron and dsh-launch (RFC 0016, "Electron to DSH"; the contract is
// wslc/README.md). One frame is one JSON object on one line, ended by "\n". Every frame carries
// `v`, the protocol's major version (an integer), and `type`. Lines are pure ASCII: anything
// past U+007F is written as a \u escape, so a channel that is not byte-clean (WSLC's process
// stdio is unverified) still carries them, and a stray "\r" before the "\n" is dropped on read.
// A newline ends every frame, so a reader never loses its place in the stream.

export const PROTOCOL = 1
// The longest frame either side may send, its "\n" included.
export const MAX_FRAME = 1024 * 1024
// The most raw bytes one tunnel `data` frame carries (base64 makes it 4/3 as long).
export const MAX_CHUNK = 48 * 1024
export const MAX_CHUNK_BASE64 = Math.ceil(MAX_CHUNK / 3) * 4

export class FrameError extends Error {
  constructor(message) {
    super(message)
    this.code = 'EFRAME'
  }
}

const ascii = text => text.replace(/[\u0080-￿]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)

/** One frame as its line: `{ v, type, ... }`. Throws a FrameError when it would pass MAX_FRAME. */
export function encode(frame) {
  if (!frame || typeof frame.type !== 'string') throw new FrameError('a frame needs a type')
  const line = `${ascii(JSON.stringify({ v: PROTOCOL, ...frame }))}\n`
  if (line.length > MAX_FRAME) throw new FrameError(`a ${frame.type} frame of ${line.length} bytes passes the ${MAX_FRAME}-byte limit`)
  return line
}

/** A line's frame, or a FrameError: not JSON, not an object, no type, or another major version. */
export function decode(line) {
  let frame
  try { frame = JSON.parse(line) } catch { throw new FrameError('a line is not JSON') }
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new FrameError('a frame is not an object')
  if (frame.v !== PROTOCOL) throw new FrameError(`a frame of protocol ${JSON.stringify(frame.v)}, not ${PROTOCOL}`)
  if (typeof frame.type !== 'string' || frame.type === '') throw new FrameError('a frame has no type')
  return frame
}

/**
 * Reads frames from a byte stream's chunks. `onFrame(frame)` gets each one; `onError(error)` gets
 * the first FrameError (a line past MAX_FRAME, a line that is no frame), after which it reads no
 * more: a reader that cannot trust its input stops.
 */
export class FrameReader {
  // Bytes, not text: a chunk may end inside a character, and the limit counts bytes.
  #pending = Buffer.alloc(0)
  #failed = false
  constructor(onFrame, onError) {
    this.onFrame = onFrame
    this.onError = onError
  }

  push(chunk) {
    if (this.#failed) return
    this.#pending = Buffer.concat([this.#pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
    let end
    while (!this.#failed && (end = this.#pending.indexOf(0x0a)) !== -1) {
      if (end + 1 > MAX_FRAME) return this.#fail(new FrameError(`a line of ${end + 1} bytes passes the ${MAX_FRAME}-byte limit`))
      const line = this.#pending.subarray(0, end).toString('utf8').replace(/\r$/, '')
      this.#pending = this.#pending.subarray(end + 1)
      if (line === '') continue
      let frame
      try { frame = decode(line) } catch (error) { return this.#fail(error) }
      this.onFrame(frame)
    }
    if (this.#pending.length >= MAX_FRAME) this.#fail(new FrameError(`a line passes the ${MAX_FRAME}-byte limit`))
  }

  /** The stream ended: a last line with no "\n" is no frame. */
  end() {
    if (!this.#failed && this.#pending.toString('utf8').trim() !== '') this.#fail(new FrameError('the stream ended inside a frame'))
  }

  #fail(error) {
    this.#failed = true
    this.#pending = Buffer.alloc(0)
    this.onError(error)
  }
}

/**
 * Writes frames to `stream` (the launcher's stdout). `send` answers false once the stream's
 * buffer is full; `onDrain` listeners run when it empties, so a tunnel can pause its socket.
 * Throws a FrameError for a frame past MAX_FRAME; nothing is written then.
 */
export class FrameWriter {
  #stream
  #drains = new Set()
  constructor(stream) {
    this.#stream = stream
    stream.on('drain', () => { for (const listener of [...this.#drains]) listener() })
  }

  send(frame) {
    return this.#stream.write(encode(frame))
  }

  onDrain(listener) {
    this.#drains.add(listener)
    return () => this.#drains.delete(listener)
  }
}
