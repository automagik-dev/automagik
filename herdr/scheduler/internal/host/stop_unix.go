//go:build unix

package host

import (
	"fmt"
	"os"
	"syscall"

	"github.com/DnzzL/herdr-automations/internal/herdr"
)

// AgentEnd ends only the foreground job. Herdr has no agent-stop API; closing
// a pane instead would remove the failed run's layout. No keys answer its dialog.
func (o herdrOps) AgentEnd(paneID string) error {
	info, err := o.PaneProcessInfo(paneID)
	if err != nil {
		return err
	}
	return endForeground(info, syscall.Getpgrp(), os.Getpid(), func(group int) error {
		return syscall.Kill(-group, syscall.SIGTERM)
	})
}

func endForeground(info herdr.ProcessInfo, ownGroup, ownPID int, signal func(int) error) error {
	group := info.ForegroundGroup
	if info.ShellPID <= 1 || group <= 1 || group == info.ShellPID || group == ownGroup || group == ownPID {
		return fmt.Errorf("refusing to end a missing, shell or scheduler process group")
	}
	return signal(group)
}
