// Where things are in the interface, in its own words: the page names and button labels it
// shows, read from the locale strings at call time, so a Bot that sends the user somewhere
// names the place exactly as the user sees it (#316).
import { t } from './i18n.js'

// Settings, then the Capabilities page, then its Allow button: "Configurações > Recursos >
// Permitir" in pt-BR.
export const allowPlace = () => [t('Settings'), t('Capabilities'), t('Allow')].join(' > ')
