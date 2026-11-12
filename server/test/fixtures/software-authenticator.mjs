// In-memory ES256 software authenticator: fresh keys, COSE, RP hashes, UV and counters.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { isoCBOR } from '@simplewebauthn/server/helpers'
const sha = value => createHash('sha256').update(value).digest()
const b64 = value => Buffer.from(value).toString('base64url')
export class SoftwareAuthenticator {
  constructor() { this.key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); this.id = b64(randomBytes(32)); this.counter = 0 }
  register(options, origin, { uv = true, rpID = options.rp.id, challenge = options.challenge, crossOrigin = false } = {}) {
    this.userID = options.user.id; this.rpID = rpID
    const jwk = this.key.publicKey.export({ format: 'jwk' })
    const publicKey = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]))
    const id = Buffer.from(this.id, 'base64url'), length = Buffer.alloc(2); length.writeUInt16BE(id.length)
    const authData = Buffer.concat([sha(rpID), Buffer.from([0x41 | (uv ? 4 : 0)]), Buffer.alloc(4), Buffer.alloc(16), length, id, publicKey])
    return { id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {}, response: {
      clientDataJSON: b64(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin })),
      attestationObject: b64(isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))), transports: ['internal'],
    } }
  }
  authenticate(options, origin, { uv = true, rpID = this.rpID, challenge = options.challenge, crossOrigin = false, corrupt = false } = {}) {
    const count = Buffer.alloc(4); count.writeUInt32BE(++this.counter)
    const authData = Buffer.concat([sha(rpID), Buffer.from([1 | (uv ? 4 : 0)]), count])
    const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin }))
    const signature = sign('sha256', Buffer.concat([authData, sha(client)]), this.key.privateKey)
    if (corrupt) signature[signature.length - 1] ^= 1
    return { id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {}, response: {
      authenticatorData: b64(authData), clientDataJSON: b64(client), signature: b64(signature), userHandle: this.userID,
    } }
  }
}
