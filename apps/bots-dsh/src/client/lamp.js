import { createElement as h } from 'react'
import { LAMP } from './clay-art.js'
import { OmniMark } from './logo.js'

// -------------------------------------------------------------------------
// The lamp: Automagik's clay lamp (the owner's kit) with the mark (the triskelion, drawn from
// the brand file in logo.js) floating over its spout where a sparkle would be. It stands in
// for an icon where nothing is there yet.
export function Lamp({ width = 120 }) {
  return h('span', { className: 'bt-lamp', style: { width, height: Math.round(width * 0.48) }, 'aria-hidden': true },
    h('img', { className: 'bt-lamp-art', src: LAMP, alt: '', draggable: false }),
    h('span', { className: 'bt-lamp-mark' }, h(OmniMark, { size: Math.round(width * 0.22) })))
}

export const LAMP_CSS = `
.bt-lamp{position:relative;display:inline-block;flex:none;margin-top:calc(var(--bt-lamp-lift,26px));line-height:0}
.bt-lamp-art{width:100%;height:100%;object-fit:contain;display:block;filter:drop-shadow(0 6px 5px rgba(0,0,0,.12));-webkit-user-drag:none;user-select:none}
.bt-lamp-mark{position:absolute;left:2%;bottom:96%;display:inline-flex;color:var(--bt-ink);animation:bt-lamp-float 4.6s ease-in-out infinite}
@keyframes bt-lamp-float{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-5px) rotate(4deg)}}
body[data-bt-motion=quiet] .bt-lamp-mark{animation:none}
@media (prefers-reduced-motion:reduce){.bt-lamp-mark{animation:none}}
`
