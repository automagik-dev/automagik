// The pt-BR language pack. It adds Português (Brasil) to DSH's language list, then registers
// one pt-BR dictionary per namespace it translates. DSH reads a key the pack lacks from the
// English dictionary, so an untranslated screen stays in English.
//
// The build inlines createPack's own source into client.js (scripts/build-client.mjs), so it
// refers to nothing outside its body.
export function createPack(dictionaries) {
  const language = { id: 'pt-BR', label: 'Português (Brasil)', fallback: 'en' }
  return {
    inject: ['locale'],
    apply(ctx) {
      // A browser that asks for Portuguese opens in it, unless a language was picked in Settings.
      ctx.effect(() => ctx.locale.addLanguage(language), 'locale-pt-br: language')
      for (const [namespace, dictionary] of Object.entries(dictionaries)) {
        ctx.effect(() => ctx.locale.register(namespace, language.id, dictionary), `locale-pt-br: ${namespace}`)
      }
    },
  }
}
