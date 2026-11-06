// The pt-BR language pack for DSH 0.2.2 and later. DSH ships Brazilian Portuguese itself, as
// `pt`, but its copy is wrong on keys this package's readers see: the date order is inverted
// (chat.clock.md), the thousands separator is `,`, the plan hint stays in English, and several
// strings are mistranslated. A pack cannot override a namespace DSH already registers for the
// same locale, so the corrected strings live under this pack's own `pt-BR` id, which falls back
// to DSH's `pt` for everything else. The owner's decision on shipping our copy or DSH's is
// pending; until it is made, correctness wins over the single picker entry.
//
// `omni-ui` is the Bot team's namespace, which DSH does not have: it registers under `pt`, so
// it resolves for a reader on either Portuguese entry.
//
// The build inlines createPack's own source into client.js (scripts/build-client.mjs), so it
// refers to nothing outside its body.
export function createPack(dictionaries) {
  const language = { id: 'pt-BR', label: 'Português (Brasil)', fallback: 'pt' }
  return {
    inject: ['locale'],
    apply(ctx) {
      ctx.effect(() => ctx.locale.addLanguage(language), 'locale-pt-br: language')
      for (const [namespace, dictionary] of Object.entries(dictionaries)) {
        // DSH owns every DSH namespace under `pt`; only the Bot team's own namespace is safe
        // there, and it serves both entries through the fallback chain.
        const id = namespace === 'omni-ui' ? 'pt' : language.id
        ctx.effect(
          () => ctx.locale.register(namespace, id, dictionary),
          `locale-pt-br: ${namespace}`,
        )
      }
    },
  }
}
