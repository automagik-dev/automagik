//! dsh-tui sessions read through a whole sync. Synthetic fixtures only: every id, path, model and
//! number here is made up, and no line holds real content.

mod common;

use std::fs;
use std::path::PathBuf;

use common::{Env, now};
use meter::event::Tokens;
use ruzstd::encoding::{CompressionLevel, compress_to_vec};

const SESSION: &str = "sess-dsh-1";

fn session_file(env: &Env) -> PathBuf {
    env.dsh(&format!("-work-app/{SESSION}/session.v4.jsonl.zstd"))
}

/// Two hours before the test's now, in epoch ms, as dsh-tui writes `time`.
fn at() -> i64 {
    now() - 2 * 3_600_000
}

fn header() -> String {
    format!(
        r#"{{"type":"session","version":4,"id":"{SESSION}","createdAt":{},"cwd":"/work/app","isSeeded":false,"delegationDepth":0,"agentPreset":"example"}}"#,
        at()
    )
}

fn step(seq: i64) -> String {
    format!(
        r#"{{"type":"step/end","seq":{seq},"time":{},"data":{{"turn":1,"step":{seq}}}}}"#,
        at()
    )
}

fn usage(input: i64, output: i64, read: i64) -> String {
    format!(
        r#"{{"inputTokens":{input},"outputTokens":{output},"cacheReadTokens":{read},"cacheWriteTokens":0,"totalTokens":{}}}"#,
        input + output + read
    )
}

/// An assistant message with this id (None: a row with no id).
fn call(seq: i64, id: Option<&str>, input: i64, output: i64, read: i64) -> String {
    let id = id.map(|i| format!(r#","id":"{i}""#)).unwrap_or_default();
    format!(
        r#"{{"type":"assistant/message","seq":{seq},"time":{},"surfaceOp":"append","data":{{"turn":1,"step":{seq},"message":{{"role":"assistant","content":[{{"type":"text","text":"FAKE-ANSWER"}}],"source":{{"kind":"llm","provider":"example","model":"model-d"}}{id}}},"usage":{},"stream":[]}}}}"#,
        at(),
        usage(input, output, read)
    )
}

fn msg(seq: i64, input: i64, output: i64, read: i64) -> String {
    call(seq, Some(&format!("{SESSION}-m{seq}")), input, output, read)
}

fn header_of(session: &str, seeded: bool) -> String {
    format!(
        r#"{{"type":"session","version":4,"id":"{session}","createdAt":{},"cwd":"/work/app","isSeeded":{seeded},"delegationDepth":0}}"#,
        at()
    )
}

fn end_seed(seq: i64, inherited: bool) -> String {
    let data = if inherited {
        r#"{"inherited":true}"#
    } else {
        "{}"
    };
    format!(
        r#"{{"type":"session/end-seed","seq":{seq},"time":{},"data":{data}}}"#,
        at()
    )
}

fn file_of(env: &Env, session: &str, name: &str) -> PathBuf {
    env.dsh(&format!("-work-app/{session}/{name}"))
}

fn compaction(seq: i64, input: i64, output: i64) -> String {
    format!(
        r#"{{"type":"compaction/summary","seq":{seq},"time":{},"data":{{"compactionId":"c-{seq}","summary":[{{"text":"FAKE-SUMMARY"}}],"shadowedSeqs":[1,2],"shadowedTokenCount":999,"provider":"example","model":"model-e","maxTokens":100,"usage":{}}}}}"#,
        at(),
        usage(input, output, 0)
    )
}

fn tokens(input: i64, output: i64, read: i64) -> Tokens {
    Tokens {
        input_uncached: input,
        output,
        cache_read: read,
        ..Tokens::default()
    }
}

/// One zstd frame holding these lines, each ending with a line feed, as dsh-tui appends them.
fn frame(lines: &[String]) -> Vec<u8> {
    let mut s = lines.join("\n");
    s.push('\n');
    compress_to_vec(s.as_bytes(), CompressionLevel::Fastest)
}

fn append(p: &PathBuf, bytes: &[u8]) {
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(p)
        .unwrap();
    f.write_all(bytes).unwrap();
}

fn dsh_totals(env: &Env) -> Tokens {
    let mut t = Tokens::default();
    for r in env.store().rows_since(i64::MIN).unwrap() {
        assert_eq!(r.key.harness, "dsh-tui");
        assert_eq!(r.key.branch, None);
        assert_eq!(r.reported_usd, None);
        t.add(&r.tokens);
    }
    t
}

#[test]
fn a_multi_frame_session_counts_each_call_once_and_compaction_on_its_own() {
    let env = Env::new();
    let p = session_file(&env);
    append(&p, &frame(&[header(), step(0)]));
    append(
        &p,
        &frame(&[msg(1, 10, 20, 300), msg(2, 4, 5, 600), step(3)]),
    );
    append(&p, &frame(&[compaction(4, 900, 80)]));
    append(&p, &frame(&[msg(5, 1, 2, 700)]));
    let r = env.run(&env.opts());
    assert_eq!(r.files_read, 1);
    assert_eq!(r.health.usage_lines, 4);
    assert_eq!(r.health.events, 4);
    assert_eq!(r.health.skipped_lines, 0);
    let totals = env.totals();
    let mut messages = tokens(10, 20, 300);
    messages.add(&tokens(4, 5, 600));
    messages.add(&tokens(1, 2, 700));
    // The messages keep their own usage; the compaction call is counted once, under its model,
    // and never as a sum of the messages it shadows.
    assert_eq!(totals["model-d"], messages);
    assert_eq!(totals["model-e"], tokens(900, 80, 0));
    assert_eq!(totals.len(), 2);
    dsh_totals(&env);
    let doc = r.summary.unwrap();
    let src = &doc["sources"]["dsh-tui"];
    assert_eq!(src["status"], "ok");
    assert_eq!(src["events"], 4);
    // No DeepSeek price in the table: unpriced, never $0.
    let model = doc["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["model"] == "model-d")
        .unwrap();
    assert_eq!(model["harness"], "dsh-tui");
    assert!(model["d30"].get("usd").is_none(), "{model}");
    assert_eq!(model["d30"]["unpriced"], messages.total());
    // dsh-tui logs no reasoning split: unknown, written as null, never 0 or left out.
    assert!(
        model["d30"].get("rs").is_some_and(|v| v.is_null()),
        "{model}"
    );
}

#[test]
fn a_cut_last_frame_waits_for_the_next_run() {
    let env = Env::new();
    let p = session_file(&env);
    append(&p, &frame(&[header(), msg(0, 10, 20, 300)]));
    append(&p, &frame(&[msg(1, 4, 5, 600)]));
    let last = frame(&[msg(2, 7, 8, 900), step(3)]);
    let (head, tail) = last.split_at(last.len() / 2);
    append(&p, head);
    let r = env.run(&env.opts());
    assert_eq!(r.health.events, 2);
    assert_eq!(
        r.health.skipped_lines, 0,
        "a frame being written is not bad"
    );
    let mut want = tokens(10, 20, 300);
    want.add(&tokens(4, 5, 600));
    assert_eq!(dsh_totals(&env), want);
    // Nothing changed: nothing is read again.
    let r = env.run(&env.opts());
    assert_eq!(r.bytes_read, 0);
    assert_eq!(r.health.events, 0);
    // The frame is finished: it is read from its start, and only it.
    append(&p, tail);
    let r = env.run(&env.opts());
    assert_eq!(r.bytes_read, last.len() as u64);
    assert_eq!(r.health.events, 1);
    assert_eq!(r.health.duplicates, 0);
    assert_eq!(r.health.skipped_lines, 0);
    want.add(&tokens(7, 8, 900));
    assert_eq!(dsh_totals(&env), want);
}

#[test]
fn a_resumed_read_takes_only_new_frames_and_a_rewrite_never_counts_twice() {
    let env = Env::new();
    let p = session_file(&env);
    let a = [frame(&[header(), msg(0, 10, 20, 300)]), frame(&[step(1)])].concat();
    append(&p, &a);
    let r = env.run(&env.opts());
    assert_eq!(r.bytes_read, a.len() as u64);
    assert_eq!(r.health.events, 1);
    // New frames: only they are read, with the session known from the first run's header.
    let b = frame(&[msg(2, 4, 5, 600), compaction(3, 900, 80)]);
    append(&p, &b);
    let r = env.run(&env.opts());
    assert_eq!(r.bytes_read, b.len() as u64);
    assert_eq!(r.health.events, 2);
    assert_eq!(r.health.duplicates, 0);
    let mut want = tokens(10, 20, 300);
    want.add(&tokens(4, 5, 600));
    want.add(&tokens(900, 80, 0));
    assert_eq!(dsh_totals(&env), want);
    // The file is replaced (a new inode, as a rewrite would leave it) with one more frame: it is
    // read again from the start, and the calls already counted are dropped as repeats.
    let c = frame(&[msg(4, 1, 2, 700)]);
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, [a.as_slice(), &b, &c].concat()).unwrap();
    fs::rename(&tmp, &p).unwrap();
    let r = env.run(&env.opts());
    assert_eq!(r.health.rewrites, 1);
    assert_eq!(r.health.events, 1);
    assert_eq!(r.health.duplicates, 3);
    want.add(&tokens(1, 2, 700));
    assert_eq!(dsh_totals(&env), want);
}

#[test]
fn unknown_or_missing_usage_is_never_guessed() {
    let env = Env::new();
    let p = session_file(&env);
    let t = at();
    let interrupted = format!(
        r#"{{"type":"assistant/message","seq":0,"time":{t},"data":{{"interrupted":true,"message":{{"source":{{"model":"model-d"}}}},"stream":[]}}}}"#
    );
    // A count of a kind the meter does not know: the part of totalTokens it leaves is unsplit.
    let unknown = format!(
        r#"{{"type":"assistant/message","seq":1,"time":{t},"data":{{"message":{{"source":{{"model":"model-d"}}}},"usage":{{"inputTokens":6,"outputTokens":4,"futureTokens":30,"totalTokens":40}}}}}}"#
    );
    // An older row with no cache counts that add up: exact, the missing kinds 0.
    let older = format!(
        r#"{{"type":"assistant/message","seq":2,"time":{t},"data":{{"message":{{"source":{{"model":"model-d"}}}},"usage":{{"inputTokens":9,"outputTokens":1,"totalTokens":10}}}}}}"#
    );
    append(&p, &frame(&[header(), interrupted, unknown, older]));
    let r = env.run(&env.opts());
    assert_eq!(r.health.usage_lines, 2);
    assert_eq!(r.health.skipped_lines, 0);
    let rows = env.store().rows_since(i64::MIN).unwrap();
    let exact: Tokens =
        rows.iter()
            .filter(|r| r.precision == "exact")
            .fold(Tokens::default(), |mut t, r| {
                t.add(&r.tokens);
                t
            });
    assert_eq!(exact, tokens(15, 5, 0));
    let total_only: Vec<_> = rows
        .iter()
        .filter(|r| r.precision == "total_only")
        .collect();
    assert_eq!(total_only.len(), 1);
    assert_eq!(
        total_only[0].tokens,
        Tokens {
            unsplit: 30,
            ..Tokens::default()
        }
    );
}

#[test]
fn a_bad_frame_skips_only_itself() {
    let env = Env::new();
    let p = session_file(&env);
    append(&p, &frame(&[header(), msg(0, 10, 20, 300)]));
    // Not a frame, then a frame whose header is cut short (a torn write), then good frames.
    append(&p, b"not a zstd frame at all");
    let torn = frame(&[msg(1, 99, 99, 99)]);
    append(&p, &torn[..torn.len() / 2]);
    append(&p, &frame(&[msg(2, 4, 5, 600)]));
    append(&p, &frame(&[msg(3, 1, 2, 700)]));
    let r = env.run(&env.opts());
    assert_eq!(r.health.events, 3);
    // Two bad stretches (the junk, and the torn frame that ran into the next one), each once.
    assert_eq!(r.health.skipped_lines, 2);
    let mut want = tokens(10, 20, 300);
    want.add(&tokens(4, 5, 600));
    want.add(&tokens(1, 2, 700));
    assert_eq!(dsh_totals(&env), want);
    // Junk at the end is passed over; a frame appended after it is read, the junk not again.
    append(&p, b"more junk");
    let r = env.run(&env.opts());
    assert_eq!((r.health.events, r.health.skipped_lines), (0, 1));
    append(&p, &frame(&[msg(4, 7, 8, 900)]));
    let r = env.run(&env.opts());
    assert_eq!((r.health.events, r.health.skipped_lines), (1, 0));
    want.add(&tokens(7, 8, 900));
    assert_eq!(dsh_totals(&env), want);
}

#[test]
fn an_over_long_line_drops_only_itself() {
    let env = Env::new();
    let p = session_file(&env);
    let long = format!(
        r#"{{"type":"tool/result","seq":1,"time":{},"data":{{"pad":"{}"}}}}"#,
        at(),
        "x".repeat(5000)
    );
    append(
        &p,
        &frame(&[header(), msg(0, 10, 20, 300), long, msg(2, 4, 5, 600)]),
    );
    let mut o = env.opts();
    o.max_line = 4096;
    let r = env.run(&o);
    assert_eq!((r.health.events, r.health.skipped_lines), (2, 1));
    let mut want = tokens(10, 20, 300);
    want.add(&tokens(4, 5, 600));
    assert_eq!(dsh_totals(&env), want);
}

/// A parent session and its fork: the child's file starts with a copy of the parent's rows (ids,
/// usage and seq), then the inherited marker and the child's own call. Parent 100 + 200, child 7.
fn fork_files(env: &Env) -> (PathBuf, Vec<u8>, PathBuf, Vec<u8>) {
    let copied = [
        call(0, Some("id-a"), 100, 0, 0),
        step(1),
        call(2, Some("id-b"), 200, 0, 0),
    ];
    let mut parent = vec![header_of("sess-parent", false)];
    parent.extend(copied.iter().cloned());
    let mut child = vec![header_of("sess-child", true)];
    child.extend(copied.iter().cloned());
    child.extend([end_seed(3, true), step(4), call(5, Some("id-c"), 7, 0, 0)]);
    (
        file_of(env, "sess-parent", "session.v4.jsonl.zstd"),
        frame(&parent),
        file_of(env, "sess-child", "session.v4.jsonl.zstd"),
        frame(&child),
    )
}

#[test]
fn a_forked_session_counts_its_parents_calls_once_in_any_read_order() {
    let total = |env: &Env| dsh_totals(env).input_uncached;
    // The sessions (id, parent, first and last time) do not depend on the read order either.
    let sessions = |env: &Env| -> Vec<(String, Option<String>, i64, i64)> {
        let s = env.store();
        let mut st = s
            .conn
            .prepare(
                "SELECT session, parent_session, first_ms, last_ms FROM sessions
                 WHERE harness = 'dsh-tui' ORDER BY session",
            )
            .unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    let mut seen = Vec::new();
    // Parent read first, the child in a later run.
    let env = Env::new();
    let (pp, pb, cp, cb) = fork_files(&env);
    append(&pp, &pb);
    env.run(&env.opts());
    append(&cp, &cb);
    let r = env.run(&env.opts());
    assert_eq!((r.health.events, r.health.duplicates), (1, 2));
    assert_eq!(total(&env), 307);
    seen.push(sessions(&env));
    // The child first (its parent's file not there yet, or gone): the copies count once.
    let env = Env::new();
    let (pp, pb, cp, cb) = fork_files(&env);
    append(&cp, &cb);
    env.run(&env.opts());
    assert_eq!(total(&env), 307);
    append(&pp, &pb);
    let r = env.run(&env.opts());
    assert_eq!((r.health.events, r.health.duplicates), (0, 2));
    assert_eq!(total(&env), 307);
    seen.push(sessions(&env));
    // Both in one run.
    let env = Env::new();
    let (pp, pb, cp, cb) = fork_files(&env);
    append(&pp, &pb);
    append(&cp, &cb);
    let r = env.run(&env.opts());
    assert_eq!((r.health.events, r.health.duplicates), (3, 2));
    assert_eq!(total(&env), 307);
    seen.push(sessions(&env));
    assert_eq!(seen[0].len(), 2, "{seen:?}");
    assert!(seen.iter().all(|s| *s == seen[0]), "{seen:#?}");
}

/// A seat's start row and the session row Herdr writes for a dsh-tui session it carries (RFC
/// 0021 (f) 5), so each session links to its own bot.
fn seat_rows(terminal: &str, bot: &str, created_ms: i64, session: &str) -> String {
    let iso = meter::time::format_rfc3339(created_ms + 5_000);
    format!(
        concat!(
            r#"{{"event":"start","kind":"seat","terminal":"{t}","botId":"{bot}","task":null,"#,
            r#""worktree":"/work/app","agent":"dsh-tui","role":"captain","branch":null,"#,
            r#""project":"/work/app","lead":null,"core":"core-synthetic","created_ms":{c},"#,
            r#""squad":"{bot}","session":null,"at":"{iso}"}}"#,
            "\n",
            r#"{{"event":"session","terminal":"{t}","session":"{s}","transcript":null,"#,
            r#""agent":"dsh-tui","core":"core-synthetic","created_ms":{c},"at":"{iso}"}}"#,
            "\n"
        ),
        t = terminal,
        bot = bot,
        c = created_ms,
        iso = iso,
        s = session,
    )
}

/// A fork two hours old: the parent's calls (100 + 200) an hour before it, copied into the fork
/// with the parent's times, then the fork's own call (7) after it was created. The parent's seat
/// and the fork's seat are two bots.
fn attributed_fork(env: &Env) -> (PathBuf, Vec<u8>, PathBuf, Vec<u8>) {
    let (parent_at, fork_at) = (at() - 3_600_000, at());
    let line = |seq: i64, id: &str, input: i64, time: i64| {
        call(seq, Some(id), input, 0, 0)
            .replace(&format!(r#""time":{}"#, at()), &format!(r#""time":{time}"#))
    };
    let header = |id: &str, seeded: bool, created: i64| {
        header_of(id, seeded).replace(
            &format!(r#""createdAt":{}"#, at()),
            &format!(r#""createdAt":{created}"#),
        )
    };
    let copied = [
        line(0, "id-a", 100, parent_at),
        line(1, "id-b", 200, parent_at + 60_000),
    ];
    let mut parent = vec![header("sess-parent", false, parent_at - 60_000)];
    parent.extend(copied.iter().cloned());
    let mut child = vec![header("sess-child", true, fork_at)];
    child.extend(copied.iter().cloned());
    child.extend([end_seed(2, true), line(3, "id-c", 7, fork_at + 60_000)]);
    let ledger = env
        .home()
        .join(".config/herdr-app/automagik-herdr/workers.jsonl");
    fs::create_dir_all(ledger.parent().unwrap()).unwrap();
    let rows = seat_rows("t1", "b-parentseat", parent_at - 120_000, "sess-parent")
        + &seat_rows("t2", "b-forkseat0", fork_at - 120_000, "sess-child");
    fs::write(&ledger, rows).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&ledger, fs::Permissions::from_mode(0o600)).unwrap();
    }
    (
        file_of(env, "sess-parent", "session.v4.jsonl.zstd"),
        frame(&parent),
        file_of(env, "sess-child", "session.v4.jsonl.zstd"),
        frame(&child),
    )
}

/// Input tokens per bot (None: unattributed).
fn by_bot(env: &Env) -> std::collections::BTreeMap<Option<String>, i64> {
    let mut m = std::collections::BTreeMap::new();
    for r in env.store().rows_since(i64::MIN).unwrap() {
        *m.entry(r.key.bot.clone()).or_default() += r.tokens.input_uncached;
    }
    m
}

fn set_mtime(p: &PathBuf, ms: i64) {
    let t = std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms as u64);
    fs::File::options()
        .write(true)
        .open(p)
        .unwrap()
        .set_modified(t)
        .unwrap();
}

// Check (RFC 0021 delivery 4): a fork's copied call is the parent's, whichever file is read first.
#[test]
fn a_forks_copied_calls_are_the_parents_in_any_read_order() {
    let want = |copies: Option<&str>| {
        let mut m = std::collections::BTreeMap::new();
        m.insert(copies.map(str::to_owned), 300);
        *m.entry(Some("b-forkseat0".to_owned())).or_default() += 7;
        m
    };
    // Both files new in one run, the fork's written last (newest first would read it first),
    // then the parent's written last.
    for fork_newer in [true, false] {
        let env = Env::new();
        let (pp, pb, cp, cb) = attributed_fork(&env);
        append(&pp, &pb);
        append(&cp, &cb);
        let (older, newer) = if fork_newer { (&pp, &cp) } else { (&cp, &pp) };
        set_mtime(older, now() - 7_200_000);
        set_mtime(newer, now() - 60_000);
        let r = env.run(&env.opts());
        assert_eq!((r.health.events, r.health.duplicates), (3, 2));
        assert_eq!(
            by_bot(&env),
            want(Some("b-parentseat")),
            "fork newer: {fork_newer}"
        );
    }
    // The parent read in an earlier run, the fork in a later one.
    let env = Env::new();
    let (pp, pb, cp, cb) = attributed_fork(&env);
    append(&pp, &pb);
    env.run(&env.opts());
    append(&cp, &cb);
    env.run(&env.opts());
    assert_eq!(by_bot(&env), want(Some("b-parentseat")));
    // The parent's file gone: the copies still count once, unattributed, never the fork's.
    let env = Env::new();
    let (_, _, cp, cb) = attributed_fork(&env);
    append(&cp, &cb);
    let r = env.run(&env.opts());
    assert_eq!(r.health.events, 3);
    assert_eq!(by_bot(&env), want(None));
}

// Fixer L1 on #835: a fork whose first frame is large is still read after its parent.
#[test]
fn a_fork_with_a_large_first_frame_is_still_read_last() {
    let env = Env::new();
    let (pp, pb, cp, cb) = attributed_fork(&env);
    // The fork again, its header sharing one frame with over a megabyte of incompressible text.
    let mut noise = String::with_capacity(3 << 20);
    let mut x: u64 = 0x9e37_79b9_7f4a_7c15;
    while noise.len() < 3 << 20 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        noise.push_str(&format!("{x:016x}"));
    }
    let child = decoded(&cb);
    let mut lines: Vec<String> = child.lines().map(str::to_owned).collect();
    let pad = format!(r#"{{"type":"note","seq":-1,"time":1,"data":{{"text":"{noise}"}}}}"#);
    lines.insert(1, pad);
    let big = frame(&lines);
    assert!(big.len() > 1 << 20, "{}", big.len());
    append(&pp, &pb);
    append(&cp, &big);
    set_mtime(&pp, now() - 7_200_000);
    set_mtime(&cp, now() - 60_000);
    env.run(&env.opts());
    let mut want = std::collections::BTreeMap::new();
    want.insert(Some("b-parentseat".to_owned()), 300);
    want.insert(Some("b-forkseat0".to_owned()), 7);
    assert_eq!(by_bot(&env), want);
}

/// The lines of one zstd frame.
fn decoded(bytes: &[u8]) -> String {
    let mut d = ruzstd::decoding::StreamingDecoder::new(bytes).unwrap();
    let mut v = Vec::new();
    std::io::Read::read_to_end(&mut d, &mut v).unwrap();
    String::from_utf8(v).unwrap()
}

// Reviewer L2 on #835: a fork an older meter read part of (no createdAt or cut in its file
// context) still gets its own later calls.
#[test]
fn a_fork_read_in_part_by_an_older_meter_keeps_its_own_calls() {
    let env = Env::new();
    let (pp, pb, cp, cb) = attributed_fork(&env);
    append(&pp, &pb);
    // The fork up to its marker, read once.
    let text = decoded(&cb);
    let lines: Vec<String> = text.lines().map(str::to_owned).collect();
    let (head, own) = lines.split_at(lines.len() - 1);
    append(&cp, &frame(head));
    env.run(&env.opts());
    // What an older meter kept: no createdAt, no cut.
    env.store()
        .conn
        .execute(
            "UPDATE files SET ctx = json_remove(ctx, '$.created_at', '$.seed_cut')
             WHERE source = 'dsh-tui'",
            [],
        )
        .unwrap();
    append(&cp, &frame(own));
    env.run(&env.opts());
    assert_eq!(by_bot(&env).get(&Some("b-forkseat0".to_owned())), Some(&7));
}

/// An `hc` that answers `server.status` with a synthetic core id and `terminal.list` with
/// `terminals` (a JSON array), and refuses anything else.
fn fake_hc(env: &Env, terminals: &str) -> PathBuf {
    let p = env.dir.path().join("fake-hc");
    let script = format!(
        r#"#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *server.status*) printf '{{"jsonrpc":"2.0","id":%s,"result":{{"core":{{"id":"core-synthetic"}}}}}}\n' "$id" ;;
    *terminal.list*) printf '{{"jsonrpc":"2.0","id":%s,"result":{{"terminals":%s}}}}\n' "$id" '{terminals}' ;;
    *) printf '{{"jsonrpc":"2.0","id":%s,"error":{{"message":"refused"}}}}\n' "$id" ;;
  esac
done
"#
    );
    fs::write(&p, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&p, fs::Permissions::from_mode(0o700)).unwrap();
    }
    p
}

// The case the copy mark is for: the parent's file is gone, and the fork's own terminal, older
// than the copied calls, carries the fork's session label. Its label link covers the copies'
// times, yet they stay unlinked: a copy is never the fork's.
#[test]
fn a_forks_copies_never_go_to_the_fork_even_through_its_label() {
    let env = Env::new();
    let (_, _, cp, cb) = attributed_fork(&env);
    append(&cp, &cb);
    // The fork's seat terminal was created before the parent's calls, and the sync sees it live
    // with the fork's session on it.
    // No row ties the fork's session to a launch: only the label does.
    let created = at() - 3 * 3_600_000;
    let ledger = env
        .home()
        .join(".config/herdr-app/automagik-herdr/workers.jsonl");
    let start = seat_rows("t9", "b-forklabel", created, "unused");
    let start = start.lines().next().unwrap();
    fs::write(&ledger, format!("{start}\n")).unwrap();
    let terminals = format!(
        r#"[{{"address":"t9","created_ms":{created},"cwd":"/work/app","argv":["dsh-tui"],"labels":{{"agent.session":"sess-child"}}}}]"#
    );
    let hc = fake_hc(&env, &terminals);
    let _serial = common::serial();
    let out = env
        .command()
        .env("METER_HC", &hc)
        // The binary runs on the real clock: --backfill reaches the fixtures' fixed date.
        .args(["sync", "--force", "--no-publish", "--backfill"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let store = meter::store::Store::open(&env.home().join(".automagik/meter/meter.db")).unwrap();
    let mut m = std::collections::BTreeMap::new();
    for r in store.rows_since(i64::MIN).unwrap() {
        *m.entry(r.key.bot.clone()).or_insert(0) += r.tokens.input_uncached;
    }
    let mut want = std::collections::BTreeMap::new();
    want.insert(None, 300);
    want.insert(Some("b-forklabel".to_owned()), 7);
    assert_eq!(m, want);
}

#[test]
fn two_sessions_with_the_same_seq_both_count() {
    let env = Env::new();
    for (session, id) in [("sess-one", "id-one"), ("sess-two", "id-two")] {
        let p = file_of(&env, session, "session.v4.jsonl.zstd");
        append(
            &p,
            &frame(&[header_of(session, false), call(0, Some(id), 10, 0, 0)]),
        );
    }
    // Rows with no id fall back to session and seq: two sessions still never collide.
    for session in ["sess-three", "sess-four"] {
        let p = file_of(&env, session, "session.v4.jsonl.zstd");
        append(
            &p,
            &frame(&[header_of(session, false), call(0, None, 1, 0, 0)]),
        );
    }
    let r = env.run(&env.opts());
    assert_eq!((r.health.events, r.health.duplicates), (4, 0));
    assert_eq!(dsh_totals(&env).input_uncached, 22);
}

#[test]
fn a_row_with_no_id_in_a_seeded_session_is_skipped_not_guessed() {
    let env = Env::new();
    let p = file_of(&env, "sess-child", "session.v4.jsonl.zstd");
    append(
        &p,
        &frame(&[
            header_of("sess-child", true),
            call(0, None, 100, 0, 0),
            end_seed(1, true),
            call(2, Some("id-own"), 7, 0, 0),
        ]),
    );
    let r = env.run(&env.opts());
    assert_eq!((r.health.events, r.health.skipped_lines), (1, 1));
    assert_eq!(dsh_totals(&env).input_uncached, 7);
}

#[test]
fn a_resume_marker_changes_nothing() {
    let env = Env::new();
    let p = session_file(&env);
    append(
        &p,
        &frame(&[
            header(),
            msg(0, 10, 0, 0),
            end_seed(1, false),
            msg(2, 4, 0, 0),
        ]),
    );
    let r = env.run(&env.opts());
    assert_eq!(r.health.events, 2);
    assert_eq!(dsh_totals(&env).input_uncached, 14);
}

#[test]
fn a_plain_v4_file_is_read_too() {
    let env = Env::new();
    let p = file_of(&env, SESSION, "session.v4.jsonl");
    fs::write(&p, format!("{}\n{}\n", header(), msg(0, 10, 20, 300))).unwrap();
    let r = env.run(&env.opts());
    assert_eq!(r.health.events, 1);
    assert_eq!(dsh_totals(&env), tokens(10, 20, 300));
    assert_eq!(r.summary.unwrap()["sources"]["dsh-tui"]["status"], "ok");
}

#[test]
fn a_session_in_another_format_makes_the_source_unsupported() {
    let env = Env::new();
    append(
        &session_file(&env),
        &frame(&[header(), msg(0, 10, 20, 300)]),
    );
    // An older generation next to a v4 file is what it was migrated from: still ok.
    fs::write(file_of(&env, SESSION, "session.v3.jsonl.zstd"), b"old").unwrap();
    let r = env.run(&env.opts());
    let doc = r.summary.unwrap();
    assert_eq!(doc["sources"]["dsh-tui"]["status"], "ok", "{doc}");
    // A newer generation, or an older one with no v4 file: its usage is not read.
    fs::write(file_of(&env, SESSION, "session.v5.jsonl.zstd"), b"new").unwrap();
    fs::write(file_of(&env, "sess-old", "session.v2.jsonl"), b"old").unwrap();
    let r = env.run(&env.opts());
    let doc = r.summary.unwrap();
    let src = &doc["sources"]["dsh-tui"];
    assert_eq!(src["status"], "unsupported", "{doc}");
    let reason = src["reason"].as_str().unwrap();
    assert!(
        reason.contains("1 in format v2, 1 in format v5"),
        "{reason}"
    );
    // The v4 usage is still counted.
    assert_eq!(dsh_totals(&env), tokens(10, 20, 300));
    // Once the newer file is gone, the source is ok again.
    fs::remove_file(file_of(&env, SESSION, "session.v5.jsonl.zstd")).unwrap();
    fs::remove_file(file_of(&env, "sess-old", "session.v2.jsonl")).unwrap();
    let r = env.run(&env.opts());
    assert_eq!(r.summary.unwrap()["sources"]["dsh-tui"]["status"], "ok");
}

/// A frame by hand: one raw block holding these lines, with the zstd content checksum (XXH64's
/// low 32 bits over the content) when `checksum`; `tamper` changes a content byte after the
/// checksum was taken.
fn raw_frame(lines: &[String], checksum: bool, tamper: bool) -> Vec<u8> {
    let mut content = lines.join("\n").into_bytes();
    content.push(b'\n');
    let mut x = meter::xxh64::Xxh64::default();
    x.update(&content);
    let sum = x.finish() as u32;
    if tamper {
        // A digit of the first input count: still a valid line, a different number.
        let at = content
            .windows(14)
            .position(|w| w == b"\"inputTokens\":")
            .unwrap()
            + 14;
        content[at] = if content[at] == b'9' { b'8' } else { b'9' };
    }
    // Frame header: no single segment, a 1 MiB window, then one last raw block.
    let mut f = vec![
        0x28,
        0xB5,
        0x2F,
        0xFD,
        if checksum { 0x04 } else { 0x00 },
        0x50,
    ];
    let h = 1u32 | ((content.len() as u32) << 3);
    f.extend_from_slice(&h.to_le_bytes()[..3]);
    f.extend_from_slice(&content);
    if checksum {
        f.extend_from_slice(&sum.to_le_bytes());
    }
    f
}

fn dsh_source(r: &meter::sync::Report) -> serde_json::Value {
    r.summary.as_ref().unwrap()["sources"]["dsh-tui"].clone()
}

/// PR 802's review: a call with no readable totalTokens is exact only when all four counts are
/// readable; otherwise its total is unknown, which is never 0: the line is skipped and counted,
/// and the source reports degraded with the reason.
#[test]
fn a_call_with_no_total_is_exact_only_with_every_count() {
    let env = Env::new();
    let p = session_file(&env);
    let t = at();
    let line = |seq: i64, usage: &str| {
        format!(
            r#"{{"type":"assistant/message","seq":{seq},"time":{t},"data":{{"message":{{"id":"m{seq}","source":{{"model":"model-d"}}}},"usage":{usage}}}}}"#
        )
    };
    let all = line(
        0,
        r#"{"inputTokens":3,"outputTokens":4,"cacheReadTokens":5,"cacheWriteTokens":6}"#,
    );
    let some = line(1, r#"{"inputTokens":3,"outputTokens":4}"#);
    let none = line(2, "{}");
    let bad = line(
        3,
        r#"{"inputTokens":"many","outputTokens":1,"cacheReadTokens":1,"cacheWriteTokens":1}"#,
    );
    append(&p, &frame(&[header(), all, some, none, bad]));
    let r = env.run(&env.opts());
    assert_eq!(r.health.usage_lines, 1);
    assert_eq!(r.health.skipped_lines, 3);
    assert_eq!(
        dsh_totals(&env),
        Tokens {
            input_uncached: 3,
            output: 4,
            cache_read: 5,
            cache_write_5m: 6,
            ..Tokens::default()
        }
    );
    let src = dsh_source(&r);
    assert_eq!(src["status"], "degraded", "{src}");
    assert!(
        src["reason"]
            .as_str()
            .unwrap()
            .contains("could not be read"),
        "{src}"
    );
}

/// PR 802's review: frames with a content checksum are checked. A frame whose content does not
/// match counts nothing (not even the lines before the mismatch is found), counts as one skipped
/// frame, and the next frame is read.
#[test]
fn a_frame_whose_checksum_does_not_match_counts_nothing() {
    let env = Env::new();
    let p = session_file(&env);
    append(
        &p,
        &raw_frame(&[header(), msg(0, 10, 20, 300)], true, false),
    );
    append(&p, &raw_frame(&[msg(1, 90, 90, 90)], true, true));
    append(&p, &raw_frame(&[msg(2, 1, 2, 3)], true, false));
    let r = env.run(&env.opts());
    assert_eq!(r.health.skipped_lines, 1);
    let mut want = tokens(10, 20, 300);
    want.add(&tokens(1, 2, 3));
    assert_eq!(dsh_totals(&env), want);
    assert_eq!(dsh_source(&r)["status"], "degraded");
}

/// PR 802's review: a corrupted block size makes the reader wait for bytes that never come, which
/// held back the rest of the file while the source said ok. Once the session has stopped growing,
/// those bytes are reported: the source is degraded, with how many bytes and sessions.
#[test]
fn a_corrupted_block_size_holding_back_a_tail_is_degraded_never_ok() {
    let env = Env::new();
    let p = session_file(&env);
    append(
        &p,
        &raw_frame(&[header(), msg(0, 10, 20, 300)], false, false),
    );
    let mut torn = raw_frame(&[msg(1, 4, 5, 6)], false, false);
    // The block header's size field, set near its 21-bit maximum: the frame "ends" far past EOF.
    let h = 1u32 | (0x1F_0000 << 3);
    torn[6..9].copy_from_slice(&h.to_le_bytes()[..3]);
    append(&p, &torn);
    append(&p, &raw_frame(&[msg(2, 7, 8, 9)], false, false));
    // The session was last written an hour before the run.
    let then = std::time::UNIX_EPOCH + std::time::Duration::from_millis((now() - 3_600_000) as u64);
    fs::File::options()
        .write(true)
        .open(&p)
        .unwrap()
        .set_modified(then)
        .unwrap();
    let r = env.run(&env.opts());
    assert_eq!(dsh_totals(&env), tokens(10, 20, 300), "the tail waits");
    let src = dsh_source(&r);
    assert_eq!(src["status"], "degraded", "{src}");
    assert!(
        src["reason"].as_str().unwrap().contains("not whole frames"),
        "{src}"
    );

    // A frame being written right now (the file is fresh) is not reported.
    let env = Env::new();
    let p = session_file(&env);
    append(
        &p,
        &raw_frame(&[header(), msg(0, 10, 20, 300)], false, false),
    );
    let cut = raw_frame(&[msg(1, 4, 5, 6)], false, false);
    append(&p, &cut[..cut.len() - 5]);
    let fresh = std::time::UNIX_EPOCH + std::time::Duration::from_millis(now() as u64);
    fs::File::options()
        .write(true)
        .open(&p)
        .unwrap()
        .set_modified(fresh)
        .unwrap();
    let r = env.run(&env.opts());
    assert_eq!(dsh_source(&r)["status"], "ok");
}

/// Sessions the real zstd CLI wrote (`zstd --check -19`, one call per frame, then
/// concatenated): `session-a` is three frames, `session-b` two, every frame with its content
/// checksum. Synthetic content only. Committed in tests/fixtures/dsh-zstd-cli.
const CLI_A_FRAMES: [usize; 3] = [232, 162, 161];
const CLI_B_FRAMES: [usize; 2] = [228, 161];

fn cli_fixture(name: &str) -> Vec<u8> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/dsh-zstd-cli");
    fs::read(dir.join(name)).unwrap()
}

/// The reader verifies the checksums the zstd CLI wrote, and a copy with one checksum byte
/// flipped loses that frame alone: refused whole, counted as one skipped frame, the source
/// degraded, the frames around it still read.
#[test]
fn zstd_cli_frames_have_their_checksums_verified() {
    let (a, b) = (
        cli_fixture("session-a.v4.jsonl.zstd"),
        cli_fixture("session-b.v4.jsonl.zstd"),
    );
    for (bytes, frames) in [(&a, &CLI_A_FRAMES[..]), (&b, &CLI_B_FRAMES[..])] {
        assert_eq!(bytes.len(), frames.iter().sum::<usize>());
        let mut at = 0;
        for n in frames {
            assert_eq!(bytes[at..at + 4], [0x28, 0xB5, 0x2F, 0xFD]);
            assert_ne!(bytes[at + 4] & 0x04, 0, "the frame at {at} has a checksum");
            at += n;
        }
    }
    let all = [
        tokens(11, 22, 333),
        tokens(44, 55, 666),
        tokens(7, 8, 900),
        tokens(1, 2, 3),
        tokens(10, 20, 30),
    ];
    let sum = |picked: &[usize]| {
        picked.iter().fold(Tokens::default(), |mut t, i| {
            t.add(&all[*i]);
            t
        })
    };
    let env = Env::new();
    append(&file_of(&env, "sess-cli-a", "session.v4.jsonl.zstd"), &a);
    append(&file_of(&env, "sess-cli-b", "session.v4.jsonl.zstd"), &b);
    let r = env.run(&env.opts());
    assert_eq!((r.health.events, r.health.skipped_lines), (5, 0));
    assert_eq!(dsh_totals(&env), sum(&[0, 1, 2, 3, 4]));
    assert_eq!(dsh_source(&r)["status"], "ok");

    // The last byte of session-a's second frame is its checksum's: flipped, that frame alone
    // is refused.
    let mut bad = a.clone();
    bad[CLI_A_FRAMES[0] + CLI_A_FRAMES[1] - 1] ^= 0xFF;
    let env = Env::new();
    append(&file_of(&env, "sess-cli-a", "session.v4.jsonl.zstd"), &bad);
    let r = env.run(&env.opts());
    assert_eq!((r.health.events, r.health.skipped_lines), (2, 1));
    assert_eq!(dsh_totals(&env), sum(&[0, 2]));
    assert_eq!(dsh_source(&r)["status"], "degraded");
}
