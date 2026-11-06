// The Portuguese pack for DSH 0.2.2 and later. DSH ships Brazilian Portuguese itself, as `pt`,
// and Settings › General › Language lists it. This pack adds no language of its own; it registers
// the one namespace DSH does not carry — the Bot team's `omni-ui` — under `pt`, so the Language
// row keeps exactly one Portuguese entry: DSH's **Português**.
//
// The pack used to add a `pt-BR` entry carrying a corrected copy of five DSH namespaces. A pack
// cannot override a namespace DSH already registers for `pt` (the second registration throws), so
// those strings had to live under a second language — which is the duplicate picker row this pack
// removes. DSH's `pt` copy serves those screens now. The `pt-BR` id stays reserved: a profile that
// still has an older copy of the pack mounted keeps its row until that copy unloads, and this one
// never adds another. What it does is move a stored `pt-BR` choice onto `pt`, through the locale
// runtime's only preference write, so a choice saved under the old pack is not silently dropped on
// an English browser.
//
// The build inlines createPack's own source into client.js (scripts/build-client.mjs), so it refers
// to nothing outside its body.
export function createPack(dictionaries) {
  const PT = 'pt'
  // DSH's wording when a namespace already holds a dictionary for the locale.
  const DUPLICATE = /already has locale/

  return {
    inject: ['locale'],
    apply(ctx) {
      const hasPortuguese = () => ctx.locale.getLocale().locales.some((entry) => entry.id.toLowerCase() === PT)
      for (const [namespace, dictionary] of Object.entries(dictionaries)) {
        ctx.effect(() => registerWhenFree(namespace, dictionary), `locale-pt-br: ${namespace}`)
      }
      if (hasPortuguese()) moveSavedChoice()

      // Register one dictionary under DSH's `pt`. A namespace that already has one belongs to an
      // older copy of this pack still mounted while it unloads; this copy contributes nothing until
      // that copy's disposer removes the entry and publishes, then registers its own. On a fresh
      // install, or once the old copy is gone, the first attempt succeeds.
      function registerWhenFree(namespace, dictionary) {
        let off
        let busy = false
        const attempt = () => {
          if (busy || off !== undefined) return
          busy = true
          try {
            off = ctx.locale.register(namespace, PT, dictionary)
          } catch (error) {
            if (!DUPLICATE.test(String(error?.message ?? ''))) throw error
          } finally {
            busy = false
          }
        }
        const unsubscribe = ctx.locale.subscribe(attempt)
        try {
          attempt()
        } catch (error) {
          unsubscribe()
          throw error
        }
        return () => {
          unsubscribe()
          off?.()
        }
      }

      // A saved pt-BR choice is an exact id to DSH's locale runtime. DSH's own id is `pt`, so
      // rewrite the stored choice through the runtime's only preference write, before the choice
      // is read. The preference host may adopt a late snapshot (a start, a settings load), hence
      // the subscription as well. Only a stored `pt-BR` is touched: an English browser that never
      // picked a language stays English.
      function moveSavedChoice() {
        ctx.inject(['configForms'], (scope) => {
          const host = scope.configForms.get('locale')
          if (!host || typeof host.getSnapshot !== 'function' || typeof host.subscribe !== 'function') return
          const move = () => {
            if (host.getSnapshot()?.value?.preference !== 'pt-BR') return
            if (!hasPortuguese()) return
            ctx.locale.setLocale(PT)
          }
          ctx.effect(() => host.subscribe(move), 'locale-pt-br: saved choice')
          move()
        })
      }
    },
  }
}
