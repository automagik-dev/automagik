package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// put is the wire path the panel writes an automation through (JSON on stdin, config.Put behind
// it): these cases run putCmd itself, so close_workspace has to survive the JSON-to-config mapping
// and the merge rules the form relies on.
func runPut(t *testing.T, config, body string, args ...string) (answer, after string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HERDR_PLUGIN_CONFIG_DIR", dir)
	t.Setenv("HERDR_PLUGIN_STATE_DIR", t.TempDir())
	path := filepath.Join(dir, "automations.yaml")
	if err := os.WriteFile(path, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	stdin, err := os.CreateTemp(t.TempDir(), "stdin-")
	if err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	if _, err := stdin.WriteString(body); err != nil {
		t.Fatal(err)
	}
	if _, err := stdin.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	oldIn, oldOut := os.Stdin, os.Stdout
	os.Stdin, os.Stdout = stdin, writer
	runErr := putCmd(args)
	writer.Close()
	os.Stdin, os.Stdout = oldIn, oldOut
	out, err := io.ReadAll(reader)
	reader.Close()
	if runErr != nil {
		t.Fatalf("put: %v", runErr)
	}
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(out), string(raw)
}

const putBase = `automations:
  - name: triage
    cron: "0 9 * * 1-5"
    repo: /x
    prompt: p
`

func TestPutCarriesCloseWorkspace(t *testing.T) {
	t.Run("writes on-success", func(t *testing.T) {
		answer, after := runPut(t, putBase, `{"name":"triage","cron":"0 9 * * 1-5","repo":"/x","prompt":"p","close_workspace":"on-success"}`, "--original", "triage")
		if strings.Contains(answer, `"problem"`) {
			t.Fatalf("put refused it: %s", answer)
		}
		if !strings.Contains(after, "close_workspace: on-success") {
			t.Fatalf("close_workspace not written:\n%s", after)
		}
	})

	t.Run("keeps a hand-written value when the key is not sent", func(t *testing.T) {
		_, after := runPut(t, putBase+"    close_workspace: on-success\n", `{"name":"triage","cron":"0 9 * * 1-5","repo":"/x","prompt":"p"}`, "--original", "triage")
		if !strings.Contains(after, "close_workspace: on-success") {
			t.Fatalf("hand-written close_workspace lost:\n%s", after)
		}
	})

	t.Run("removes the key when sent empty", func(t *testing.T) {
		_, after := runPut(t, putBase+"    close_workspace: on-success\n", `{"name":"triage","cron":"0 9 * * 1-5","repo":"/x","prompt":"p","close_workspace":""}`, "--original", "triage")
		if strings.Contains(after, "close_workspace") {
			t.Fatalf("an empty close_workspace left the key:\n%s", after)
		}
	})

	t.Run("accepts on-success with an existing workspace", func(t *testing.T) {
		shared := putBase + "    workspace: existing\n    workspace_id: w7\n"
		answer, after := runPut(t, shared, `{"name":"triage","cron":"0 9 * * 1-5","repo":"/x","prompt":"p","workspace":"existing","workspace_id":"w7","close_workspace":"on-success"}`, "--original", "triage")
		if strings.Contains(answer, `"problem"`) {
			t.Fatalf("put refused it: %s", answer)
		}
		if !strings.Contains(after, "close_workspace: on-success") {
			t.Fatalf("close_workspace not written:\n%s", after)
		}
	})
}

// blocked_grace_minutes is one of the keys a put that does not send it must
// leave alone; sending 0 removes it and reads as the default.
func TestPutCarriesBlockedGrace(t *testing.T) {
	with := putBase + "    blocked_grace_minutes: 7\n"

	t.Run("writes it", func(t *testing.T) {
		answer, after := runPut(t, putBase, `{"name":"triage","cron":"0 9 * * 1-5","repo":"/x","prompt":"p","blocked_grace_minutes":5}`, "--original", "triage")
		if strings.Contains(answer, `"problem"`) {
			t.Fatalf("put refused it: %s", answer)
		}
		if !strings.Contains(after, "blocked_grace_minutes: 5") {
			t.Fatalf("blocked_grace_minutes not written:\n%s", after)
		}
	})

	t.Run("keeps a hand-written value when the key is not sent", func(t *testing.T) {
		_, after := runPut(t, with, `{"name":"triage","cron":"0 9 * * 1-5","repo":"/x","prompt":"p"}`, "--original", "triage")
		if !strings.Contains(after, "blocked_grace_minutes: 7") {
			t.Fatalf("hand-written blocked_grace_minutes lost:\n%s", after)
		}
	})

	t.Run("removes the key when sent zero", func(t *testing.T) {
		_, after := runPut(t, with, `{"name":"triage","cron":"0 9 * * 1-5","repo":"/x","prompt":"p","blocked_grace_minutes":0}`, "--original", "triage")
		if strings.Contains(after, "blocked_grace_minutes") {
			t.Fatalf("a zero blocked_grace_minutes left the key:\n%s", after)
		}
	})
}
