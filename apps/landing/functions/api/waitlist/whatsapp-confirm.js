import { boundedBody, constantEqual, empty, hash, json, now, quota, reply } from '../../../waitlist/lib/shared.js'

export function senderIdentity(from) {
  const sender = from.split('@')[0].trim()
  return { sender: /^[0-9]+$/.test(sender) ? `+${sender}` : sender, number: /^[0-9]+$/.test(sender) ? `+${sender}` : null }
}
export async function onRequest({ request, env }) {
  if (new URL(request.url).protocol !== 'https:') return empty(415)
  if (request.method !== 'POST') return empty(405)
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return empty(415)
  if (!env.OMNI_WAITLIST_SECRET) return empty(503)
  // Compare fixed-size digests in constant time, including when input lengths differ.
  const supplied = await hash(request.headers.get('Authorization') ?? '')
  const expected = await hash(`Bearer ${env.OMNI_WAITLIST_SECRET}`)
  if (!constantEqual(supplied, expected)) return empty(401)
  let body
  try { body = JSON.parse(await boundedBody(request, 32768)) } catch { return empty(400) }
  const payload = body?.payload
  if (body?.type !== 'message.received' || !payload || typeof payload.content?.text !== 'string' || typeof payload.from !== 'string' || !payload.from.split('@')[0].trim() || payload.from.length > 256 || typeof payload.externalId !== 'string' || !payload.externalId.trim() || payload.externalId.length > 256) return empty(400)
  // The raw event, message text and sender name are never retained or logged.
  const code = payload.content.text.match(/\bAMG-[0-9A-HJKMNP-TV-Z]{6}\b/i)?.[0].toUpperCase()
  if (!code) return json({ status: 'unknown_or_expired' }, 404)
  const messageId = payload.externalId
  const sender = senderIdentity(payload.from)
  const receivedAt = typeof body.timestamp === 'number' && Number.isFinite(body.timestamp) ? body.timestamp : null
  const digest = await hash(code)
  const time = now()
  try {
    const db = env.WAITLIST_DB
    if (!db || env.WAITLIST_DATA_JURISDICTION !== 'eu') return empty(503)
    if (!await quota(db, `wa-callback:${Math.floor(time / 60)}`, 60, time + 120)) return empty(429)
    const previous = await db.prepare('SELECT confirmation_reply,whatsapp_sender,confirmation_hash FROM waitlist WHERE message_id=? AND confirmed_at IS NOT NULL').bind(messageId).first()
    if (previous) return previous.whatsapp_sender === sender.sender && previous.confirmation_hash === digest ? json({ reply: previous.confirmation_reply }) : json({ status: 'already_confirmed' }, 409)
    const row = await db.prepare("SELECT id,confirmed_at,expires_at,language FROM waitlist WHERE confirmation_hash=? AND channel='whatsapp'").bind(digest).first()
    if (!row || row.expires_at <= time) return json({ status: 'unknown_or_expired' }, 404)
    if (row.confirmed_at !== null) return json({ status: 'already_confirmed' }, 409)
    const text = reply(row.language)
    // This conditional write is the single-use boundary across concurrent callbacks.
    const changed = await db.prepare('UPDATE waitlist SET confirmed_at=?,whatsapp_number=?,whatsapp_sender=?,message_id=?,confirmation_reply=?,received_at=? WHERE id=? AND confirmed_at IS NULL AND expires_at>? RETURNING id').bind(time, sender.number, sender.sender, messageId, text, receivedAt, row.id, time).first()
    if (changed) return json({ reply: text })
    const retried = await db.prepare('SELECT confirmation_reply,whatsapp_sender,confirmation_hash FROM waitlist WHERE message_id=? AND confirmed_at IS NOT NULL').bind(messageId).first()
    if (retried) return retried.whatsapp_sender === sender.sender && retried.confirmation_hash === digest ? json({ reply: retried.confirmation_reply }) : json({ status: 'already_confirmed' }, 409)
    const raced = await db.prepare('SELECT confirmed_at,expires_at FROM waitlist WHERE id=?').bind(row.id).first()
    if (!raced || raced.expires_at <= time) return json({ status: 'unknown_or_expired' }, 404)
    return json({ status: 'already_confirmed' }, 409)
  } catch (error) {
    // Simultaneous callbacks on different codes can race for one unique message_id.
    if (String(error?.message).includes('UNIQUE constraint failed: waitlist.message_id')) {
      try {
        const previous = await env.WAITLIST_DB.prepare('SELECT confirmation_reply,whatsapp_sender,confirmation_hash FROM waitlist WHERE message_id=? AND confirmed_at IS NOT NULL').bind(messageId).first()
        if (previous) return previous.whatsapp_sender === sender.sender && previous.confirmation_hash === digest ? json({ reply: previous.confirmation_reply }) : json({ status: 'already_confirmed' }, 409)
      } catch { /* store is down */ }
    }
    return empty(503)
  }
}
