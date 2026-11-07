package config

import (
	"os"
	"strings"
	"testing"
)

func fileText(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(Path())
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

const commented = `# my automations
backend: hc
automations:
  # mornings
  - name: triage
    cron: "0 9 * * 1-5"   # weekdays
    repo: /x
    prompt: p
  - name: broken
    cron: "0 99 * * *"
    repo: /x
    prompt: p
`

// The panel edits one entry; the rest of the file is the user's, comments and
// broken siblings included. Save rewrites everything and refuses while one
// entry is broken, which would lock the panel out of the whole file.
func TestPutReplacesOneEntryAndKeepsTheRest(t *testing.T) {
	withConfig(t, commented)
	a := Automation{Name: "triage", Cron: "0 8 * * 1-5", Repo: "/x", Prompt: "new prompt"}
	if res, err := Put("triage", a, nil, false); err != nil || res.Problem != "" {
		t.Fatalf("put: %v %q", err, res.Problem)
	}
	text := fileText(t)
	for _, want := range []string{"# my automations", "# mornings", "new prompt", "0 8 * * 1-5", "name: broken"} {
		if !strings.Contains(text, want) {
			t.Errorf("file lost %q:\n%s", want, text)
		}
	}
}

// The panel's form knows only some keys. An edit must not drop the others:
// a paused entry edited in the panel came back resumed.
func TestPutKeepsTheKeysItWasNotGiven(t *testing.T) {
	withConfig(t, `automations:
  - name: triage
    cron: "0 9 * * 1-5"
    repo: /x
    model: opus
    prompt: p
    agent_args: [--verbose]   # keep me
    catch_up_minutes: 30
    disabled: true
`)
	a := Automation{Name: "triage", Cron: "0 8 * * 1-5", Repo: "/x", Prompt: "new prompt"}
	if res, err := Put("triage", a, []string{"name", "cron", "repo", "model", "prompt"}, false); err != nil || res.Problem != "" {
		t.Fatalf("put: %v %q", err, res.Problem)
	}
	cfg, _ := Load()
	got := cfg.Find("triage")
	if got == nil || !got.Disabled || got.CatchUpMinutes != 30 || len(got.AgentArgs) != 1 {
		t.Fatalf("lost keys it was not given: %+v", got)
	}
	if got.Model != "" || got.Prompt != "new prompt" || got.Cron != "0 8 * * 1-5" {
		t.Fatalf("given keys not applied (model must be cleared): %+v", got)
	}
	if !strings.Contains(fileText(t), "# keep me") {
		t.Errorf("an untouched key lost its comment:\n%s", fileText(t))
	}
}

// close_workspace is one key of the entry, so put's merge rules cover it like the rest: the form
// can set it, a put that does not send it keeps a hand-written value, and an empty value removes
// the key. A run that would close a shared workspace is refused by the loader's own validation.
func TestPutCarriesCloseWorkspace(t *testing.T) {
	base := `automations:
  - name: triage
    cron: "0 9 * * 1-5"
    repo: /x
    prompt: p
`
	with := base + "    close_workspace: on-success\n"
	given := []string{"name", "cron", "repo", "prompt", "close_workspace"}
	entry := func(close CloseWorkspace) Automation {
		return Automation{Name: "triage", Cron: "0 9 * * 1-5", Repo: "/x", Prompt: "p", CloseWorkspace: close}
	}

	t.Run("writes on-success", func(t *testing.T) {
		withConfig(t, base)
		if res, err := Put("triage", entry(CloseOnSuccess), given, false); err != nil || res.Problem != "" {
			t.Fatalf("put: %v %q", err, res.Problem)
		}
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Find("triage").CloseWorkspace != CloseOnSuccess {
			t.Fatalf("close_workspace not applied:\n%s", fileText(t))
		}
	})

	t.Run("keeps a hand-written value when the key is not given", func(t *testing.T) {
		withConfig(t, with)
		if res, err := Put("triage", entry(""), []string{"name", "cron", "repo", "prompt"}, false); err != nil || res.Problem != "" {
			t.Fatalf("put: %v %q", err, res.Problem)
		}
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Find("triage").CloseWorkspace != CloseOnSuccess {
			t.Fatalf("hand-written close_workspace lost:\n%s", fileText(t))
		}
	})

	t.Run("removes the key when given empty", func(t *testing.T) {
		withConfig(t, with)
		if res, err := Put("triage", entry(""), given, false); err != nil || res.Problem != "" {
			t.Fatalf("put: %v %q", err, res.Problem)
		}
		if strings.Contains(fileText(t), "close_workspace") {
			t.Fatalf("an empty close_workspace left the key:\n%s", fileText(t))
		}
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Find("triage").CloseWorkspace != CloseNever {
			t.Fatalf("the removed key does not read as never: %+v", cfg.Find("triage"))
		}
	})

	t.Run("refuses on-success with an existing workspace", func(t *testing.T) {
		shared := `automations:
  - name: triage
    cron: "0 9 * * 1-5"
    repo: /x
    prompt: p
    workspace: existing
    workspace_id: w7
`
		withConfig(t, shared)
		a := entry(CloseOnSuccess)
		a.Workspace, a.WorkspaceID = WorkspaceExisting, "w7"
		res, err := Put("triage", a, []string{"name", "cron", "repo", "prompt", "workspace", "workspace_id", "close_workspace"}, false)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(res.Problem, "close_workspace: on-success would close the shared workspace") {
			t.Fatalf("problem %q", res.Problem)
		}
		if fileText(t) != shared {
			t.Fatal("a refused put changed the file")
		}
	})
}

func TestPutAppendsANewEntry(t *testing.T) {
	withConfig(t, commented)
	a := Automation{Name: "digest", Cron: "0 17 * * 5", Repo: "/x", Prompt: "sum up"}
	if res, err := Put("", a, nil, false); err != nil || res.Problem != "" {
		t.Fatalf("put: %v %q", err, res.Problem)
	}
	cfg, _ := Load()
	if cfg.Find("digest") == nil || cfg.Find("triage") == nil {
		t.Fatalf("got %+v", cfg.Automations)
	}
}

func TestPutRefusesWhatWouldNotLoadAndWritesNothing(t *testing.T) {
	withConfig(t, commented)
	before := fileText(t)
	a := Automation{Name: "triage", Cron: "nope", Repo: "/x", Prompt: "p"}
	res, err := Put("triage", a, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Problem, "invalid cron") {
		t.Fatalf("problem %q", res.Problem)
	}
	if fileText(t) != before {
		t.Fatal("a refused put changed the file")
	}
}

func TestPutRefusesANameAlreadyTaken(t *testing.T) {
	withConfig(t, commented)
	a := Automation{Name: "broken", Cron: "@daily", Repo: "/x", Prompt: "p"}
	res, err := Put("", a, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Problem, "already") {
		t.Fatalf("problem %q", res.Problem)
	}
}

func TestPutDryRunPreviewsAndWritesNothing(t *testing.T) {
	withConfig(t, commented)
	before := fileText(t)
	a := Automation{Name: "triage", Cron: "0 8 * * 1-5", Repo: "/x", Prompt: "p"}
	res, err := Put("triage", a, nil, true)
	if err != nil || res.Problem != "" {
		t.Fatalf("put: %v %q", err, res.Problem)
	}
	if len(res.Next) != 3 || res.Next[0].Hour() != 8 {
		t.Fatalf("next %v", res.Next)
	}
	if fileText(t) != before {
		t.Fatal("dry run changed the file")
	}
}

func TestRemoveAndPauseKeepComments(t *testing.T) {
	withConfig(t, commented)
	if err := SetPaused("", true); err != nil {
		t.Fatal(err)
	}
	if err := SetPaused("triage", true); err != nil {
		t.Fatal(err)
	}
	cfg, _ := Load()
	if !cfg.Paused || !cfg.Find("triage").Disabled {
		t.Fatalf("paused %v, triage %+v", cfg.Paused, cfg.Find("triage"))
	}
	if err := Remove("broken"); err != nil {
		t.Fatal(err)
	}
	text := fileText(t)
	if strings.Contains(text, "broken") || !strings.Contains(text, "# weekdays") {
		t.Fatalf("got:\n%s", text)
	}
	if err := Remove("ghost"); err == nil {
		t.Fatal("removing a name that is not there must say so")
	}
}

// An edit must not reformat the entries it did not touch. yaml.v3 does
// normalise the gap before an inline comment to one space; that is all.
func TestEditsKeepTheFilesIndentation(t *testing.T) {
	for _, file := range []string{commented, strings.ReplaceAll(commented, "\n  ", "\n    ")} {
		withConfig(t, file)
		if err := SetPaused("", true); err != nil {
			t.Fatal(err)
		}
		if err := SetPaused("", false); err != nil {
			t.Fatal(err)
		}
		if got, want := fileText(t), strings.ReplaceAll(file, `"   # weekdays`, `" # weekdays`); got != want {
			t.Fatalf("round trip changed the file:\n--- before\n%s--- after\n%s", file, got)
		}
	}
}
