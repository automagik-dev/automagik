// The keys the app trusts each publisher's lane from (lane.js), by publisher: a key opens its
// own publisher's lane and no other. Automagik's are a copy of the repository's
// plugin-lane/keys.json, which test/lane.test.js checks they still match; Genie's are the genie
// repository's plugin-lane/keys.json. Two at a time while a key is rotated.
export const LANE_KEYS = Object.freeze({
  automagik: Object.freeze([
    Object.freeze({
      keyId: 'automagik-2026-10',
      publicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAxqwLF+rCCfBNkvXWTsTs/Pj9E56w4iBF5V46rxprXJk=\n-----END PUBLIC KEY-----\n',
    }),
  ]),
  genie: Object.freeze([
    Object.freeze({
      keyId: 'genie-2026-10',
      publicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtainfLoJoETaM9sW8di7ceVK0TfyFIEsvtfKKaal/aM=\n-----END PUBLIC KEY-----\n',
    }),
  ]),
})
