//! The suite never reads the harness homes, state or ledger of the machine running it. The outer
//! test runs this test binary again with each of those variables pointing into a populated decoy
//! folder; the inner test then syncs in-process and through the binary, and finds nothing there.
//! Synthetic fixtures only.

mod common;

use std::fs;
use std::path::Path;
use std::process::Command;

use common::{Env, U1, claude_line, write_lines};
use ruzstd::encoding::{CompressionLevel, compress_to_vec};

const INNER: &str = "METER_TEST_DECOY_INNER";
const DECOY: &str = "METER_TEST_DECOY_DIR";

/// Every variable the meter reads a home, state directory or ledger from.
const VARS: [(&str, &str); 8] = [
    ("DSH_HOME", "dsh"),
    ("CODEX_HOME", "codex"),
    ("CLAUDE_CONFIG_DIR", "claude"),
    ("HERDR_APP_HOME", "herdr"),
    (
        "HERDR_WORKERS_LEDGER",
        "herdr/automagik-herdr/workers.jsonl",
    ),
    ("AM_HOME", "am"),
    ("XDG_STATE_HOME", "xdg"),
    ("METER_STATE_DIR", "state"),
];

fn populate(decoy: &Path) {
    let now = meter::time::now_ms();
    let session = decoy.join("dsh/sessions/-work-app/sess-decoy");
    fs::create_dir_all(&session).unwrap();
    let rows = format!(
        "{}\n{}\n",
        r#"{"type":"session","version":4,"id":"sess-decoy","createdAt":1,"cwd":"/work/app","isSeeded":false,"delegationDepth":0}"#,
        format_args!(
            r#"{{"type":"assistant/message","seq":0,"time":{now},"data":{{"message":{{"id":"decoy-1","source":{{"model":"model-d"}}}},"usage":{{"inputTokens":5,"totalTokens":5}}}}}}"#
        )
    );
    fs::write(
        session.join("session.v4.jsonl.zstd"),
        compress_to_vec(rows.as_bytes(), CompressionLevel::Fastest),
    )
    .unwrap();
    let ts = meter::time::format_rfc3339(now);
    let claude = decoy.join("claude/projects/-work-app/sess-decoy.jsonl");
    fs::create_dir_all(claude.parent().unwrap()).unwrap();
    write_lines(&claude, &[claude_line("m", "r", &ts, "model-a", &U1, 0)]);
    fs::create_dir_all(decoy.join("codex")).unwrap();
    fs::write(decoy.join("codex/state_5.sqlite"), "not a database").unwrap();
    fs::create_dir_all(decoy.join("herdr/automagik-herdr")).unwrap();
    fs::write(decoy.join("herdr/automagik-herdr/workers.jsonl"), "{}\n").unwrap();
}

/// The decoy folder's file listing, to show nothing was written into it.
fn listing(dir: &Path) -> Vec<String> {
    fn walk(dir: &Path, out: &mut Vec<String>) {
        for e in fs::read_dir(dir).into_iter().flatten().flatten() {
            let p = e.path();
            out.push(p.to_string_lossy().into_owned());
            if p.is_dir() {
                walk(&p, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, &mut out);
    out.sort();
    out
}

#[test]
fn ambient_harness_homes_never_reach_the_tests() {
    let decoy = tempfile::tempdir().unwrap();
    populate(decoy.path());
    let before = listing(decoy.path());
    let mut c = Command::new(std::env::current_exe().unwrap());
    c.args(["decoy_inner", "--exact", "--nocapture", "--test-threads=1"])
        .env(INNER, "1")
        .env(DECOY, decoy.path());
    for (var, rel) in VARS {
        c.env(var, decoy.path().join(rel));
    }
    let out = c.output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "{stdout}{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(stdout.contains("decoy_inner: checked"), "{stdout}");
    assert_eq!(
        listing(decoy.path()),
        before,
        "something wrote into the decoy"
    );
}

/// Runs only inside the outer test, with the decoy variables set.
#[test]
fn decoy_inner() {
    if std::env::var_os(INNER).is_none() {
        return;
    }
    let decoy = std::path::PathBuf::from(std::env::var_os(DECOY).unwrap());
    assert!(decoy.join("dsh/sessions").is_dir());
    let env = Env::new();
    // In-process, the way most tests sync.
    let r = env.run(&env.opts());
    assert_eq!(r.files_seen, 0, "an in-process sync read a decoy file");
    let doc = r.summary.unwrap();
    assert_eq!(doc["sources"]["codex"]["status"], "absent", "{doc}");
    assert!(env.store().rows_since(i64::MIN).unwrap().is_empty());
    // In-process, from Options built by hand: `Options::new` reads DSH_HOME, CODEX_HOME and
    // CLAUDE_CONFIG_DIR, which point into the decoy here. Env::run (every in-process sync goes
    // through Env::sync) moves each harness root back under the temp home.
    let mut hand = meter::sync::Options::new(env.home(), env.state(), common::now());
    for root in [&hand.dsh_root, &hand.codex_home, &hand.claude_root] {
        assert!(
            root.starts_with(&decoy),
            "the decoy reaches Options::new: {}",
            root.display()
        );
    }
    hand.use_hc = false;
    hand.resolve_repos = false;
    hand.publish = false;
    hand.force = true;
    let r = env.run(&hand);
    assert_eq!(
        r.files_seen, 0,
        "a hand-built in-process sync read a decoy file"
    );
    assert!(env.store().rows_since(i64::MIN).unwrap().is_empty());
    let o = env.hermetic(&hand);
    for root in [&o.omp_root, &o.claude_root, &o.codex_home, &o.dsh_root] {
        assert!(root.starts_with(env.home()), "{}", root.display());
    }
    // Through the binary, the way the process and migrate tests run it: its default state
    // directory lands in the temp home, never in AM_HOME, XDG_STATE_HOME or METER_STATE_DIR.
    let out = env
        .command()
        .args(["sync", "--force", "--no-publish"])
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "{stdout}{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(stdout.contains("from 0 of 0 files"), "{stdout}");
    let db = env.home().join(".automagik/meter/meter.db");
    let store = meter::store::Store::open(&db).unwrap();
    assert_eq!(
        store.meta("codex_status").unwrap().as_deref(),
        Some("absent")
    );
    assert!(store.rows_since(i64::MIN).unwrap().is_empty());
    // The query through the binary reads the temp home's store, never METER_STATE_DIR's decoy.
    let out = env
        .command()
        .args([
            "query",
            "--repo",
            "example.com/acme/app",
            "--branch",
            "feat/x",
            "--json",
        ])
        .output()
        .unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(out.status.code(), Some(0), "{v}");
    assert_eq!(v["store"]["location"], "current", "{v}");
    println!("decoy_inner: checked");
}
