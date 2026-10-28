// The Bot cursor page's drawing (bot-cursor.js sends what to draw): the pointer where the Bot
// points, a ripple where it clicks, and a glow round the tab when it starts a navigation. It
// runs here, in the preload's own world, so the page itself runs no script and has no bridge.
const { ipcRenderer } = require('electron')

const at = (element, { x, y }) => {
  element.style.setProperty('--x', `${x}px`)
  element.style.setProperty('--y', `${y}px`)
}

ipcRenderer.on('automagik-cursor', (_event, { pointer, effect, instant, radius }) => {
  const arrow = document.querySelector('.pointer')
  const glow = document.querySelector('.glow')
  if (!arrow || !glow) return
  // The glow takes the tab's corners.
  glow.style.setProperty('--radius', `${radius}px`)
  arrow.classList.toggle('instant', instant === true)
  arrow.classList.toggle('on', pointer !== null)
  if (pointer) at(arrow, pointer)
  if (effect === 'click' && pointer) {
    const ripple = document.createElement('i')
    ripple.className = 'ripple'
    at(ripple, pointer)
    ripple.addEventListener('animationend', () => ripple.remove())
    document.body.append(ripple)
  }
  if (effect === 'navigate') {
    // Restarted, for a navigation that starts while the last one still glows.
    glow.classList.remove('flash')
    void glow.offsetWidth
    glow.classList.add('flash')
  }
})
