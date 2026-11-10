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
    let before = inputs_print(b"", &snap.print, &[], &[]);
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
