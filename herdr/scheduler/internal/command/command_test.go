package command

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DnzzL/herdr-automations/internal/config"
)

func sh(script string) config.Command {
	return config.Command{Argv: []string{"/bin/sh", "-c", script}}
}

func TestExitZeroIsDoneWithTheLastLineOfStdout(t *testing.T) {
	res := Run(sh(`echo first; echo "12 checked, 0 broken"; echo; echo noise >&2`), time.Minute)
	if !res.OK() || res.ExitCode == nil || *res.ExitCode != 0 {
		t.Fatalf("want exit 0, got %+v", res)
	}
	if res.LastLine != "12 checked, 0 broken" || res.Line() != "12 checked, 0 broken" {
		t.Fatalf("want the last line that is not blank, got %q / %q", res.LastLine, res.Line())
	}
}

func TestAnyOtherExitIsFailedWithItsCodeAndStderr(t *testing.T) {
	res := Run(sh(`echo "looks fine"; echo one >&2; echo "disk is full" >&2; exit 3`), time.Minute)
	if res.OK() {
		t.Fatal("exit 3 read as done")
	}
	if res.ExitCode == nil || *res.ExitCode != 3 || res.Problem != "exited 3" {
		t.Fatalf("want exit code 3, got %+v", res)
	}
	if res.Stderr != "one\ndisk is full" {
		t.Fatalf("want the last lines of stderr, got %q", res.Stderr)
	}
	// stdout's cheerful last line is not the result of a run that failed.
	if res.Line() != "exited 3: disk is full" {
		t.Fatalf("line = %q", res.Line())
	}
}

func TestStderrKeepsOnlyTheLastLines(t *testing.T) {
	res := Run(sh(`i=1; while [ $i -le 40 ]; do echo "line $i" >&2; i=$((i+1)); done; exit 1`), time.Minute)
	lines := strings.Split(res.Stderr, "\n")
	if len(lines) != stderrLines || lines[0] != "line 31" || lines[len(lines)-1] != "line 40" {
		t.Fatalf("want lines 31..40, got %q", res.Stderr)
	}
}

func TestTheTimeoutFailsTheRunAndEndsWhatItStarted(t *testing.T) {
	old := killGrace
	killGrace = 200 * time.Millisecond
	defer func() { killGrace = old }()

	mark := filepath.Join(t.TempDir(), "alive")
	// The child ignores SIGTERM and would write the mark after the timeout:
	// only the group's SIGKILL stops it.
	script := `(trap "" TERM; sleep 2; echo late > "` + mark + `") & echo started; wait`
	start := time.Now()
	res := Run(sh(script), 300*time.Millisecond)
	if !res.TimedOut || res.OK() || res.ExitCode != nil {
		t.Fatalf("want a timeout with no exit code, got %+v", res)
	}
	if !strings.HasPrefix(res.Problem, "timed out after ") {
		t.Fatalf("problem = %q", res.Problem)
	}
	if took := time.Since(start); took > 1500*time.Millisecond {
		t.Fatalf("the run was held %s past a 300ms timeout", took)
	}
	time.Sleep(2500 * time.Millisecond)
	if _, err := os.Stat(mark); err == nil {
		t.Fatal("a child of the command outlived the timeout")
	}
}

func TestAProgramThatCannotStartIsFailedWithoutAnExitCode(t *testing.T) {
	res := Run(config.Command{Argv: []string{"/no/such/program"}}, time.Minute)
	if res.OK() || res.ExitCode != nil || !strings.HasPrefix(res.Problem, "could not start: ") {
		t.Fatalf("got %+v", res)
	}
	res = Run(config.Command{Argv: []string{"/bin/sh", "-c", "true"}, Cwd: "/no/such/folder"}, time.Minute)
	if res.OK() || !strings.HasPrefix(res.Problem, "could not start: ") {
		t.Fatalf("a missing working folder: got %+v", res)
	}
}

func TestItRunsInItsFolderWithItsEnvOverTheDaemons(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "check.sh"), []byte("#!/bin/sh\necho \"$PWD $GREETING $KEPT\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GREETING", "from the daemon")
	t.Setenv("KEPT", "kept")
	// A relative program is found from the working folder, like cron's.
	res := Run(config.Command{Argv: []string{"./check.sh"}, Cwd: dir, Env: map[string]string{"GREETING": "hello"}}, time.Minute)
	real, _ := filepath.EvalSymlinks(dir)
	if !res.OK() || (res.LastLine != dir+" hello kept" && res.LastLine != real+" hello kept") {
		t.Fatalf("got %+v", res)
	}
}

func TestASignalIsFailedAndNamed(t *testing.T) {
	res := Run(sh(`kill -KILL $$`), time.Minute)
	if res.OK() || res.ExitCode != nil || !strings.Contains(res.Problem, "signal 9") {
		t.Fatalf("got %+v", res)
	}
}

// The line is pasted into a bot's terminal and kept in history: nothing in it
// may drive a terminal, and it stays one bounded line.
func TestLinesAreCleanedAndBounded(t *testing.T) {
	res := Run(sh(`printf '\033[31mred\033[0m \033]0;title\007done\tok\r\n'; printf '%0500d\n' 7 >&2; exit 1`), time.Minute)
	if res.LastLine != "red done ok" {
		t.Fatalf("stdout line = %q", res.LastLine)
	}
	if n := len([]rune(res.Stderr)); n != lineLimit || !strings.HasSuffix(res.Stderr, "…") {
		t.Fatalf("stderr line is %d runes: %q", n, res.Stderr)
	}
}

func TestOnlyTheEndOfALongOutputIsKept(t *testing.T) {
	res := Run(sh(`i=0; while [ $i -lt 3000 ]; do echo "padding padding padding $i"; i=$((i+1)); done; echo the end`), time.Minute)
	if !res.OK() || res.LastLine != "the end" {
		t.Fatalf("got %q", res.LastLine)
	}
}

// The program leaves on SIGTERM at once; its child ignores SIGTERM and holds
// neither pipe, so Wait returns immediately. The grace is still waited out
// and the group still gets its SIGKILL (the Reviewer's probe on PR 995).
func TestTheTimeoutEndsAChildThatIgnoresTermAndHoldsNoPipe(t *testing.T) {
	old := killGrace
	killGrace = 300 * time.Millisecond
	defer func() { killGrace = old }()

	mark := filepath.Join(t.TempDir(), "mark")
	script := `(trap '' TERM; sleep 2; echo late > "` + mark + `") >/dev/null 2>&1 & echo started; sleep 30`
	start := time.Now()
	res := Run(sh(script), 300*time.Millisecond)
	took := time.Since(start)
	if !res.TimedOut || res.OK() {
		t.Fatalf("want a timeout, got %+v", res)
	}
	if took < 550*time.Millisecond {
		t.Fatalf("the run returned after %s: the grace was not waited out while a child was alive", took)
	}
	if took > 1500*time.Millisecond {
		t.Fatalf("the run was held %s past a 300ms timeout and a 300ms grace", took)
	}
	time.Sleep(2500 * time.Millisecond)
	if _, err := os.Stat(mark); err == nil {
		t.Fatal("a child of the command outlived the timeout")
	}
}

// A group that ends on SIGTERM is not waited on for the whole grace.
func TestAGroupThatEndsOnTermDoesNotWaitOutTheGrace(t *testing.T) {
	start := time.Now()
	res := Run(sh(`sleep 30 & sleep 30`), 200*time.Millisecond)
	if !res.TimedOut {
		t.Fatalf("got %+v", res)
	}
	if took := time.Since(start); took > 3*time.Second {
		t.Fatalf("held %s although everything left on SIGTERM (the grace is %s)", took, killGrace)
	}
}

// The result line goes into a bot's terminal: a start failure names the home
// folder as ~, never by its path.
func TestAStartFailureDoesNotNameTheHomeFolder(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	for _, c := range []config.Command{
		{Argv: []string{filepath.Join(home, "bin", "no-such-program")}},
		{Argv: []string{"/bin/sh", "-c", "true"}, Cwd: filepath.Join(home, "no-such-folder")},
	} {
		res := Run(c, time.Minute)
		if res.OK() || !strings.HasPrefix(res.Problem, "could not start: ") {
			t.Fatalf("got %+v", res)
		}
		if strings.Contains(res.Line(), home) {
			t.Fatalf("the line names the home folder: %q", res.Line())
		}
		if !strings.Contains(res.Problem, "~/") {
			t.Fatalf("the path lost its ~: %q", res.Problem)
		}
	}
}

// Last in the file: Shutdown is for a process that is leaving, and stays set.
func TestShutdownEndsARunningCommandAndRefusesNewOnes(t *testing.T) {
	old := killGrace
	killGrace = 300 * time.Millisecond
	defer func() { killGrace = old }()

	mark := filepath.Join(t.TempDir(), "mark")
	got := make(chan Result, 1)
	go func() { got <- Run(sh(`(sleep 2; echo late > "`+mark+`") & sleep 30`), time.Hour) }()
	time.Sleep(200 * time.Millisecond)
	Shutdown()
	Shutdown() // twice is once
	select {
	case res := <-got:
		if !res.Stopped || res.TimedOut || res.OK() || res.ExitCode != nil || res.Problem != "stopped: the scheduler was stopping" {
			t.Fatalf("got %+v", res)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the command outlived Shutdown")
	}
	time.Sleep(2500 * time.Millisecond)
	if _, err := os.Stat(mark); err == nil {
		t.Fatal("a child of the command outlived Shutdown")
	}
	if res := Run(sh(`echo hi`), time.Minute); !res.Stopped || res.OK() || !strings.HasPrefix(res.Problem, "not started") {
		t.Fatalf("a command started after Shutdown: %+v", res)
	}
}
