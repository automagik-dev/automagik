import { createElement as h, useEffect, useState } from 'react'
import { Switch } from './bot-settings.js'
import { t } from './i18n.js'

// -------------------------------------------------------------------------
// The Privacy page: Automagik is local first and a friend of privacy, so nothing that could
// train a model leaves this computer unless the person switches it on, and nothing goes to
// Namastex. Each share below is one switch saying who receives what; the two that are training
// data start off, the rest work as their makers ship them (the desktop app applies
// the choices at its next launch: apps/desktop src/privacy.js). The AI a chat runs on still
// gets that chat, the way any message reaches the one it is sent to; that is not a share.

export const SHARES = Object.freeze([
  {
    key: 'deepseek-session-log',
    title: 'Share my chats with DeepSeek to improve their models',
    to: 'DeepSeek (api.deepseek.com)',
    data: 'With every request to a DeepSeek model: the whole chat so far (your messages, the Bot\'s replies, tool results), the folder it works in, and the list of plugins you have installed.',
  },
  {
    key: 'deepseek-feedback',
    title: 'Send a chat to DeepSeek when I rate a reply',
    to: 'DeepSeek\'s telemetry service (dsh-otel-collector.deepseeksvc.com)',
    data: 'When you rate a message or use /feedback: the whole chat, with an anonymous id, the app\'s version and your rating, whatever model the chat used.',
  },
  {
    key: 'claude-errors',
    title: 'Send Claude Code\'s error reports to Anthropic',
    to: 'Anthropic',
    data: 'When Claude Code runs into an error: what went wrong, the Claude Code version and your system. Also lets Claude Code check for its own updates.',
  },
  {
    key: 'spellcheck',
    title: 'Download spellcheck dictionaries',
    to: 'Google',
    data: 'On Linux and Windows: a request for your language\'s dictionary, which tells Google your language and network address, never your text. On a Mac spelling is checked locally, so this changes nothing there.',
  },
  {
    key: 'stable-id',
    title: 'Keep the same anonymous id for DeepSeek',
    to: 'DeepSeek',
    data: 'DeepSeek requests always carry an anonymous id, which no setting removes. It stays the same across launches, as in DSH. Switched off, Automagik makes a new one every time it starts; DeepSeek still knows your account from your key or sign-in.',
  },
])

export function PrivacyPage({ actions, run, Section, Row }) {
  const [view, setView] = useState(null)
  const [changed, setChanged] = useState(false)
  useEffect(() => { void run(actions.privacy().then(setView)) }, [])
  const set = (key, on) => run(actions.privacySet(key, on).then((next) => { setView(next); setChanged(true) }))
  const managed = view?.managed === true
  // Unfold's own instance: Unfold's Privacy settings decide what is shared, so nothing here can
  // turn a share on.
  if (view?.host === 'unfold') {
    return h('div', { className: 'bt-privacy' },
      h(Section, { title: t('Local first') },
        h('div', { className: 'bt-privacy-intro' },
          h('p', null, t('Your Bots, chats, memory and files stay on this computer. Uploads are off here, and nothing on this page can turn one on.')))),
      h(Section, { title: t('What is shared') },
        h(Row, { label: t('Unfold\'s Privacy controls this'), hint: t('To see or change what is shared, open Unfold\'s settings.') })))
  }
  return h('div', { className: 'bt-privacy' },
    h(Section, { title: t('Local first') },
      h('div', { className: 'bt-privacy-intro' },
        h('p', null, t('Your Bots, chats, memory and files stay on this computer. Nothing that could train a model leaves it unless you switch it on below, and nothing at all goes to us at Namastex: no analytics, no usage counts, no crash reports.')),
        h('p', null, t('The AI a chat runs on receives that chat, the way any message reaches the one it is sent to. Sharing your chats for training is off. The tools you use keep their own features, like Claude Code\'s error reports and updates; you can switch those off here too.')))),
    h(Section, { title: t('What you can choose to share') },
      !view ? h(Row, { label: t('Loading…') })
        : !managed ? h(Row, { label: t('Privacy is set by the Automagik desktop app'), hint: t('Open these settings in the Automagik app to change what it shares.') })
          : SHARES.map(share => h(Row, {
            key: share.key,
            label: t(share.title),
            hint: h('span', { className: 'bt-privacy-hint' },
              h('span', null, h('b', null, t('Goes to')), ` ${t(share.to)}`),
              h('span', null, h('b', null, t('What')), ` ${t(share.data)}`)),
          }, h(Switch, { on: view.share[share.key] === true, label: t(share.title), onChange: on => set(share.key, on) })))),
    changed ? h('p', { className: 'bt-privacy-note', role: 'status' }, t('Applies the next time Automagik starts.')) : null)
}

export const PRIVACY_CSS = `
.bt-privacy-intro{display:flex;flex-direction:column;gap:8px;padding:12px 14px;font-size:14px;line-height:20px}
.bt-privacy-intro p{margin:0}
.bt-privacy-hint{display:flex;flex-direction:column;gap:2px}
.bt-privacy-hint b{font-weight:600;color:var(--bt-ink)}
.bt-privacy-note{margin:8px 2px 0;font-size:12px;line-height:16px;color:var(--bt-ink-2)}
`
