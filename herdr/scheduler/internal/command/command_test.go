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
