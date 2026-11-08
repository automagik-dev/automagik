//go:build unix

package host

import (
	"errors"
	"testing"

	"github.com/DnzzL/herdr-automations/internal/herdr"
)

func TestStopForegroundRechecksStatusAndGroup(t *testing.T) {
	for _, tc := range []struct {
		name, state                        string
		first, current                     herdr.ProcessInfo
		wantSignal, wantBlocked, wantError bool
	}{
		{"pgid unchanged", "blocked", herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, true, true, false},
		{"status turns working", "working", herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, false, false, false},
		{"foreground group changes", "blocked", herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 301}, false, true, true},
		{"shell replaces agent", "blocked", herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 200}, false, true, true},
		{"scheduler replaces agent", "blocked", herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 400}, false, true, true},
		{"missing current group", "blocked", herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, herdr.ProcessInfo{ShellPID: 200}, false, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reads, checks := 0, 0
			var signalled []int
			blocked, err := stopForeground(func() (herdr.ProcessInfo, error) {
				reads++
				if reads == 1 {
					return tc.first, nil
				}
				return tc.current, nil
			}, func() (string, error) {
				checks++
				return tc.state, nil
			}, 400, 401, func(group int) error {
				signalled = append(signalled, group)
				return nil
			})
			if blocked != tc.wantBlocked || (err != nil) != tc.wantError || (len(signalled) != 0) != tc.wantSignal {
				t.Fatalf("blocked=%v error=%v signalled=%v", blocked, err, signalled)
			}
			if len(signalled) > 0 && (len(signalled) != 1 || signalled[0] != 300) {
				t.Fatalf("signalled %v", signalled)
			}
			if reads != 2 || checks != 1 {
				t.Fatalf("reads=%d checks=%d", reads, checks)
			}
		})
	}
}

func TestStopForegroundRefusesMissingShellAndOwnGroups(t *testing.T) {
	for _, tc := range []struct {
		name         string
		shell, group int
	}{
		{"missing shell", 0, 300}, {"missing group", 200, 0},
		{"init group", 200, 1}, {"shell group", 200, 200},
		{"own group", 200, 400}, {"own pid", 200, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			blocked, err := stopForeground(func() (herdr.ProcessInfo, error) {
				return herdr.ProcessInfo{ShellPID: tc.shell, ForegroundGroup: tc.group}, nil
			}, func() (string, error) { return "blocked", nil }, 400, 401, func(int) error {
				t.Fatal("signalled a refused group")
				return nil
			})
			if !blocked || err == nil {
				t.Fatalf("blocked=%v error=%v, want a refusal", blocked, err)
			}
		})
	}
}

func TestStopForegroundReportsReadAndSignalFailures(t *testing.T) {
	want := errors.New("unavailable")
	for _, phase := range []string{"first read", "second read", "status", "signal"} {
		t.Run(phase, func(t *testing.T) {
			reads, signals := 0, 0
			blocked, err := stopForeground(func() (herdr.ProcessInfo, error) {
				reads++
				if (phase == "first read" && reads == 1) || (phase == "second read" && reads == 2) {
					return herdr.ProcessInfo{}, want
				}
				return herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, nil
			}, func() (string, error) {
				if phase == "status" {
					return "", want
				}
				return "blocked", nil
			}, 400, 401, func(int) error {
				signals++
				return want
			})
			if !blocked || !errors.Is(err, want) {
				t.Fatalf("blocked=%v error=%v", blocked, err)
			}
			if phase != "signal" && signals != 0 {
				t.Fatal("signalled without readable rechecks")
			}
		})
	}
}
