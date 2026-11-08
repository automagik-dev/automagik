//go:build unix

package host

import (
	"errors"
	"testing"

	"github.com/DnzzL/herdr-automations/internal/herdr"
)

func TestEndForegroundSignalsOnlyTheAgentGroup(t *testing.T) {
	var signalled []int
	err := endForeground(herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, 400, 401, func(group int) error {
		signalled = append(signalled, group)
		return nil
	})
	if err != nil || len(signalled) != 1 || signalled[0] != 300 {
		t.Fatalf("signalled %v, error %v", signalled, err)
	}
}

func TestEndForegroundRefusesMissingShellAndOwnGroups(t *testing.T) {
	for _, tc := range []struct {
		name         string
		shell, group int
	}{
		{"missing shell", 0, 300}, {"missing group", 200, 0},
		{"init group", 200, 1}, {"shell group", 200, 200},
		{"own group", 200, 400}, {"own pid", 200, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := endForeground(herdr.ProcessInfo{ShellPID: tc.shell, ForegroundGroup: tc.group}, 400, 401, func(int) error {
				t.Fatal("signalled a refused group")
				return nil
			})
			if err == nil {
				t.Fatal("want a refusal")
			}
		})
	}
}

func TestEndForegroundReportsSignalFailure(t *testing.T) {
	want := errors.New("cannot signal")
	err := endForeground(herdr.ProcessInfo{ShellPID: 200, ForegroundGroup: 300}, 400, 401, func(int) error { return want })
	if !errors.Is(err, want) {
		t.Fatalf("got %v, want %v", err, want)
	}
}
