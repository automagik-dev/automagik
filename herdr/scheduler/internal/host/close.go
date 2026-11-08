package host

import "sync"

// Shared-space closes in this scheduler serialize their read and act. A person
// can still remove another tab after the read: we leave the last tab we can see.
var workspaceCloses = struct {
	sync.Mutex
	locks map[[2]string]*workspaceCloseLock
}{locks: make(map[[2]string]*workspaceCloseLock)}

type workspaceCloseLock struct {
	sync.Mutex
	users int
}

func lockWorkspaceClose(session, workspace string) func() {
	key := [2]string{session, workspace}
	workspaceCloses.Lock()
	lock := workspaceCloses.locks[key]
	if lock == nil {
		lock = &workspaceCloseLock{}
		workspaceCloses.locks[key] = lock
	}
	lock.users++
	workspaceCloses.Unlock()
	lock.Lock()
	return func() {
		lock.Unlock()
		workspaceCloses.Lock()
		lock.users--
		if lock.users == 0 {
			delete(workspaceCloses.locks, key)
		}
		workspaceCloses.Unlock()
	}
}
