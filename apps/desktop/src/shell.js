// The frame page's script: window buttons, and the window state main.js sends.
const { platform, act, onState } = window.omniWindow
const body = document.body
body.classList.add(platform === 'darwin' ? 'darwin' : 'linux')
for (const button of document.querySelectorAll('.controls [data-act]')) button.addEventListener('click', () => act(button.dataset.act))
onState((state) => {
  body.classList.toggle('max', state.maximized === true)
  body.classList.toggle('ready', state.ready === true)
  showUpdate(state.update)
  if (typeof state.status === 'string') {
    const status = document.getElementById('status')
    status.textContent = state.status
    status.classList.toggle('bad', state.problem === true)
  }
})

// The update area (frame.js updateView): a short line, and buttons that ask main.js to act.
function showUpdate(view) {
  const area = document.getElementById('update')
  area.replaceChildren()
  area.hidden = !view
  if (!view) return
  area.title = view.title ?? ''
  if (view.text) {
    const text = document.createElement('span')
    text.className = 'update-text'
    text.textContent = view.text
    area.append(text)
  }
  for (const action of view.actions ?? []) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = action.primary ? 'primary' : ''
    button.textContent = action.label
    button.addEventListener('click', () => act(action.act))
    area.append(button)
  }
}

// A right click on the title bar opens its menu (Check for Updates).
document.querySelector('.bar').addEventListener('contextmenu', (event) => {
  event.preventDefault()
  act('menu')
})
