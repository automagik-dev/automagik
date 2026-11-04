// The tar the app unpacks with: the system's own, by its path where a bare `tar` could be
// another one first on PATH. Windows ships bsdtar in System32 (10 1803 and later); a GNU tar from
// Git for Windows, often first on a developer's PATH, takes `C:\...` for a remote host.
import { win32 } from 'node:path'

export function tarOf({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') return win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'tar.exe')
  return platform === 'darwin' ? '/usr/bin/tar' : 'tar'
}
