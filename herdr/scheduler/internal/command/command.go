// Package command runs one automation's command: a program the scheduler
// starts itself and waits for, with no pane and no agent in between (ADR 0013).
//
// A pane has no exit status, which is why a workflow's has to be scraped off a
// screen. A child process has one, so this is the one kind of run whose status
// is read rather than inferred: exit 0 is done, anything else is failed.
package command

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"

	"github.com/DnzzL/herdr-automations/internal/config"
)

const (
	// tailBytes is how much of each stream is kept: the end, where a program
	// says how it went. A nightly job may print megabytes before that.
	tailBytes = 16 * 1024
	// stderrLines and lineLimit bound what goes into history.
	stderrLines = 10
	lineLimit   = 300
)

// killGrace is how long a command gets between the timeout's SIGTERM and the
// SIGKILL, and how long its pipes may stay open after it exits. A variable so
// the tests do not wait ten seconds.
var killGrace = 10 * time.Second

// groupPoll is how often a group that was told to end is asked whether
// anything in it is left.
const groupPoll = 50 * time.Millisecond

// stopping is closed by Shutdown: every running command is ended the way the
// timeout ends one, and none is started after it.
var (
	stopping     = make(chan struct{})
	stoppingOnce sync.Once
)

// Shutdown ends every running command and refuses new ones: SIGTERM to each
// one's process group, SIGKILL after the grace. The daemon calls it when it is
// told to stop, because a command is in its own process group and a signal
// aimed at the daemon's does not reach it; without this a stopped scheduler
// would leave the command running with no timeout and no record of its end.
// It returns at once; the runs record themselves as they end.
func Shutdown() { stoppingOnce.Do(func() { close(stopping) }) }

// Result is how a command ended.
type Result struct {
	// ExitCode is the program's exit status; nil when it has none: it never
	// started, the timeout ended it, or a signal did.
	ExitCode *int
	// TimedOut says the timeout ended it.
	TimedOut bool
	// Stopped says the scheduler ended it because it was itself told to stop.
	Stopped bool
	// Problem is why it failed, in one line; empty for exit 0.
	Problem string
	// LastLine is the last line of stdout that is not blank.
	LastLine string
	// Stderr is the last lines of stderr.
	Stderr string
}

// OK reports whether the command exited 0.
func (r Result) OK() bool { return r.Problem == "" }

// Line is the run in one line, for the bot it is reported to and the panel:
// the last line of stdout when it worked, else why it failed and the last
// thing it said on stderr.
func (r Result) Line() string {
	if r.OK() {
		return r.LastLine
	}
	if last := lastLine(r.Stderr); last != "" {
		return r.Problem + ": " + last
	}
	return r.Problem
}

// Run starts c and waits for it, for at most timeout. The program's whole
// process group is ended at the timeout: SIGTERM, then SIGKILL after a grace.
func Run(c config.Command, timeout time.Duration) Result {
	if len(c.Argv) == 0 {
		return Result{Problem: "could not start: no argv"}
	}
	cwd := c.Cwd
	if cwd == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return Result{Problem: "could not start: no working folder: " + err.Error()}
		}
		cwd = home
	}
	// Said here: exec reports a missing folder as the program not being found.
	if info, err := os.Stat(cwd); err != nil || !info.IsDir() {
		return Result{Problem: "could not start: no working folder " + clean(homeless(cwd))}
	}
	cmd := exec.Command(c.Argv[0], c.Argv[1:]...)
	cmd.Dir = cwd
	cmd.Env = environment(c.Env)
	var stdout, stderr tail
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	// Its own process group, so the timeout reaches what it started too.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// A child that outlives the program and keeps a pipe open must not hold
	// the run: Wait gives up on the pipes after the grace.
	cmd.WaitDelay = killGrace

	select {
	case <-stopping:
		return Result{Stopped: true, Problem: "not started: the scheduler was stopping"}
	default:
	}
	if err := cmd.Start(); err != nil {
		return Result{Problem: "could not start: " + clean(homeless(err.Error()))}
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	res := Result{}
	select {
	case <-done:
	case <-time.After(timeout):
		res.TimedOut = true
		endGroup(cmd.Process.Pid, done)
	case <-stopping:
		res.Stopped = true
		endGroup(cmd.Process.Pid, done)
	}
	res.LastLine = lastLine(stdout.String())
	res.Stderr = lastLines(stderr.String(), stderrLines)

	state := cmd.ProcessState
	switch {
	case res.TimedOut:
		res.Problem = fmt.Sprintf("timed out after %s", timeout)
	case res.Stopped:
		res.Problem = "stopped: the scheduler was stopping"
	case state == nil:
		res.Problem = "ended without an exit status"
	case state.ExitCode() < 0:
		res.Problem = "ended by a signal"
		if ws, ok := state.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
			res.Problem = fmt.Sprintf("ended by signal %d (%s)", int(ws.Signal()), ws.Signal())
		}
	default:
		code := state.ExitCode()
		res.ExitCode = &code
		if code != 0 {
			res.Problem = fmt.Sprintf("exited %d", code)
		}
	}
	return res
}

// endGroup ends a command's whole process group: SIGTERM, the grace, SIGKILL.
// It returns once the program has been waited for.
//
// The program exiting is not the group ending. A program that leaves on
// SIGTERM can have started a child that ignores it and holds none of the
// pipes: Wait returns at once and that child would run on with no bound. So
// the grace is waited out while anything in the group is left, and the SIGKILL
// is sent whether or not the program itself is still there.
func endGroup(pgid int, done <-chan error) {
	_ = syscall.Kill(-pgid, syscall.SIGTERM)
	grace := time.NewTimer(killGrace)
	defer grace.Stop()
	poll := time.NewTicker(groupPoll)
	defer poll.Stop()
	exited := false
	for {
		select {
		case <-done:
			exited, done = true, nil // a nil channel never fires again
		case <-poll.C:
		case <-grace.C:
			_ = syscall.Kill(-pgid, syscall.SIGKILL)
			if !exited {
				<-done
			}
			return
		}
		// Nothing left in the group: no SIGKILL, so a group id the system
		// hands out again later is never signalled.
		if exited && errors.Is(syscall.Kill(-pgid, 0), syscall.ESRCH) {
			return
		}
	}
}

// homeless writes the home folder as ~ in a message that leaves the machine's
// owner: the result line goes into a bot's terminal, and Go's exec errors
// quote the full path of a program or folder they could not open.
func homeless(msg string) string {
	home, err := os.UserHomeDir()
	if err != nil || len(home) < 2 {
		return msg
	}
	return strings.ReplaceAll(msg, home, "~")
}

// environment is the daemon's environment with the automation's on top.
func environment(extra map[string]string) []string {
	env := os.Environ()
	keys := make([]string, 0, len(extra))
	for k := range extra {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		// exec keeps the last of two entries with one name.
		env = append(env, k+"="+extra[k])
	}
	return env
}

// tail is a Writer that keeps the last tailBytes written to it.
type tail struct {
	mu  sync.Mutex
	buf []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if over := len(t.buf) - tailBytes; over > 0 {
		t.buf = append(t.buf[:0], t.buf[over:]...)
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}

// lastLines returns the last n lines of text that are not blank, each cleaned
// and bounded.
func lastLines(text string, n int) string {
	var kept []string
	lines := strings.Split(text, "\n")
	for i := len(lines) - 1; i >= 0 && len(kept) < n; i-- {
		if line := clean(lines[i]); line != "" {
			kept = append([]string{line}, kept...)
		}
	}
	return strings.Join(kept, "\n")
}

func lastLine(text string) string { return lastLines(text, 1) }

// escapes are a terminal's control sequences (colours, cursor moves, titles),
// removed whole so a coloured line does not leave "[31m" behind.
var escapes = regexp.MustCompile("\x1b\\[[0-9;?]*[ -/]*[@-~]|\x1b\\][^\x07\x1b]*(?:\x07|\x1b\\\\)")

// clean makes one line safe to keep and to paste into a terminal: control
// characters go (a program's colours, a carriage return, an escape that would
// drive the terminal it lands in), and it is cut at lineLimit.
func clean(line string) string {
	line = strings.ToValidUTF8(line, "")
	line = escapes.ReplaceAllString(line, "")
	line = strings.Map(func(r rune) rune {
		if r == '\t' {
			return ' '
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, line)
	line = strings.TrimSpace(line)
	if r := []rune(line); len(r) > lineLimit {
		return string(r[:lineLimit-1]) + "…"
	}
	return line
}
