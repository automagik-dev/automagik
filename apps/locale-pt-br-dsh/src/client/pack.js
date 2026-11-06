// The pt-BR language pack. DSH 0.2.2 ships Brazilian Portuguese itself, as `pt`: its own
// dictionaries cover every DSH screen and the Language row lists it. On such a DSH this pack
// adds only the strings DSH does not carry (the Bot team's omni-ui namespace, plus strings DSH
// dropped from pluginManager and question), under DSH's language, and moves a saved pt-BR
// choice onto it so the row keeps one Portuguese entry.
//
// A DSH without Portuguese (0.2.1) gets the pack's own pt-BR entry, as before.
//
// The build inlines createPack's own source into client.js (scripts/build-client.mjs), so it
// refers to nothing outside its body.
export function createPack(dictionaries) {
  const language = { id: 'pt-BR', label: 'Português', fallback: 'en' }
  return {
    inject: ['locale'],
    apply(ctx) {
      // DSH's own language, once DSH registers it. Dictionaries may arrive before the
      // definition, but here the definition decides where the pack's strings go.
      const hasDshPortuguese = () => ctx.locale.getLocale().locales.some((entry) => entry.id === 'pt')
      const adopted = hasDshPortuguese()
      if (!adopted) ctx.effect(() => ctx.locale.addLanguage(language), 'locale-pt-br: language')
      for (const [namespace, dictionary] of Object.entries(dictionaries)) {
        // pluginManager and question hold only strings DSH dropped. DSH owns their pt
        // dictionary on 0.2.2, and a second registration for the same locale throws, so
        // those strings belong to the pack's own pt-BR entry alone.
        if (adopted && namespace !== 'omni-ui') continue
        ctx.effect(
          () => ctx.locale.register(namespace, adopted ? 'pt' : 'pt-BR', dictionary),
          `locale-pt-br: ${namespace}`,
        )
      }
      if (adopted) moveSavedChoice()

      // A saved pt-BR choice is an exact id to DSH's locale runtime, so removing the pack's
      // own language would silently drop it on an English browser. Rewrite it as DSH's `pt`,
      // through the runtime's only preference write, before anything reads the choice.
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
