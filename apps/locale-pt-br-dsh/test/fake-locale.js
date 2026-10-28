// A stand-in for DSH's locale service (dsh-client-locale's LocaleRuntime) with the catalog DSH
// ships: en and zh only. It keeps the documented contract a language pack relies on, and no more:
// - addLanguage: the id is a BCP 47-style tag, not taken; its fallback is registered, and following
//   fallbacks ends at en. The browser's languages are matched again in order, each by full tag,
//   then by primary subtag.
// - register(ns, locale, dict): one dictionary per (namespace, locale), the locale a BCP 47 tag.
// - lookup: the active language's fallback chain in the namespace, then the same chain in
//   `common`, then the key itself.
const TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/

export function fakeLocale({ languages = [] } = {}) {
  const catalog = new Map([['en', { id: 'en', label: 'English' }], ['zh', { id: 'zh', label: '中文', fallback: 'en' }]])
  const dicts = new Map()
  const key = (id) => id.toLowerCase()
  const browser = () => {
    for (const tag of languages) {
      if (catalog.has(key(tag))) return catalog.get(key(tag)).id
      const primary = key(tag).split('-')[0]
      for (const entry of catalog.values()) if (key(entry.id).split('-')[0] === primary) return entry.id
    }
    return 'en'
  }
  let active = browser()
  const chain = (id) => {
    const out = []
    for (let at = catalog.get(key(id)); at; at = at.fallback ? catalog.get(key(at.fallback)) : undefined) {
      if (out.includes(at.id)) throw new Error(`locale "${id}" has a fallback cycle`)
      out.push(at.id)
    }
    return out
  }
  const lookup = (ns, k, params) => {
    for (const space of [ns, 'common']) {
      for (const id of chain(active)) {
        const text = dicts.get(`${space}\u0000${key(id)}`)?.[k]
        if (text !== undefined) return params ? text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m)) : text
      }
    }
    return k
  }
  const one = (ns, locale, dict) => {
    if (!TAG.test(locale)) throw new Error(`not a locale tag: ${locale}`)
    const slot = `${ns}\u0000${key(locale)}`
    if (dicts.has(slot)) throw new Error(`${ns} already has a ${locale} dictionary`)
    dicts.set(slot, { ...dict })
    return () => dicts.delete(slot)
  }
  return {
    calls: [],
    getLocale: () => ({ active, locales: [...catalog.values()] }),
    chain: () => chain(active),
    setLocale(id) {
      if (!catalog.has(key(id))) throw new Error(`unknown locale ${id}`)
      active = catalog.get(key(id)).id
    },
    addLanguage(input) {
      this.calls.push(['addLanguage', input])
      const { id, label, fallback } = input ?? {}
      if (typeof id !== 'string' || !TAG.test(id) || typeof label !== 'string' || !label || typeof fallback !== 'string') throw new Error('malformed language')
      if (catalog.has(key(id))) throw new Error(`locale "${id}" is already registered`)
      if (!catalog.has(key(fallback))) throw new Error(`locale fallback "${fallback}" is not registered`)
      const entry = { id, label, fallback: catalog.get(key(fallback)).id }
      catalog.set(key(id), entry)
      if (chain(id).at(-1) !== 'en') {
        catalog.delete(key(id))
        throw new Error(`locale "${id}" does not fall back to en`)
      }
      active = browser()
      return () => {
        if (catalog.get(key(id)) !== entry) return
        catalog.delete(key(id))
        if (!catalog.has(key(active))) active = browser()
      }
    },
    register(ns, a, b) {
      this.calls.push(['register', ns, typeof a === 'string' ? a : Object.keys(a)])
      if (typeof a === 'string') return one(ns, a, b)
      const offs = Object.entries(a).map(([locale, dict]) => one(ns, locale, dict))
      return () => offs.forEach((off) => off())
    },
    bind: (ns) => (k, params) => lookup(ns, k, params),
  }
}

// A client ctx around a locale service: effects run at once, and dispose() runs their disposers.
export function fakeCtx(locale) {
  const disposers = []
  const labels = []
  return {
    locale,
    labels,
    effect(run, label) {
      labels.push(label)
      const off = run()
      if (typeof off === 'function') disposers.push(off)
      return off
    },
    dispose() {
      while (disposers.length > 0) disposers.pop()()
    },
  }
}
