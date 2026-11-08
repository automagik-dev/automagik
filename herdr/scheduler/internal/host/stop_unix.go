//go:build unix

package host

import (
	"fmt"
	"os"
	"syscall"

	"github.com/DnzzL/herdr-automations/internal/herdr"
)

// AgentStop asks the agent to stop (SIGTERM), without escalating or confirming
// exit. Rechecks narrow the read/signal window; they cannot make it atomic.
func (o herdrOps) AgentStop(paneID string) (bool, error) {
	return stopForeground(func() (herdr.ProcessInfo, error) {
		return o.PaneProcessInfo(paneID)
	}, func() (string, error) {
		return o.AgentStatus(paneID)
	}, syscall.Getpgrp(), os.Getpid(), func(group int) error {
		return syscall.Kill(-group, syscall.SIGTERM)
	})
}

func stopForeground(readInfo func() (herdr.ProcessInfo, error), status func() (string, error), ownGroup, ownPID int, signal func(int) error) (bool, error) {
	first, err := readInfo()
	if err != nil {
		return true, err
	}
	// Re-read both the job and status immediately before the signal. A person
	// may have answered the dialog or changed the pane's foreground job.
	current, infoErr := readInfo()
	state, err := status()
	if err != nil {
		return true, err
	}
	if state != "blocked" {
		return false, nil
	}
	if infoErr != nil {
		return true, infoErr
	}
	for _, info := range []herdr.ProcessInfo{first, current} {
		group := info.ForegroundGroup
		if info.ShellPID <= 1 || group <= 1 || group == info.ShellPID || group == ownGroup || group == ownPID {
			return true, fmt.Errorf("refusing to signal a missing, shell or scheduler process group")
		}
	}
	if current.ForegroundGroup != first.ForegroundGroup {
		return true, fmt.Errorf("foreground process group changed; no SIGTERM requested")
	}
	return true, signal(current.ForegroundGroup)
}
