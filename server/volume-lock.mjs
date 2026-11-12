// Kernel lease shared by every image follower of the same mounted DSH home.
import { spawn } from 'node:child_process'
import { closeSync, constants, fchmodSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'

export const VOLUME_LOCK = '.automagik-image-follow.lock'

export async function withVolumeLock(dshHome, work) {
  mkdirSync(dshHome, { recursive: true, mode: 0o700 })
  // Keep the inode permanently: unlinking a released lock would let another process
  // acquire a different inode while a waiter still holds this one open.
  const fd = openSync(join(dshHome, VOLUME_LOCK), constants.O_CREAT | constants.O_RDWR, 0o600)
  try {
    fchmodSync(fd, 0o600)
    await new Promise((resolve, reject) => {
      // FD 3 and fd refer to the same open file description. flock's short-lived
      // helper acquires that description's lease; the parent retains it after exit.
      const child = spawn('/usr/bin/flock', ['--exclusive', '--wait', '180', '3'], {
        stdio: ['ignore', 'ignore', 'ignore', fd],
      })
      child.once('error', () => reject(new Error('Image profile lock helper failed')))
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Image profile lock was not acquired')))
    })
    return await work()
  } finally {
    // Closing the last descriptor releases the lease, including on process death.
    closeSync(fd)
  }
}
