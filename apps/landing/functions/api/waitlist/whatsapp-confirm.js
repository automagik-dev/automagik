import { boundedBody, constantEqual, empty, hash, json, quota, reply, WHATSAPP_BACKLOG_SECONDS } from '../../../waitlist/lib/shared.js'

export function senderIdentity(from) {
  const sender = from.split('@')[0].trim()
  return { sender: /^[0-9]+$/.test(sender) ? `+${sender}` : sender, number: /^[0-9]+$/.test(sender) ? `+${sender}` : null }
}
export async function onRequest({ request, env }) {
  if (new URL(request.url).protocol !== 'https:') return empty(415)
  if (request.method !== 'POST') return empty(405)
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return empty(415)
  if (!env.WAITLIST_CONFIRM_SECRET) return empty(503)
  // Compare fixed-size digests in constant time, including when input lengths differ.
  const supplied = await hash(request.headers.get('Authorization') ?? '')
  const expected = await hash(`Bearer ${env.WAITLIST_CONFIRM_SECRET}`)
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
  const processingMs = Date.now()
  // Existing stored times and quota buckets use seconds; expiry guards use milliseconds.
  const processingSeconds = Math.floor(processingMs / 1000)
  const receivedAt = body.timestamp
  if (typeof receivedAt !== 'number' || !Number.isFinite(receivedAt) || receivedAt < 0 || receivedAt > processingMs + 120000) return empty(400)
  const expired = row => receivedAt > row.expires_at * 1000 || processingMs > (row.expires_at + WHATSAPP_BACKLOG_SECONDS) * 1000
  const digest = await hash(code)
  try {
    const db = env.WAITLIST_DB
    if (!db || env.WAITLIST_DATA_JURISDICTION !== 'eu') return empty(503)
    if (!await quota(db, `wa-callback:${Math.floor(processingSeconds / 60)}`, 60, processingSeconds + 120)) return empty(429)
    const previous = await db.prepare('SELECT confirmation_reply,whatsapp_sender,confirmation_hash,expires_at FROM waitlist WHERE message_id=? AND confirmed_at IS NOT NULL').bind(messageId).first()
    if (previous && expired(previous)) return json({ status: 'unknown_or_expired' }, 404)
    if (previous) return previous.whatsapp_sender === sender.sender && previous.confirmation_hash === digest ? json({ reply: previous.confirmation_reply }) : json({ status: 'already_confirmed' }, 409)
    const row = await db.prepare("SELECT id,confirmed_at,expires_at,language FROM waitlist WHERE confirmation_hash=? AND channel='whatsapp'").bind(digest).first()
    if (!row || expired(row)) return json({ status: 'unknown_or_expired' }, 404)
    if (row.confirmed_at !== null) return json({ status: 'already_confirmed' }, 409)
    const text = reply(row.language)
    // This conditional write is the single-use boundary across concurrent callbacks.
    const changed = await db.prepare('UPDATE waitlist SET confirmed_at=?,whatsapp_number=?,whatsapp_sender=?,message_id=?,confirmation_reply=?,received_at=? WHERE id=? AND confirmed_at IS NULL AND expires_at*1000>=? AND (expires_at+?)*1000>=? RETURNING id').bind(processingSeconds, sender.number, sender.sender, messageId, text, receivedAt, row.id, receivedAt, WHATSAPP_BACKLOG_SECONDS, processingMs).first()
    if (changed) return json({ reply: text })
    const retried = await db.prepare('SELECT confirmation_reply,whatsapp_sender,confirmation_hash,expires_at FROM waitlist WHERE message_id=? AND confirmed_at IS NOT NULL').bind(messageId).first()
    if (retried && expired(retried)) return json({ status: 'unknown_or_expired' }, 404)
    if (retried) return retried.whatsapp_sender === sender.sender && retried.confirmation_hash === digest ? json({ reply: retried.confirmation_reply }) : json({ status: 'already_confirmed' }, 409)
    const raced = await db.prepare('SELECT confirmed_at,expires_at FROM waitlist WHERE id=?').bind(row.id).first()
    if (!raced || expired(raced)) return json({ status: 'unknown_or_expired' }, 404)
    return json({ status: 'already_confirmed' }, 409)
  } catch (error) {
    // Simultaneous callbacks on different codes can race for one unique message_id.
    if (String(error?.message).includes('UNIQUE constraint failed: waitlist.message_id')) {
      try {
        const previous = await env.WAITLIST_DB.prepare('SELECT confirmation_reply,whatsapp_sender,confirmation_hash,expires_at FROM waitlist WHERE message_id=? AND confirmed_at IS NOT NULL').bind(messageId).first()
        if (previous && expired(previous)) return json({ status: 'unknown_or_expired' }, 404)
        if (previous) return previous.whatsapp_sender === sender.sender && previous.confirmation_hash === digest ? json({ reply: previous.confirmation_reply }) : json({ status: 'already_confirmed' }, 409)
      } catch { /* store is down */ }
    }
    return empty(503)
  }
}
