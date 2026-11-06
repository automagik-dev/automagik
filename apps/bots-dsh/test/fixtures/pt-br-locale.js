// A DSH locale service carrying the pt-BR pack's real omni-ui text (apps/locale-pt-br-dsh),
// so a test sees what a pt-BR reader sees rather than a string it wrote itself.
import { readFileSync } from 'node:fs'

export const PT_BR = JSON.parse(readFileSync(new URL('../../../locale-pt-br-dsh/src/client/locales/pt-BR/omni-ui.json', import.meta.url), 'utf8'))

export function ptBrLocale() {
  return {
    register: () => () => {},
    bind: () => (key, params) => {
      const text = PT_BR[key] ?? key
      return params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text
    },
    getLocale: () => ({ active: 'pt-BR' }),
  }
}
