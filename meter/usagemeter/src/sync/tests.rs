//! Synthetic fixtures only: every id, path and name here is made up.

use super::*;
use crate::hc::{Labels, Terminal};

const NOW: i64 = 1_767_258_000_000;

/// Options for an in-process sync under `dir`: every root inside it, no ledger, no hc.
fn opts(dir: &std::path::Path, now: i64, snapshot: &[Terminal]) -> Options {
    let home = dir.join("home");
    let mut o = Options::new(home.clone(), dir.join("state"), now);
    o.omp_root = home.join(".omp/agent/sessions");
    o.claude_root = home.join(".claude/projects");
    o.codex_home = home.join(".codex");
    o.dsh_root = home.join(".dsh/sessions");
    o.agy_root = home.join(".gemini/antigravity-cli/conversations");
    o.app_home = None;
    o.workers_ledger = None;
    o.project_ledgers = false;
    o.migrate_from = None;
    o.use_hc = false;
    o.resolve_repos = false;
    o.publish = false;
    o.force = true;
    o.snapshot = Some(snapshot.to_vec());
    o
}

fn store(dir: &std::path::Path) -> Store {
    Store::open(&dir.join("state/meter.db")).unwrap()
}

/// The launch row's label claim: (kind, bot, bound).
fn claim(dir: &std::path::Path) -> (Option<String>, Option<String>, Option<String>) {
    store(dir)
        .conn
        .query_row(
            "SELECT kind, bot, bound FROM launch WHERE terminal = 't7'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap()
}

/// Leaves the launch row as a release before the label claims wrote it: no tag, no timeline.
fn forget_claim(dir: &std::path::Path) {
    let n = store(dir)
        .conn
        .execute(
            "UPDATE launch SET kind = NULL, bot = NULL, role = NULL, bound = NULL
             WHERE terminal = 't7'",
            [],
        )
        .unwrap();
    assert_eq!(n, 1);
}

/// Fixer on #949 (mutant M7): the fingerprint carries the derivation's version. A store an earlier
/// release left, whose terminals and ledgers do not change, still saves the first label sighting
/// on the first sync after the upgrade; without the version in the fingerprint that sync would
/// match the stored one, skip the diff, and the claim would never start.
#[test]
fn the_first_sync_after_the_upgrade_saves_a_label_sighting_with_nothing_else_changed() {
    let dir = tempfile::tempdir().unwrap();
    let dir = dir.path();
    std::fs::create_dir_all(dir.join("state")).unwrap();
    store(dir).set_meta("machine", "core-synthetic").unwrap();
    let seen = vec![Terminal {
        terminal: "t7".into(),
        created_ms: Some(NOW - 7_200_000),
        finished_ms: None,
        harness: Some("claude-code"),
        cwd: Some("/work/example-project/.worktrees/gh-45".into()),
        labels: Labels {
            worker_of: Some("b-hand".into()),
            worker_role: Some("dev".into()),
            ..Labels::default()
        },
    }];
    assert!(matches!(
        run(&opts(dir, NOW, &seen)).unwrap(),
        Outcome::Ran(_)
    ));
    let first = claim(dir);
    assert_eq!(first.0.as_deref(), Some("worker"));
    assert_eq!(first.1.as_deref(), Some("b-hand"));
    assert!(first.2.as_deref().is_some_and(|b| b.contains("b-hand")));
    // The control: with this release's own fingerprint stored and nothing changed, the diff is
    // skipped, so a row that lost its claim is not written again. The skip is real.
    forget_claim(dir);
    run(&opts(dir, NOW + 60_000, &seen)).unwrap();
    assert_eq!(claim(dir), (None, None, None));
    // The store as the earlier release left it: the same inputs, fingerprinted with no version.
    let s = store(dir);
    let snap = Snapshot::of(&s, Some("core-synthetic"), &seen, true, NOW + 120_000).unwrap();
    let before = inputs_print(b"", &snap.print, &[], &[], "");
    assert_ne!(
        s.meta(INPUTS_META).unwrap().as_deref(),
        Some(before.as_str())
    );
    s.set_meta(INPUTS_META, &before).unwrap();
    drop(s);
    run(&opts(dir, NOW + 120_000, &seen)).unwrap();
    let (kind, bot, bound) = claim(dir);
    assert_eq!(kind.as_deref(), Some("worker"));
    assert_eq!(bot.as_deref(), Some("b-hand"));
    // The sighting is the upgrade sync's own: the claim starts there, never earlier.
    assert_eq!(
        bound.as_deref(),
        Some(format!("~{}-:b-hand", NOW + 120_000).as_str())
    );
}

// ---- RFC 0026 (d): the dsh-tui seat --------------------------------------------------------

const ROOT: &str = "/work/example-project";

/// The active dsh-tui links at `basis`: (valid_from, a session label made it).
fn dsh_links(dir: &std::path::Path, basis: &str) -> Vec<(Option<i64>, bool)> {
    let s = store(dir);
    let mut st = s
        .conn
        .prepare(
            "SELECT valid_from, seen_first IS NOT NULL FROM link
             WHERE harness = 'dsh-tui' AND basis = ?1 AND superseded_by IS NULL ORDER BY id",
        )
        .unwrap();
    st.query_map([basis], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// A dsh-tui session's log, uncompressed: its header (with `terminal`, when given, under the
/// field's one name) and one call a minute after the session started.
fn dsh_log(dir: &std::path::Path, session: &str, terminal: Option<&str>, created: i64) {
    let field = terminal
        .map(|t| {
            format!(
                r#""{}":"{t}","#,
                crate::sources::dsh_tui::SESSION_TERMINAL_KEY
            )
        })
        .unwrap_or_default();
    let header = format!(
        r#"{{"type":"session","version":4,"id":"{session}","createdAt":{created},{field}"cwd":"{ROOT}","isSeeded":false,"delegationDepth":0}}"#
    );
    let call = format!(
        r#"{{"type":"assistant/message","seq":0,"time":{},"data":{{"turn":1,"step":0,"message":{{"role":"assistant","content":[{{"type":"text","text":"FAKE-ANSWER"}}],"source":{{"kind":"llm","provider":"example","model":"model-d"}},"id":"{session}-m0"}},"usage":{{"inputTokens":10,"outputTokens":5,"cacheReadTokens":0,"cacheWriteTokens":0,"totalTokens":15}},"stream":[]}}}}"#,
        created + 60_000
    );
    let p = dir
        .join("home/.dsh/sessions/-work-example-project")
        .join(session)
        .join("session.v4.jsonl");
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, format!("{header}\n{call}\n")).unwrap();
}

/// The bots the stored usage names, with their input tokens.
fn bots(dir: &std::path::Path) -> Vec<(Option<String>, i64)> {
    let mut m: std::collections::BTreeMap<Option<String>, i64> = Default::default();
    for r in store(dir).rows_since(i64::MIN).unwrap() {
        *m.entry(r.key.bot.clone()).or_default() += r.tokens.input_uncached;
    }
    m.into_iter().collect()
}

/// T4 (j): the fingerprint carries the header records. A store whose terminals and ledgers do not
/// change still writes the link of a dsh-tui session whose log is new: without the records in the
/// fingerprint that sync would match the stored one, skip the diff, and the link would wait for
/// an unrelated ledger or snapshot change.
#[test]
fn a_new_dsh_tui_log_writes_its_link_with_no_ledger_or_terminal_changed() {
    let dir = tempfile::tempdir().unwrap();
    let dir = dir.path();
    std::fs::create_dir_all(dir.join("state")).unwrap();
    store(dir).set_meta("machine", "core-synthetic").unwrap();
    let created = NOW - 3 * 3_600_000;
    let start = serde_json::json!({
        "event": "start", "kind": "seat", "terminal": "t1", "botId": "b-captain", "task": null,
        "worktree": ROOT, "agent": "dsh-tui", "role": "captain", "branch": null, "project": ROOT,
        "lead": null, "core": "core-synthetic", "created_ms": created, "squad": "b-squad",
        "session": null, "at": crate::time::format_rfc3339(created + 5_000)
    });
    let ledger = dir.join("ledger/workers.jsonl");
    std::fs::create_dir_all(ledger.parent().unwrap()).unwrap();
    std::fs::write(&ledger, format!("{start}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&ledger, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let with_ledger = |now: i64| {
        let mut o = opts(dir, now, &[]);
        o.workers_ledger = Some(ledger.clone());
        o
    };
    run(&with_ledger(NOW)).unwrap();
    assert_eq!(dsh_links(dir, "session"), []);
    let printed = store(dir).meta(INPUTS_META).unwrap();
    // The session's log appears; the ledger and the (empty) snapshot are what they were.
    let started = NOW - 2 * 3_600_000;
    dsh_log(dir, "sess-seat", Some("t1"), started);
    run(&with_ledger(NOW + 60_000)).unwrap();
    assert_eq!(bots(dir), [(Some("b-captain".to_owned()), 10)]);
    assert_eq!(dsh_links(dir, "session"), [(Some(started), false)]);
    assert_ne!(store(dir).meta(INPUTS_META).unwrap(), printed);
    // A log with no terminal in its header is no record: the fingerprint stays, and so the skip.
    let printed = store(dir).meta(INPUTS_META).unwrap();
    dsh_log(dir, "sess-hand", None, started);
    run(&with_ledger(NOW + 120_000)).unwrap();
    assert_eq!(store(dir).meta(INPUTS_META).unwrap(), printed);
    assert_eq!(bots(dir), [(None, 10), (Some("b-captain".to_owned()), 10)]);
    assert_eq!(dsh_links(dir, "session").len(), 1);
}

/// The derivation's version was bumped with the dsh-tui seat (`dsh-seat-v1`). A store the release
/// before left holds a dsh-tui pane's session label as a `label` link, under that release's
/// fingerprint; with no terminal or ledger changed, the first sync after the upgrade must still
/// write it as the `session` link it now is. Dropping the bump makes that sync match the stored
/// fingerprint and skip.
#[test]
fn the_first_sync_after_the_upgrade_rewrites_a_dsh_tui_label_link_at_session_basis() {
    let dir = tempfile::tempdir().unwrap();
    let dir = dir.path();
    std::fs::create_dir_all(dir.join("state")).unwrap();
    store(dir).set_meta("machine", "core-synthetic").unwrap();
    let seen = vec![Terminal {
        terminal: "t7".into(),
        created_ms: Some(NOW - 7_200_000),
        finished_ms: None,
        harness: Some("dsh-tui"),
        cwd: Some(ROOT.into()),
        labels: Labels {
            bot: Some("b-label".into()),
            role: Some("captain".into()),
            session: Some("sess-seat".into()),
            ..Labels::default()
        },
    }];
    run(&opts(dir, NOW, &seen)).unwrap();
    assert_eq!(dsh_links(dir, "session"), [(Some(NOW - 7_200_000), true)]);
    assert_eq!(dsh_links(dir, "label"), []);
    // The link as the release before wrote it.
    let as_before = |dir: &std::path::Path| {
        let n = store(dir)
            .conn
            .execute(
                "UPDATE link SET basis = 'label' WHERE harness = 'dsh-tui'",
                [],
            )
            .unwrap();
        assert_eq!(n, 1);
    };
    as_before(dir);
    // The control: under this release's own fingerprint, with nothing changed, the diff is
    // skipped and the row stays as it is. The skip is real.
    run(&opts(dir, NOW + 60_000, &seen)).unwrap();
    assert_eq!(dsh_links(dir, "session"), []);
    // The same inputs under the fingerprint of the release before.
    let s = store(dir);
    let snap = Snapshot::of(&s, Some("core-synthetic"), &seen, true, NOW + 120_000).unwrap();
    let before = inputs_print(b"labels-v1\x1e", &snap.print, &[], &[], "");
    assert_ne!(
        s.meta(INPUTS_META).unwrap().as_deref(),
        Some(before.as_str())
    );
    s.set_meta(INPUTS_META, &before).unwrap();
    drop(s);
    run(&opts(dir, NOW + 120_000, &seen)).unwrap();
    assert_eq!(dsh_links(dir, "session").len(), 1);
    assert!(dsh_links(dir, "session")[0].1, "a label made it");
}
