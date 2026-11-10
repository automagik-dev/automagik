//! What `usagemeter sync` records for `usagemeter outcomes` (issue 899): one small row per tool
//! failure a harness flagged, how each launch's terminal ended, and each branch's pull request
//! as Herdr recorded it.
//!
//! Everything here is additive to a schema 3 store and made by `sync` alone, the first time it
//! runs: two tables and five `launch` columns. A read never adds them, and an older meter reads
//! and writes the store as before, without seeing them. That older meter moves the log offsets on
//! without recording a failure, so each sync stamps how far the failures go
//! ([`THROUGH_META`], [`FILES_META`]); when another sync has run since, the failures start again
//! from now ([`FROM_META`]). What lies between is unknown, never 0.
//!
//! No row holds a tool name, an argument, an output or an error text: a failure is its time, its
//! harness, the launch it resolves to and a keyed hash of its id.

use std::collections::{BTreeMap, HashMap};

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::evidence::{self, Actor, Dim, Interner};
use crate::ledger::{EndDetail, PrRow};
use crate::time::DAY_MS;

/// The `meta` key of the start of the recorded tool failures (ms): a window that starts before it
/// is partial, and one that ends before it has none recorded.
pub const FROM_META: &str = "errors_from_ms";
/// The `meta` key of the last run that recorded tool failures: `last_run_ms` as this meter left
/// it. A later `last_run_ms` is a sync that read logs without recording any.
pub const THROUGH_META: &str = "errors_through_ms";
/// The `meta` key of the log offsets as the last recording run left them (`count|sum`): offsets
/// that moved since were moved by a run that stamped nothing, an older meter's failed one included.
pub const FILES_META: &str = "errors_files";

/// The one kind of failure a log yields, and where it comes from.
pub const TOOL_ERROR: &str = "tool_error";
pub const HARNESS_LOG: &str = "harness_log";
/// A launch's end as hc's list of finished terminals gave it, or as an `end` row copied it.
pub const HC_SNAPSHOT: &str = "hc_snapshot";
pub const WORKERS_LEDGER: &str = "workers_ledger";

/// Pull-request rows are kept this long after Herdr last recorded them, like closed launches.
pub const PR_DAYS: i64 = evidence::LINK_DAYS;

/// `ev_error_ts` holds everything a window's count groups by, so the report reads the index
/// alone: on 180,000 failures that is the difference between its d30 scan fitting the ceiling
/// with room and not.
pub const DDL: &str = "
CREATE TABLE IF NOT EXISTS ev_error (
  id INTEGER PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  dim INTEGER NOT NULL,
  actor INTEGER NOT NULL,
  session BLOB, parent BLOB,
  cwd INTEGER, session_cwd INTEGER,
  ident BLOB NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ev_error_ts ON ev_error(ts_ms, dim, actor, kind, source);
CREATE INDEX IF NOT EXISTS ev_error_session ON ev_error(session);
CREATE INDEX IF NOT EXISTS ev_error_parent ON ev_error(parent) WHERE parent IS NOT NULL;
CREATE INDEX IF NOT EXISTS ev_error_session_cwd ON ev_error(session_cwd);
CREATE TABLE IF NOT EXISTS pr (
  project TEXT NOT NULL, branch TEXT NOT NULL, pr INTEGER NOT NULL,
  repo TEXT, task TEXT, state TEXT NOT NULL,
  first_commit_ms INTEGER, opened_ms INTEGER, merged_ms INTEGER, closed_ms INTEGER,
  at_ms INTEGER NOT NULL,
  PRIMARY KEY(project, branch, pr)
) WITHOUT ROWID;
";

/// The columns a launch gains: hc's reason, exit status and signal, where they came from and
/// when hc says the terminal finished.
pub const LAUNCH_COLUMNS: [(&str, &str); 5] = [
    ("end_reason", "TEXT"),
    ("exit_code", "INTEGER"),
    ("signal", "TEXT"),
    ("end_source", "TEXT"),
    ("ended_ms", "INTEGER"),
];

pub fn table_exists(c: &Connection, name: &str) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |r| r.get(0),
    )
}

pub fn column_exists(c: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT count(*) > 0 FROM pragma_table_info(?1) WHERE name = ?2",
        [table, column],
        |r| r.get(0),
    )
}

fn meta_i64(c: &Connection, k: &str) -> rusqlite::Result<Option<i64>> {
    Ok(c.query_row("SELECT v FROM meta WHERE k = ?1", [k], |r| {
        r.get::<_, String>(0)
    })
    .optional()?
    .and_then(|v| v.trim().parse().ok()))
}

fn set_meta(c: &Connection, k: &str, v: &str) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO meta(k, v) VALUES(?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        [k, v],
    )?;
    Ok(())
}

/// The log offsets as they stand: how many files, and the sum of how far each is read.
fn files_print(c: &Connection) -> rusqlite::Result<String> {
    c.query_row(
        "SELECT count(*) || '|' || coalesce(sum(offset), 0) FROM files",
        [],
        |r| r.get(0),
    )
}

/// Makes the tables and columns where they are missing and settles where the recorded failures
/// start, in one transaction, before this sync reads a log:
///
/// - made now, over a store that has read no log: from the start of the window (never before the
///   evidence's day bound, whose rows a prune would drop at once);
/// - made now, over a store that has read logs: from now, since their failures were skipped;
/// - a sync ran since the last one that recorded failures (an older meter, after a rollback), or
///   the log offsets moved with no stamp: from now. The gap is unknown, never 0.
pub fn ensure(conn: &mut Connection, now_ms: i64, counted_from: i64) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(DDL)?;
    for (col, ty) in LAUNCH_COLUMNS {
        if !column_exists(&tx, "launch", col)? {
            tx.execute_batch(&format!("ALTER TABLE launch ADD COLUMN {col} {ty}"))?;
        }
    }
    let last_run = meta_i64(&tx, "last_run_ms")?;
    let files = files_print(&tx)?;
    let from = match meta_i64(&tx, FROM_META)? {
        None if files.starts_with("0|") => Some(counted_from.max(evidence::retention_cut(now_ms))),
        None => Some(now_ms),
        Some(_) => {
            let through = meta_i64(&tx, THROUGH_META)?;
            let stamped: Option<String> = tx
                .query_row("SELECT v FROM meta WHERE k = ?1", [FILES_META], |r| {
                    r.get(0)
                })
                .optional()?;
            let ran_since = last_run.is_some_and(|l| through.is_none_or(|t| l > t));
            let moved = stamped.as_deref() != Some(files.as_str());
            (ran_since || moved).then_some(now_ms)
        }
    };
    if let Some(from) = from {
        set_meta(&tx, FROM_META, &from.to_string())?;
        // Until this run stamps its own end, the failures go as far as the logs were read.
        match last_run {
            Some(l) => set_meta(&tx, THROUGH_META, &l.to_string())?,
            None => {
                tx.execute("DELETE FROM meta WHERE k = ?1", [THROUGH_META])?;
            }
        }
        set_meta(&tx, FILES_META, &files)?;
    }
    tx.commit()
}

/// Stamps a finished run: the failures go through `now_ms`, with the offsets as they stand. Called
/// with the run's own `last_run_ms`.
pub fn stamp(c: &Connection, now_ms: i64) -> rusqlite::Result<()> {
    set_meta(c, THROUGH_META, &now_ms.to_string())?;
    set_meta(c, FILES_META, &files_print(c)?)
}

/// A reset drops every log offset, so the logs are read again from their start: the failures go
/// with the rows, and start where [`ensure`] next puts them.
pub fn clear(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    if table_exists(tx, "ev_error")? {
        tx.execute("DELETE FROM ev_error", [])?;
    }
    tx.execute(
        "DELETE FROM meta WHERE k IN (?1, ?2, ?3)",
        [FROM_META, THROUGH_META, FILES_META],
    )?;
    Ok(())
}

/// One tool failure, as ingestion hands it to the store.
#[derive(Debug, Clone, PartialEq)]
pub struct ErrorRow {
    pub ts_ms: i64,
    pub dim: Dim,
    pub actor: Actor,
    pub session: Option<[u8; 16]>,
    pub parent: Option<[u8; 16]>,
    pub cwd: Option<String>,
    pub session_cwd: Option<String>,
    /// The failure's id, hashed with the store's key: a copy of its line in another file (a
    /// sub-agent transcript, a fork) is the same failure, counted once.
    pub ident: [u8; 16],
}

/// Inserts one failure, unless the store holds it already. Whether it was new.
pub fn insert(tx: &Transaction<'_>, intern: &mut Interner, e: &ErrorRow) -> rusqlite::Result<bool> {
    let dim = intern.dim(tx, &e.dim)?;
    let actor = intern.actor(tx, &e.actor)?;
    let cwd = intern.cwd(tx, e.cwd.as_deref())?;
    let session_cwd = intern.cwd(tx, e.session_cwd.as_deref())?;
    let n = tx
        .prepare_cached(
            "INSERT OR IGNORE INTO ev_error(ts_ms, kind, source, dim, actor, session, parent, cwd,
               session_cwd, ident)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )?
        .execute(params![
            e.ts_ms,
            TOOL_ERROR,
            HARNESS_LOG,
            dim,
            actor,
            e.session.map(|b| b.to_vec()),
            e.parent.map(|b| b.to_vec()),
            cwd,
            session_cwd,
            e.ident.to_vec()
        ])?;
    Ok(n == 1)
}

/// One stored failure, as the recompute pass reads it back.
#[derive(Debug, Clone)]
pub struct Stored {
    pub id: i64,
    pub ts_ms: i64,
    pub harness: String,
    pub branch: Option<String>,
    pub actor: Actor,
    pub session: Option<Vec<u8>>,
    pub parent: Option<Vec<u8>>,
    pub cwd: Option<String>,
    pub session_cwd: Option<String>,
}

const STORED: &str = "SELECT e.id, e.ts_ms, d.harness, d.branch, a.state, a.reason, a.bot, a.kind,
    a.role, a.squad, a.unrecorded, a.task, a.project, a.filled_branch, a.basis, e.session,
    e.parent, c.path, sc.path
  FROM ev_error e JOIN ev_dim d ON d.id = e.dim JOIN ev_actor a ON a.id = e.actor
  LEFT JOIN ev_cwd c ON c.id = e.cwd LEFT JOIN ev_cwd sc ON sc.id = e.session_cwd";

fn stored(r: &rusqlite::Row<'_>) -> rusqlite::Result<Stored> {
    Ok(Stored {
        id: r.get(0)?,
        ts_ms: r.get(1)?,
        harness: r.get(2)?,
        branch: r.get(3)?,
        actor: Actor {
            state: r.get(4)?,
            reason: r.get(5)?,
            bot: r.get(6)?,
            kind: r.get(7)?,
            role: r.get(8)?,
            squad: r.get(9)?,
            unrecorded: r.get(10)?,
            task: r.get(11)?,
            project: r.get(12)?,
            filled_branch: r.get(13)?,
            basis: r.get(14)?,
        },
        session: r.get(15)?,
        parent: r.get(16)?,
        cwd: r.get(17)?,
        session_cwd: r.get(18)?,
    })
}

/// The failures a dirty key names, as [`evidence::calls_of`] names its calls: a session (`s:<hex>`,
/// its own and its sub-agents') or a start folder (`c:<path>`).
pub fn errors_of(c: &Connection, key: &str) -> rusqlite::Result<Vec<Stored>> {
    if let Some(h) = key.strip_prefix("s:") {
        let Some(b) = evidence::from_hex(h) else {
            return Ok(Vec::new());
        };
        let mut st = c.prepare_cached(&format!(
            "{STORED} WHERE e.session = ?1 OR e.parent = ?1 ORDER BY e.id"
        ))?;
        return st.query_map([b], stored)?.collect();
    }
    if let Some(p) = key.strip_prefix("c:") {
        let mut st = c.prepare_cached(&format!(
            "{STORED} WHERE e.session_cwd = (SELECT id FROM ev_cwd WHERE path = ?1) ORDER BY e.id"
        ))?;
        return st.query_map([p], stored)?.collect();
    }
    Ok(Vec::new())
}

/// Points a failure at the attribution its launch gives it now. A failure has no rollup: the
/// report counts the rows themselves.
pub fn reattribute(
    tx: &Transaction<'_>,
    intern: &mut Interner,
    id: i64,
    to: &Actor,
) -> rusqlite::Result<()> {
    let actor = intern.actor(tx, to)?;
    tx.execute(
        "UPDATE ev_error SET actor = ?1 WHERE id = ?2",
        params![actor, id],
    )?;
    Ok(())
}

/// Keeps the failures within the evidence's bounds: what [`evidence::prune`] dropped by its day or
/// byte bound goes here too, and the failures then start no earlier than the evidence does.
/// Pull-request rows Herdr last recorded more than [`PR_DAYS`] ago go as well. The caller holds
/// the transaction, after [`evidence::prune`]. Returns the failures removed.
pub fn prune(tx: &Transaction<'_>, now_ms: i64) -> rusqlite::Result<usize> {
    let cut = evidence::retention_cut(now_ms).max(meta_i64(tx, evidence::FROM_META)?.unwrap_or(0));
    let n = tx.execute("DELETE FROM ev_error WHERE ts_ms < ?1", [cut])?;
    if n > 0 && meta_i64(tx, FROM_META)?.is_some_and(|f| f < cut) {
        set_meta(tx, FROM_META, &cut.to_string())?;
    }
    tx.execute(
        "DELETE FROM pr WHERE at_ms < ?1",
        [now_ms - PR_DAYS * DAY_MS],
    )?;
    Ok(n)
}

/// A pull request as the store keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Folded {
    repo: Option<String>,
    task: Option<String>,
    state: String,
    first_commit_ms: Option<i64>,
    opened_ms: Option<i64>,
    merged_ms: Option<i64>,
    closed_ms: Option<i64>,
    at_ms: i64,
}

impl Folded {
    /// One more row of the same pull request. The newest row (by Herdr's `at`; of two with the
    /// same `at`, the later in the file) gives the state, and each time comes from the newest row
    /// that has it: a merge row written after the branch is gone keeps the first commit an
    /// earlier row read, and a row that arrives late still fills what the newer one left out.
    fn take(&mut self, p: &PrRow, repo: &Option<String>) {
        fn pick<T: Clone>(newer: bool, new: &Option<T>, old: &mut Option<T>) {
            if new.is_some() && (newer || old.is_none()) {
                old.clone_from(new);
            }
        }
        let newer = p.at_ms >= self.at_ms;
        pick(newer, repo, &mut self.repo);
        pick(newer, &p.task, &mut self.task);
        pick(newer, &p.first_commit_ms, &mut self.first_commit_ms);
        pick(newer, &p.opened_ms, &mut self.opened_ms);
        pick(newer, &p.merged_ms, &mut self.merged_ms);
        pick(newer, &p.closed_ms, &mut self.closed_ms);
        if newer {
            self.state = p.state.to_string();
            self.at_ms = p.at_ms;
        }
    }
}

/// Folds the ledgers' `pr` rows into the store, in file order ([`Folded::take`]). `repo` is each
/// row's, derived from its project folder by the caller: no remote address is read from a row.
/// A row Herdr recorded more than [`PR_DAYS`] ago is not kept. The ledgers are read whole on
/// every sync, so only a pull request that changed is written. Returns the rows written.
pub fn fold_prs(
    tx: &Transaction<'_>,
    rows: &[(&PrRow, Option<String>)],
    now_ms: i64,
) -> rusqlite::Result<usize> {
    let old = now_ms - PR_DAYS * DAY_MS;
    let mut stored: HashMap<(String, String, i64), Folded> = HashMap::new();
    {
        let mut st = tx.prepare(
            "SELECT project, branch, pr, repo, task, state, first_commit_ms, opened_ms, merged_ms,
                    closed_ms, at_ms FROM pr",
        )?;
        let mut q = st.query([])?;
        while let Some(r) = q.next()? {
            stored.insert(
                (r.get(0)?, r.get(1)?, r.get(2)?),
                Folded {
                    repo: r.get(3)?,
                    task: r.get(4)?,
                    state: r.get(5)?,
                    first_commit_ms: r.get(6)?,
                    opened_ms: r.get(7)?,
                    merged_ms: r.get(8)?,
                    closed_ms: r.get(9)?,
                    at_ms: r.get(10)?,
                },
            );
        }
    }
    let mut folded: BTreeMap<(String, String, i64), Folded> = BTreeMap::new();
    for (p, repo) in rows {
        if p.at_ms < old {
            continue;
        }
        let key = (p.project.clone(), p.branch.clone(), p.pr);
        let f = folded.entry(key).or_insert_with_key(|k| {
            stored.get(k).cloned().unwrap_or(Folded {
                repo: None,
                task: None,
                state: p.state.to_string(),
                first_commit_ms: None,
                opened_ms: None,
                merged_ms: None,
                closed_ms: None,
                at_ms: i64::MIN,
            })
        });
        f.take(p, repo);
    }
    let mut st = tx.prepare_cached(
        "INSERT OR REPLACE INTO pr(project, branch, pr, repo, task, state, first_commit_ms,
           opened_ms, merged_ms, closed_ms, at_ms)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )?;
    let mut n = 0;
    for (k, f) in &folded {
        if stored.get(k) == Some(f) {
            continue;
        }
        n += st.execute(params![
            k.0,
            k.1,
            k.2,
            f.repo,
            f.task,
            f.state,
            f.first_commit_ms,
            f.opened_ms,
            f.merged_ms,
            f.closed_ms,
            f.at_ms
        ])?;
    }
    Ok(n)
}

/// How one terminal ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct End {
    pub terminal: String,
    pub created_ms: i64,
    pub ended_ms: Option<i64>,
    pub reason: Option<String>,
    pub exit_code: Option<i64>,
    pub signal: Option<String>,
    /// [`HC_SNAPSHOT`] or [`WORKERS_LEDGER`].
    pub source: &'static str,
}

impl End {
    pub fn of_hc(e: &crate::hc::TerminalEnd) -> End {
        End {
            terminal: e.terminal.clone(),
            created_ms: e.created_ms,
            ended_ms: Some(e.finished_ms),
            reason: e.reason.clone(),
            exit_code: e.exit_code,
            signal: e.signal.clone(),
            source: HC_SNAPSHOT,
        }
    }

    pub fn of_ledger(e: &EndDetail) -> End {
        End {
            terminal: e.terminal.clone(),
            created_ms: e.created_ms,
            ended_ms: None,
            reason: e.reason.clone(),
            exit_code: e.exit_code,
            signal: e.signal.clone(),
            source: WORKERS_LEDGER,
        }
    }
}

/// Writes how each launch's terminal ended onto its launch row, once: the first source to say so
/// is kept (hc's own list goes first). A launch of another core is never touched. Returns the
/// launches that gained their end.
pub fn record_ends(
    tx: &Transaction<'_>,
    core: Option<&str>,
    ends: &[End],
) -> rusqlite::Result<usize> {
    let mut st = tx.prepare_cached(
        "UPDATE launch SET end_reason = ?4, exit_code = ?5, signal = ?6, end_source = ?7,
           ended_ms = ?8
         WHERE terminal = ?1 AND created_ms = ?2 AND end_source IS NULL
           AND (core IS NULL OR ?3 IS NULL OR core = ?3)",
    )?;
    let mut n = 0;
    for e in ends {
        if e.reason.is_none() && e.exit_code.is_none() && e.signal.is_none() {
            continue;
        }
        n += st.execute(params![
            e.terminal,
            e.created_ms,
            core,
            e.reason,
            e.exit_code,
            e.signal,
            e.source,
            e.ended_ms
        ])?;
    }
    Ok(n)
}

/// Whether any launch still waits for its end: only then is hc asked for its finished terminals.
pub fn ends_wanted(c: &Connection) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT count(*) > 0 FROM (SELECT 1 FROM launch
           WHERE end_source IS NULL AND terminal IS NOT NULL LIMIT 1)",
        [],
        |r| r.get(0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    const DAY: i64 = DAY_MS;
    /// 2026-11-08T00:00:00Z.
    const NOW: i64 = 20_765 * DAY;

    fn from(s: &Store) -> Option<i64> {
        meta_i64(&s.conn, FROM_META).unwrap()
    }

    /// A log an earlier sync read as far as `offset`.
    fn read_log(s: &Store, path: &str, offset: i64) {
        s.conn
            .execute(
                "INSERT INTO files(path, source, dev, ino, size, mtime_ms, offset, head_len,
                   head_hash) VALUES(?1, 'claude', 1, 1, ?2, 0, ?2, 0, '')
                 ON CONFLICT(path) DO UPDATE SET offset = excluded.offset",
                params![path, offset],
            )
            .unwrap();
    }

    /// A sync of this meter, start to end.
    fn sync(s: &mut Store, now: i64, counted_from: i64) {
        ensure(&mut s.conn, now, counted_from).unwrap();
        s.set_meta("last_run_ms", &now.to_string()).unwrap();
        stamp(&s.conn, now).unwrap();
    }

    #[test]
    fn a_store_that_has_read_no_log_records_failures_from_its_window() {
        let mut s = Store::open_in_memory().unwrap();
        ensure(&mut s.conn, NOW, NOW - 10 * DAY).unwrap();
        assert_eq!(from(&s), Some(NOW - 10 * DAY));
        // Never before the evidence's day bound: a prune would drop those rows at once.
        let mut s = Store::open_in_memory().unwrap();
        ensure(&mut s.conn, NOW, NOW - 400 * DAY).unwrap();
        assert_eq!(from(&s), Some(evidence::retention_cut(NOW)));
    }

    #[test]
    fn a_store_that_had_read_logs_records_failures_from_now() {
        let mut s = Store::open_in_memory().unwrap();
        read_log(&s, "/logs/a.jsonl", 100);
        s.set_meta("last_run_ms", &(NOW - DAY).to_string()).unwrap();
        ensure(&mut s.conn, NOW, NOW - 10 * DAY).unwrap();
        assert_eq!(from(&s), Some(NOW));
    }

    #[test]
    fn errors_from_stays_while_only_this_meter_syncs() {
        let mut s = Store::open_in_memory().unwrap();
        sync(&mut s, NOW, NOW - 10 * DAY);
        read_log(&s, "/logs/a.jsonl", 100);
        stamp(&s.conn, NOW).unwrap();
        for later in [NOW + 60_000, NOW + 120_000] {
            ensure(&mut s.conn, later, NOW - 10 * DAY).unwrap();
            assert_eq!(
                from(&s),
                Some(NOW - 10 * DAY),
                "a run in between changes nothing"
            );
            read_log(&s, "/logs/a.jsonl", 100 + later - NOW);
            s.set_meta("last_run_ms", &later.to_string()).unwrap();
            stamp(&s.conn, later).unwrap();
        }
        // A sync that did nothing (within the fresh interval) stamps nothing and moves nothing.
        ensure(&mut s.conn, NOW + 180_000, NOW - 10 * DAY).unwrap();
        assert_eq!(from(&s), Some(NOW - 10 * DAY));
    }

    #[test]
    fn a_sync_that_recorded_no_failure_moves_errors_from_to_now() {
        // An older meter's run, after a rollback: it stamps its own end.
        let mut s = Store::open_in_memory().unwrap();
        sync(&mut s, NOW, NOW - 10 * DAY);
        s.set_meta("last_run_ms", &(NOW + 60_000).to_string())
            .unwrap();
        ensure(&mut s.conn, NOW + 120_000, NOW - 10 * DAY).unwrap();
        assert_eq!(from(&s), Some(NOW + 120_000));

        // One that read a log and died before its end stamp: the offsets moved all the same.
        let mut s = Store::open_in_memory().unwrap();
        sync(&mut s, NOW, NOW - 10 * DAY);
        read_log(&s, "/logs/a.jsonl", 100);
        ensure(&mut s.conn, NOW + 120_000, NOW - 10 * DAY).unwrap();
        assert_eq!(from(&s), Some(NOW + 120_000));
    }

    #[test]
    fn a_reset_drops_the_failures_and_starts_them_again() {
        let mut s = Store::open_in_memory().unwrap();
        read_log(&s, "/logs/a.jsonl", 100);
        sync(&mut s, NOW, NOW - 10 * DAY);
        assert_eq!(from(&s), Some(NOW));
        s.reset(NOW - 20 * DAY).unwrap();
        assert_eq!(from(&s), None);
        ensure(&mut s.conn, NOW + 60_000, NOW - 20 * DAY).unwrap();
        assert_eq!(
            from(&s),
            Some(NOW - 20 * DAY),
            "every log is read again from its start"
        );
    }

    fn failure(ts_ms: i64, ident: u8) -> ErrorRow {
        ErrorRow {
            ts_ms,
            dim: Dim {
                harness: "claude-code".into(),
                machine: "machine".into(),
                ..Dim::default()
            },
            actor: Actor {
                state: "unlinked".into(),
                reason: Some("no_record".into()),
                ..Actor::default()
            },
            session: Some([7; 16]),
            parent: None,
            cwd: None,
            session_cwd: None,
            ident: [ident; 16],
        }
    }

    #[test]
    fn a_failure_is_kept_once_and_pruned_with_the_evidence() {
        let mut s = Store::open_in_memory().unwrap();
        ensure(&mut s.conn, NOW, NOW - 200 * DAY).unwrap();
        let cut = evidence::retention_cut(NOW);
        let tx = s.conn.transaction().unwrap();
        let mut intern = Interner::default();
        assert!(insert(&tx, &mut intern, &failure(NOW - DAY, 1)).unwrap());
        assert!(
            !insert(&tx, &mut intern, &failure(NOW - DAY, 1)).unwrap(),
            "the same id"
        );
        assert!(insert(&tx, &mut intern, &failure(cut - 1, 2)).unwrap());
        // The byte bound moved the evidence's start past the day bound: the failures follow it.
        assert_eq!(prune(&tx, NOW).unwrap(), 1);
        set_meta(
            &tx,
            evidence::FROM_META,
            &(NOW - 12 * 3_600_000).to_string(),
        )
        .unwrap();
        assert_eq!(prune(&tx, NOW).unwrap(), 1);
        tx.commit().unwrap();
        assert_eq!(from(&s), Some(NOW - 12 * 3_600_000));
        let left: i64 = s
            .conn
            .query_row("SELECT count(*) FROM ev_error", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }
}
