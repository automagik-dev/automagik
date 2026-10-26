// The keys the app trusts a lane's signature from (lane.js): a copy of the repository's
// plugin-lane/keys.json, which test/lane.test.js checks it still matches. Two at a time
// while a key is rotated.
export const LANE_KEYS = Object.freeze([
  Object.freeze({
    keyId: 'automagik-2026-10',
    publicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAxqwLF+rCCfBNkvXWTsTs/Pj9E56w4iBF5V46rxprXJk=\n-----END PUBLIC KEY-----\n',
  }),
])
