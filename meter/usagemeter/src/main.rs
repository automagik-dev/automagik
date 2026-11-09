use std::process::ExitCode;
use std::time::Duration;

use meter::query::{self, Located};
use meter::store::{SCHEMA_VERSION, Store};
use meter::sync::{self, Options, Outcome};
use meter::time::{format_rfc3339, now_ms};
use meter::{paths, summary};

const USAGE: &str = "\
Usage:
  usagemeter sync [--force] [--backfill] [--days N] [--budget-secs N] [--no-publish] [--doc NAME]
  usagemeter status
  usagemeter query --repo HOST/OWNER/REPO --branch B [--branch B ...] --json
                   [--window d1|d7|d30] [--contract 1] [--stale-after SECONDS]
  usagemeter --version

sync      Read new harness usage (omp, Claude Code, Codex, dsh-tui) into the local store and
          publish the summary doc to herdr-core. Does nothing within 10 minutes of a complete sync.
  --force         Run even if the last sync is recent.
  --backfill      Re-import the full history (slow; resumes across runs).
  --days N        Import window in days (default 30). A wider window re-imports.
  --budget-secs N Stop after N seconds and resume next run (default 20).
  --no-publish    Do not write the summary doc.
  --doc NAME      Doc name to publish to (default herdr-meter).
status    Print the store's state as JSON. It never writes the store: the database's content
          does not change, nothing is migrated or locked, and the only files SQLite may add are
          the store's -wal and -shm. A folder it cannot write is read only when those exist.
query     Usage and estimated cost per branch of one repo, as the contract 1 envelope (RFC 0018,
          meter/schema/query/v1/) on stdout, for every exit below. It opens the store as status
          does; only sync refreshes the store. Capability meter.usage@1.

The state lives in METER_STATE_DIR if set, else $AM_HOME/meter, else ~/.automagik/meter.
The first sync moves the meter's files out of the pre-0.5.0 default directory.

Exit status of sync and status: 0 done or nothing to do, 2 an error, 3 sync blocked by the state
move, 4 sync refused a migration for want of free space (twice the store's size), 12 the store
was written by a newer meter (sync writes nothing to it). stderr says why.

Exit status of query: 0 answered, 1 error, 2 bad request, 10 no store, 11 no snapshot in time,
12 store from a newer meter, 13 store needs sync to migrate it, 14 contract not served, 15 the
answer is past the output cap.";

/// `sync` did nothing because files in the state directory must be resolved by hand first.
const EXIT_BLOCKED: u8 = 3;
/// `sync` refused a destructive migration: less than twice the store's size is free.
const EXIT_NO_SPACE: u8 = 4;

fn fail(msg: &str) -> ExitCode {
    eprintln!("meter: {msg}");
    ExitCode::from(2)
}

fn human_bytes(b: u64) -> String {
    const U: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = b as f64;
    let mut i = 0;
    while v >= 1000.0 && i < U.len() - 1 {
        v /= 1000.0;
        i += 1;
    }
    if i == 0 {
        format!("{b} B")
    } else {
        format!("{v:.1} {}", U[i])
    }
}

fn state_dirs() -> Result<paths::StateDirs, String> {
    paths::state_dirs(|k| std::env::var_os(k))
        .ok_or_else(|| "HOME is not set; set METER_STATE_DIR to choose a state directory".into())
}

fn parse_num(flag: &str, v: Option<String>, min: u64, max: u64) -> Result<u64, String> {
    let v = v.ok_or_else(|| format!("{flag} needs a number"))?;
    let n: u64 = v
        .parse()
        .map_err(|_| format!("{flag} needs a whole number, got {v:?}"))?;
    if n < min || n > max {
        return Err(format!("{flag} must be between {min} and {max}"));
    }
    Ok(n)
}

fn cmd_sync(args: Vec<String>) -> Result<ExitCode, String> {
    let home = paths::home().ok_or("HOME is not set")?;
    let dirs = state_dirs()?;
    let mut opts = Options::new(home, dirs.dir, now_ms());
    opts.migrate_from = dirs.legacy;
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--force" => opts.force = true,
            "--backfill" => opts.backfill = true,
            "--no-publish" => opts.publish = false,
            "--days" => opts.days = Some(parse_num("--days", it.next(), 1, 36_500)? as i64),
            "--budget-secs" => {
                opts.budget = Duration::from_secs(parse_num("--budget-secs", it.next(), 1, 3600)?)
            }
            "--doc" => {
                let name = it.next().ok_or("--doc needs a name")?;
                if name.is_empty()
                    || name.len() > 64
                    || !name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                {
                    return Err("--doc takes a name of letters, digits, - and _".into());
                }
                opts.doc_name = name;
            }
            "-h" | "--help" => {
                println!("{USAGE}");
                return Ok(ExitCode::SUCCESS);
            }
            other => {
                return Err(format!(
                    "unknown option {other:?} for sync; see usagemeter --help"
                ));
            }
        }
    }
    match sync::run(&opts).map_err(|e| e.0)? {
        Outcome::Locked => println!("meter: another sync is running; nothing to do"),
        // The one stderr line from the move says why and what to do. Not a success: a scheduled
        // run must not report one while nothing syncs.
        Outcome::Blocked => return Ok(ExitCode::from(EXIT_BLOCKED)),
        Outcome::NewerSchema { store } => {
            eprintln!(
                "meter: the store's schema_version is {store}, newer than this meter's \
                 {SCHEMA_VERSION}: it was written by a newer usagemeter, so nothing was read or \
                 written; update the meter"
            );
            return Ok(ExitCode::from(query::exit::NEWER_SCHEMA));
        }
        Outcome::NoSpace { free, needed } => {
            eprintln!(
                "meter: the store needs a migration, which keeps a copy first and needs {} free; \
                 only {} is free, so nothing was changed and the store keeps working as it is",
                human_bytes(needed),
                human_bytes(free)
            );
            return Ok(ExitCode::from(EXIT_NO_SPACE));
        }
        Outcome::Fresh { age_ms } => println!(
            "meter: last sync was {}s ago; nothing to do (use --force)",
            age_ms / 1000
        ),
        Outcome::Ran(r) => {
            let h = &r.health;
            println!(
                "meter: read {} from {} of {} files in {:.1}s; {} new usage events, {} duplicates dropped, {} skipped lines",
                human_bytes(r.bytes_read),
                r.files_read,
                r.files_seen,
                r.elapsed.as_secs_f64(),
                h.events,
                h.duplicates,
                h.skipped_lines
            );
            if let Some(g) = &r.generation {
                let rows: i64 = g.counts.values().sum();
                println!(
                    "meter: kept the store before the reset as {} ({rows} rows, every table's \
                     count checked)",
                    g.path.display()
                );
            }
            for g in &r.generations_removed {
                println!("meter: removed the generation {}", g.display());
            }
            if r.reimported {
                println!(
                    "meter: window widened or store rebuilt; re-imported from {}",
                    format_rfc3339(r.counted_from_ms)
                );
            }
            if r.pending_bytes > 0 {
                println!(
                    "meter: stopped at the time budget; {} in {} files left for the next run",
                    human_bytes(r.pending_bytes),
                    r.pending_files
                );
            }
            if h.rewrites > 0 {
                println!(
                    "meter: {} files were rewritten or truncated and read again",
                    h.rewrites
                );
            }
            if r.unreadable > 0 {
                println!("meter: {} files could not be read", r.unreadable);
            }
            match &r.published {
                None => println!(
                    "meter: summary ({}) not published (--no-publish)",
                    human_bytes(r.summary_bytes as u64)
                ),
                Some(Ok(v)) => println!(
                    "meter: published {} ({}) version {v}",
                    opts.doc_name,
                    human_bytes(r.summary_bytes as u64)
                ),
                Some(Err(e)) => println!("meter: summary not published: {e}"),
            }
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn cmd_status() -> Result<ExitCode, String> {
    let ctx = query::Ctx::from_env();
    let dirs = ctx
        .state
        .clone()
        .ok_or("HOME is not set; set METER_STATE_DIR to choose a state directory")?;
    // The query's read-only open: no lock (a sync may be running; a wal reader waits for nobody),
    // nothing migrated, the database's content unchanged (SQLite may add its -wal and -shm). A move
    // that has not finished opens nothing.
    let (db, location, stray) = match query::locate(&dirs, ctx.overridden)? {
        Located::Absent => {
            println!(
                "{}",
                serde_json::json!({"state_dir": dirs.dir, "synced": false})
            );
            return Ok(ExitCode::SUCCESS);
        }
        Located::Store {
            db,
            location,
            stray,
            ..
        } => (db, location, stray),
    };
    if query::read_only_folder(&db) {
        return Err(format!("read_only_folder: {}", query::READ_ONLY_FOLDER));
    }
    let store =
        Store::open_read_only(&db).map_err(|e| format!("cannot open {}: {e}", db.display()))?;
    store
        .conn
        .execute_batch("BEGIN")
        .map_err(|e| format!("cannot read {}: {e}", db.display()))?;
    let version = query::schema_version(&store.conn)
        .map_err(|e| format!("cannot read {}: {e}", db.display()))?;
    let get = |k: &str| store.meta_i64(k).ok().flatten();
    let current = version == Some(SCHEMA_VERSION);
    let sources = if current {
        sync::source_health(&store).map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };
    let v = serde_json::json!({
        "state_dir": db.parent(),
        "location": location.as_str(),
        "version": env!("CARGO_PKG_VERSION"),
        "schema_version": version,
        "supported_schema_version": SCHEMA_VERSION,
        "legacy_store": stray,
        "machine": store.meta("machine").ok().flatten().or_else(|| store.meta("machine_fallback").ok().flatten()),
        "counted_from": get("counted_from_ms").map(format_rfc3339),
        "last_success": get("last_success_ms").map(format_rfc3339),
        "last_run": get("last_run_ms").map(format_rfc3339),
        "pending_bytes": get("last_pending_bytes").unwrap_or(0),
        "pending_files": get("last_pending_files").unwrap_or(0),
        "rows": store.count("usage").unwrap_or(0),
        "files": store.count("files").unwrap_or(0),
        "dedupe_keys": store.count("seen").unwrap_or(0),
        "sessions": store.count("sessions").unwrap_or(0),
        "sources": sources.iter().map(|s| serde_json::json!({
            "harness": s.harness, "status": s.status, "reason": s.reason,
            "last_success": s.last_success_ms.map(format_rfc3339),
            "usage_lines": s.usage_lines, "events": s.events, "duplicates": s.duplicates,
            "skipped_lines": s.skipped_lines, "rewrites": s.rewrites,
            "threads": s.threads.map(|(e, t)| serde_json::json!({"exact": e, "total_only": t})),
        })).collect::<Vec<_>>(),
        "summary_schema_version": summary::SUMMARY_SCHEMA_VERSION,
    });
    println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
    Ok(ExitCode::SUCCESS)
}

fn cmd_query(args: &[String]) -> ExitCode {
    use std::io::Write;
    let a = query::run(args, &query::Ctx::from_env());
    let mut out = std::io::stdout().lock();
    if out
        .write_all(a.stdout.as_bytes())
        .and_then(|()| out.flush())
        .is_err()
    {
        return ExitCode::from(query::exit::ERROR);
    }
    ExitCode::from(a.code)
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let cmd = args.next();
    let rest: Vec<String> = args.collect();
    let r = match cmd.as_deref() {
        Some("sync") => cmd_sync(rest),
        Some("query") => return cmd_query(&rest),
        Some("status") if rest.is_empty() => cmd_status(),
        Some("status") => Err("status takes no options".into()),
        Some("--version" | "-V" | "version") => {
            println!("usagemeter {}", env!("CARGO_PKG_VERSION"));
            Ok(ExitCode::SUCCESS)
        }
        Some("-h" | "--help" | "help") | None => {
            println!("{USAGE}");
            Ok(ExitCode::SUCCESS)
        }
        Some(other) => Err(format!("unknown command {other:?}; see usagemeter --help")),
    };
    r.unwrap_or_else(|e| fail(&e))
}
