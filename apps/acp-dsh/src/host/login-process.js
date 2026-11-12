// A login owns its Unix process group until every member has exited, even if a wrapper exits
// first. Credential writes by an orphan must finish or stop before the next auth operation.
export class LoginProcess {
  constructor(child, { grouped = true, timers = globalThis } = {}) {
    this.child = child
    this.timers = timers
    this.pid = child.pid
    this.grouped = grouped && Number.isInteger(this.pid) && this.pid > 1
    this.closed = false
    this.ending = false
    this.done = new Promise(resolve => { this.resolve = resolve })
    child.once('exit', () => this.terminate())
    child.once('close', () => {
      this.closed = true
      this.terminate()
      this.check()
    })
    child.once('error', () => {
      if (!Number.isInteger(child.pid)) this.finish()
    })
  }

  signal(name) {
    if (this.grouped) {
      try { process.kill(-this.pid, name); return } catch (error) {
        if (error.code !== 'ESRCH') return
      }
    }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      try { this.child.kill(name) } catch {}
    }
  }

  terminate() {
    if (this.ending) return
    this.ending = true
    this.signal('SIGTERM')
    if (this.finished) return
    this.hard = this.timers.setTimeout(() => this.signal('SIGKILL'), 1000)
    this.hard?.unref?.()
    this.check()
  }

  check() {
    if (this.finished) return
    if (!this.grouped) {
      if (this.closed) this.finish()
      return
    }
    try { process.kill(-this.pid, 0) } catch (error) {
      if (error.code === 'ESRCH' && this.closed) return this.finish()
    }
    this.poll ??= this.timers.setTimeout(() => {
      this.poll = undefined
      this.check()
    }, 20)
    this.poll?.unref?.()
  }

  finish() {
    if (this.finished) return
    this.finished = true
    this.timers.clearTimeout(this.hard)
    this.timers.clearTimeout(this.poll)
    this.resolve()
  }

  stop() {
    this.terminate()
    // Each retry can wait again, but signals are issued only for this owned process group.
    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        reject(new Error('The previous sign-in process tree has not stopped. Try again.'))
      }, 5000)
      this.done.then(() => { this.timers.clearTimeout(timer); resolve() })
    })
  }
}
