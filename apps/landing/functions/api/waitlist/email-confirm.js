import { htmlPage, privacyNote } from '../../../waitlist/lib/ui.js'
// GET only displays a form. Email scanners cannot consume the token by opening the link.
export function onRequest({ request }) {
  if (request.method !== 'GET') return htmlPage('Method not allowed', '', 405)
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!/^[0-9a-f]{64}$/.test(token)) return htmlPage('This link is unavailable', '', 400)
  return htmlPage('Confirm your interest in Cloud', `<p>Confirm that you asked to register your interest. No other email will be sent.</p><form method="post" action="/api/waitlist"><input type="hidden" name="action" value="confirm"><input type="hidden" name="token" value="${token}"><button class="button primary" type="submit">Confirm my interest</button></form>` + privacyNote())
}
