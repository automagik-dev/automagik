// DSH's locale service as a language pack meets it: en and zh, a language added with its
// fallback, one dictionary per namespace and language, and a lookup that falls back to English,
// then to the key.
export function fakeLocale() {
  const catalog = new Map([['en', { id: 'en' }], ['zh', { id: 'zh', fallback: 'en' }]])
  const dicts = new Map()
  let active = 'en'
  const calls = []
  const chain = () => {
    const out = []
    for (let at = catalog.get(active.toLowerCase()); at; at = at.fallback ? catalog.get(at.fallback.toLowerCase()) : undefined) out.push(at.id)
    return out
  }
  return {
    calls,
    getLocale: () => ({ active }),
    addLanguage({ id, fallback }) { catalog.set(id.toLowerCase(), { id, fallback }) },
    setLocale(id) { active = catalog.get(id.toLowerCase()).id },
    register(ns, dictionaries) {
      calls.push([ns, Object.keys(dictionaries)])
      for (const locale of Object.keys(dictionaries)) {
        const slot = `${ns}\u0000${locale.toLowerCase()}`
        if (dicts.has(slot)) throw new Error(`locale namespace "${ns}" already has locale "${locale}"`)
      }
      for (const [locale, dict] of Object.entries(dictionaries)) dicts.set(`${ns}\u0000${locale.toLowerCase()}`, dict)
      return () => { for (const locale of Object.keys(dictionaries)) dicts.delete(`${ns}\u0000${locale.toLowerCase()}`) }
    },
    bind: ns => (key, params) => {
      let text = key
      for (const id of chain()) {
        const found = dicts.get(`${ns}\u0000${id.toLowerCase()}`)?.[key]
        if (found !== undefined) { text = found; break }
      }
      return params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text
    },
  }
}
