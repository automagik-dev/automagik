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

fn msg(seq: i64, input: i64, output: i64, read: i64) -> String {
    format!(
        r#"{{"type":"assistant/message","seq":{seq},"time":{},"surfaceOp":"append","data":{{"turn":1,"step":{seq},"message":{{"role":"assistant","content":[{{"type":"text","text":"FAKE-ANSWER"}}],"source":{{"kind":"llm","provider":"example","model":"model-d"}},"id":"m-{seq}"}},"usage":{},"stream":[]}}}}"#,
        at(),
        usage(input, output, read)
    )
}

fn compaction(seq: i64, input: i64, output: i64) -> String {
    format!(
        r#"{{"type":"compaction/summary","seq":{seq},"time":{},"data":{{"compactionId":"c-1","summary":[{{"text":"FAKE-SUMMARY"}}],"shadowedSeqs":[1,2],"shadowedTokenCount":999,"provider":"example","model":"model-e","maxTokens":100,"usage":{}}}}}"#,
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
    assert!(model["d30"].get("rs").is_none(), "{model}");
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
fn a_file_that_stops_being_zstd_is_skipped_once() {
    let env = Env::new();
    let p = session_file(&env);
    append(&p, &frame(&[header(), msg(0, 10, 20, 300)]));
    append(&p, b"not a zstd frame at all");
    let r = env.run(&env.opts());
    assert_eq!(r.health.events, 1);
    assert_eq!(r.health.skipped_lines, 1);
    append(&p, &frame(&[msg(1, 4, 5, 600)]));
    // The offset moved past the junk: a frame appended after it is read, the junk is not again.
    let r = env.run(&env.opts());
    assert_eq!(r.health.skipped_lines, 0);
    assert_eq!(r.health.events, 1);
    let mut want = tokens(10, 20, 300);
    want.add(&tokens(4, 5, 600));
    assert_eq!(dsh_totals(&env), want);
}
