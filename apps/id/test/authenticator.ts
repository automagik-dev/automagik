import { createHash, generateKeyPairSync, sign } from 'node:crypto';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest();
const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64url');

// Minimal CBOR encoder for the WebAuthn none attestation and COSE EC2 public key.
function cbor(value: unknown): Buffer {
  const head = (major: number, length: number) => length < 24 ? Buffer.from([major * 32 + length]) :
    length < 256 ? Buffer.from([major * 32 + 24, length]) :
    Buffer.from([major * 32 + 25, length >> 8, length & 255]);
  if (typeof value === 'number') return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value);
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size),
    ...[...value].flatMap(([key, entry]) => [cbor(key), cbor(entry)])]);
  throw new Error('Unsupported CBOR value');
}

export class SoftwareAuthenticator {
  private keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  readonly id = hash(this.keys.publicKey.export({ type: 'spki', format: 'der' }));
  private counter = 0;
  private userHandle = '';

  register(options: { challenge: string; rp: { id: string }; user: { id: string } }, origin: string) {
    this.userHandle = options.user.id;
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const publicKey = cbor(new Map<unknown, unknown>([
      [1, 2], [3, -7], [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')],
    ]));
    const authData = Buffer.concat([
      hash(options.rp.id), Buffer.from([0x45]), Buffer.alloc(4), // UP, UV, attested credential
      Buffer.alloc(16), Buffer.from([0, this.id.length]), this.id, publicKey,
    ]);
    return {
      id: b64(this.id), rawId: b64(this.id), type: 'public-key',
      response: {
        clientDataJSON: b64(Buffer.from(JSON.stringify({
          type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false,
        }))),
        attestationObject: b64(cbor(new Map<unknown, unknown>([
          ['fmt', 'none'], ['attStmt', new Map()], ['authData', authData],
        ]))),
        transports: ['internal'],
      },
      clientExtensionResults: {}, authenticatorAttachment: 'platform',
    };
  }

  authenticate(options: { challenge: string; rpId: string }, origin: string) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(++this.counter);
    const authData = Buffer.concat([hash(options.rpId), Buffer.from([0x05]), count]);
    const clientData = Buffer.from(JSON.stringify({
      type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false,
    }));
    return {
      id: b64(this.id), rawId: b64(this.id), type: 'public-key',
      response: {
        clientDataJSON: b64(clientData), authenticatorData: b64(authData),
        signature: b64(sign('sha256', Buffer.concat([authData, hash(clientData)]), this.keys.privateKey)),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {}, authenticatorAttachment: 'platform',
    };
  }
}
