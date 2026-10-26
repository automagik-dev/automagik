import { createElement as h, useEffect, useRef, useState } from 'react'
import { PetSprite } from './pet.js'
import { bakeBlobs, canBake } from './pet-bake.js'
import { petOf, servedPet } from './mark.js'
import { t } from './i18n.js'

// -------------------------------------------------------------------------
// The avatar editor's Pets tab, where it opens: the pets on this computer (Genie, those the
// team installed, and Codex's own from ~/.codex/pets), then codex-pets.net to search, its
// most liked first. Picking a pet from there keeps a copy with the team (pets.js), so the
// Bot never needs the network to wear it. The page asks codex-pets.net only while this tab
// is open. "Use in Codex" puts the Bot's look in Codex's pet picker, as Codex's own format.

const SORTS = [['popular', 'Most liked'], ['new', 'Newest'], ['views', 'Most viewed'], ['random', 'Surprise me']]
const sourceLabel = { builtin: 'Automagik', team: 'This team', codex: 'From Codex' }
const slug = text => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bot'

async function put(url, blob) {
  const response = await fetch(url, { method: 'PUT', body: blob, headers: { 'content-type': 'image/webp' } })
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(answer.error ?? t('Codex\'s pets folder could not be written'))
  return answer
}

/** Writes the Bot's look to ~/.codex/pets as a Codex pet: its own pet's sheet, else its character baked. */
export async function toCodex(bot, look) {
  const id = `automagik-${slug(bot.name)}`
  const query = part => `api/omni-ui/pet-codex?${new URLSearchParams({ id, name: bot.name, description: bot.role ?? '', ...(part ? { part } : {}) })}`
  let sheet
  let sleep
  const wants = petOf(bot, look, { live: true, size: 64 })
  if (wants?.served) {
    const served = servedPet(wants.served)
    sheet = await (await fetch(served.sheet)).blob()
    sleep = served.sleep ? await (await fetch(served.sleep)).blob() : undefined
  } else if (wants?.bake) {
    ({ sheet, sleep } = await bakeBlobs(wants.bake, 1))
  } else {
    throw new Error(t('A photo is not a pet: pick a character or a pet first.'))
  }
  await put(query(), sheet)
  if (sleep) await put(query('sleep'), sleep)
  return id
}

function LocalPet({ pet, chosen, onPick }) {
  return h('button', { type: 'button', className: 'bt-pet-pick', 'aria-pressed': chosen, title: pet.description || pet.name, onClick: onPick },
    h(PetSprite, { pet: servedPet(pet), size: 56 }),
    h('span', { className: 'bt-pet-name' }, pet.name),
    h('span', { className: 'bt-pet-from' }, t(sourceLabel[pet.source] ?? pet.source)))
}

function MarketPet({ pet, busy, onPick }) {
  return h('button', { type: 'button', className: 'bt-pet-pick', disabled: busy, 'aria-busy': busy || undefined, title: pet.description || pet.name, onClick: onPick },
    pet.poster ? h('img', { className: 'bt-pet-poster', src: pet.poster, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', draggable: false }) : h('span', { className: 'bt-pet-poster' }),
    h('span', { className: 'bt-pet-name' }, pet.name),
    h('span', { className: 'bt-pet-from' }, pet.by ? t('by {name}', { name: pet.by }) : 'codex-pets.net'))
}

export function PetsTab({ bot, look, actions, run }) {
  const [local, setLocal] = useState(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('popular')
  const [market, setMarket] = useState({ pets: [], page: 0, pages: 1, state: 'loading' })
  const [busy, setBusy] = useState('')
  const [codex, setCodex] = useState('')
  const asked = useRef(0)
  useEffect(() => { void actions.pets().then(setLocal, () => setLocal([])) }, [])
  const load = (page, reset) => {
    const ask = ++asked.current
    setMarket(state => ({ ...state, state: 'loading', ...(reset ? { pets: [] } : {}) }))
    actions.petsBrowse(query, page, sort).then((next) => {
      if (ask !== asked.current) return
      setMarket(state => ({ pets: reset ? next.pets : [...state.pets, ...next.pets], page: next.page, pages: next.pages, state: 'ready' }))
    }, () => { if (ask === asked.current) setMarket(state => ({ ...state, state: 'offline' })) })
  }
  useEffect(() => {
    const timer = setTimeout(() => load(1, true), query ? 350 : 0)
    return () => clearTimeout(timer)
  }, [query, sort])
  const pick = (source, id) => {
    setBusy(`${source}:${id}`)
    void run(actions.petUse(bot.id, source, id).then(() => actions.pets().then(setLocal)).finally(() => setBusy('')))
  }
  const sendToCodex = () => {
    setCodex('busy')
    toCodex(bot, look).then(id => setCodex(t('In Codex as {id}. Pick it in Codex\'s pet menu.', { id })), error => setCodex(error?.message ?? String(error)))
  }
  const worn = look.pet
  return h('div', { className: 'bt-pets' },
    h('div', { className: 'bt-pets-head' },
      h('span', { className: 'bt-pets-title' }, t('On this computer')),
      canBake() ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', disabled: codex === 'busy', onClick: sendToCodex, title: t('Copy this Bot\'s look into ~/.codex/pets') }, t('Use in Codex')) : null),
    codex && codex !== 'busy' ? h('p', { className: 'bt-pets-note', role: 'status' }, codex) : null,
    h('div', { className: 'bt-pets-grid' },
      local === null ? h('span', { className: 'bt-pets-note' }, t('Loading…'))
        : local.map(pet => h(LocalPet, { key: `${pet.source}:${pet.id}`, pet, chosen: worn?.source === pet.source && worn?.id === pet.id, onPick: () => pick(pet.source, pet.id) }))),
    h('div', { className: 'bt-pets-head' },
      h('span', { className: 'bt-pets-title' }, 'codex-pets.net'),
      h('select', { className: 'bt-input bt-pets-sort', value: sort, 'aria-label': t('Order'), onChange: event => setSort(event.target.value) },
        SORTS.map(([id, label]) => h('option', { key: id, value: id }, t(label))))),
    h('input', { className: 'bt-input bt-pets-search', type: 'search', value: query, placeholder: t('Search pets'), 'aria-label': t('Search pets'), onChange: event => setQuery(event.target.value) }),
    market.state === 'offline' && market.pets.length === 0 ? h('p', { className: 'bt-pets-note' }, t('codex-pets.net could not be reached.'))
      : h('div', { className: 'bt-pets-grid' },
        market.pets.map(pet => h(MarketPet, { key: pet.id, pet, busy: busy === `market:${pet.id}`, onPick: () => pick('market', pet.id) })),
        market.state === 'ready' && market.pets.length === 0 ? h('span', { className: 'bt-pets-note' }, t('No pets match.')) : null),
    market.state === 'ready' && market.page < market.pages ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm bt-pets-more', onClick: () => load(market.page + 1, false) }, t('More pets')) : null,
    h('p', { className: 'bt-pets-note' }, t('Pets on codex-pets.net are shared by its community, in the format Codex uses. Searching asks codex-pets.net; a pet you pick is kept on this computer.')))
}

export const PETS_CSS = `
.bt-pets{display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto;padding:2px}
.bt-pets-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}
.bt-pets-title{font:600 12px/16px var(--bt-font);color:var(--bt-ink-2)}
.bt-pets-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.bt-pet-pick{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px;border:1px solid transparent;border-radius:var(--st-r-menu,12px);background:transparent;color:var(--bt-ink);cursor:pointer;min-width:0}
.bt-pet-pick:hover:not(:disabled){background:color-mix(in srgb,var(--bt-ink) 6%,transparent)}
.bt-pet-pick[aria-pressed=true]{border-color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 8%,transparent)}
.bt-pet-pick[aria-busy]{opacity:.55}
.bt-pet-poster{display:block;width:56px;height:56px;object-fit:contain;border-radius:10px}
.bt-pet-name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 12px/16px var(--bt-font)}
.bt-pet-from{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11px/14px var(--bt-font);color:var(--bt-ink-2)}
.bt-pets-search{width:100%;min-height:32px;padding:6px 10px}
.bt-pets-sort{max-width:150px}
.bt-pets-more{align-self:center}
.bt-pets-note{margin:0;font-size:12px;line-height:16px;color:var(--bt-ink-2)}
`
