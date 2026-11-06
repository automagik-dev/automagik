// The pt-BR language pack for DSH 0.2.2 and later. DSH ships Brazilian Portuguese itself, as
// `pt`: its own dictionaries cover every DSH screen and the Language row lists it. This pack
// adds only the strings DSH does not carry (the Bot team's omni-ui namespace), under DSH's
// language, and moves a saved pt-BR choice onto it so the row keeps one Portuguese entry.
//
// The package's engines.dsh excludes releases without `pt`, so there is no fallback language
// here. The build inlines createPack's own source into client.js (scripts/build-client.mjs), so
// it refers to nothing outside its body.
export function createPack(dictionaries) {
  return {
    inject: ['locale'],
    apply(ctx) {
      const hasDshPortuguese = () => ctx.locale.getLocale().locales.some((entry) => entry.id === 'pt')
      for (const [namespace, dictionary] of Object.entries(dictionaries)) {
        ctx.effect(
          () => ctx.locale.register(namespace, 'pt', dictionary),
          `locale-pt-br: ${namespace}`,
        )
      }
      moveSavedChoice()

      // A saved pt-BR choice is an exact id to DSH's locale runtime. DSH's own id is `pt`, so
      // rewrite the stored choice through the runtime's only preference write, before anything
      // reads it; no second Portuguese entry is registered.
      function moveSavedChoice() {
        ctx.inject(['configForms'], (scope) => {
          const host = scope.configForms.get('locale')
          if (!host || typeof host.getSnapshot !== 'function' || typeof host.subscribe !== 'function') return
          const move = () => {
            if (host.getSnapshot()?.value?.preference !== 'pt-BR') return
            if (!hasDshPortuguese()) return
            ctx.locale.setLocale('pt')
          }
          ctx.effect(() => host.subscribe(move), 'locale-pt-br: saved choice')
          move()
        })
      }
    },
  }
}
