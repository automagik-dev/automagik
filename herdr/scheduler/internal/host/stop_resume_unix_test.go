//go:build unix

package host

import (
	"testing"
	"time"

	"github.com/DnzzL/herdr-automations/internal/config"
	"github.com/DnzzL/herdr-automations/internal/herdr"
)

// A person can answer a dialog after the grace and screen read, before the
// stop request. A working agent at the final check resumes instead of failing.
func TestDoResumesWhenDialogClearsBeforeSignal(t *testing.T) {
	for _, phase := range []string{"start", "submit", "await"} {
		t.Run(phase, func(t *testing.T) {
			clock := time.Unix(0, 0)
			state := "blocked"
			stopChecks, infoReads, signals := 0, 0, 0
			ops := &fakeOps{}
			ops.agentStatus = func(string) (string, error) {
				clock = clock.Add(time.Minute)
				return state, nil
			}
			ops.agentWait = func(string, time.Duration) error {
				if stopChecks > 0 {
					state = "done"
				}
				return nil
			}
			ops.paneRead = func(string, int) (string, error) { return "Do you want to proceed?", nil }
			ops.agentStop = func(string) (bool, error) {
				stopChecks++
				return stopForeground(func() (herdr.ProcessInfo, error) {
					infoReads++
					if infoReads == 2 {
						state = "working"
					}
					return herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, nil
				}, func() (string, error) { return ops.AgentStatus("p") }, 400, 401, func(int) error {
					signals++
					return nil
				})
			}
			if phase == "start" {
				ops.agentStart = func(string, string, string, []string) error { return apiErr("agent start", herdr.CodeAgentNotReady) }
			}
			if phase == "submit" {
				ops.agentSubmit = func(string, string) error {
					if ops.submits == 1 {
						return apiErr("agent prompt", herdr.CodeAgentBlocked)
					}
					return nil
				}
			}
			w := agentWorkWith(ops, config.Automation{Prompt: "go"})
			w.clock = func() time.Time { return clock }
			if err := w.do(Session{PaneID: "p"}, 200*time.Millisecond); err != nil {
				t.Fatal(err)
			}
			wantSubmits := 1
			if phase == "submit" {
				wantSubmits = 2
			}
			if signals != 0 || stopChecks != 1 || infoReads != 2 || ops.starts != 1 || ops.submits != wantSubmits {
				t.Fatalf("signals=%d stopChecks=%d infoReads=%d starts=%d submits=%d", signals, stopChecks, infoReads, ops.starts, ops.submits)
			}
			if len(ops.closed)+len(ops.closedTabs) != 0 {
				t.Fatal("resumed run closed its layout")
			}
		})
	}
}
