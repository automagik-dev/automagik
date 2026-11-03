// Transport benchmarks for the hc attach stream, bare Node (no renderer).
// Run against an isolated core: HC_SESSION=spike with scratch XDG paths (see FINDINGS.md).
//   node bench.mjs <socket> [rtt|window|throughput|all]
import { HcClient } from './hc-client.mjs';

const sock = process.argv[2];
const which = process.argv[3] || 'all';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = (a) => ({ n: a.length, p50: +pct(a, 0.5).toFixed(3), p95: +pct(a, 0.95).toFixed(3), p99: +pct(a, 0.99).toFixed(3), max: +Math.max(...a).toFixed(3) });

async function newTerminal(c, name, argv) {
  const r = await c.call('terminal.run', { argv, name, no_parent: true, labels: { spike: 'code-mode' } });
  return r.terminal?.address ?? r.address ?? name;
}

async function rtt(c) {
  // `cat` in cooked mode: the tty line discipline echoes each key, so this is
  // key -> core -> pty -> echo -> core -> viewer, with no program logic in between.
  const t = await newTerminal(c, 'bench-rtt', ['cat']);
  await sleep(500);
  const a = await c.attach(t, { cols: 120, rows: 40 });
  let waiter = null;
  a.on('data', (d) => { a.credit(d.length); if (waiter && d.includes(0x78)) { const w = waiter; waiter = null; w(); } });
  await sleep(300);
  const samples = [];
  for (let i = 0; i < 300; i++) {
    const t0 = performance.now();
    await new Promise((res) => { waiter = res; a.write('x'); });
    samples.push(performance.now() - t0);
    if (i % 60 === 59) { a.write('\x15'); await sleep(50); } // ctrl+u clears the line
    await sleep(5);
  }
  a.detach();
  await c.call('terminal.kill', { terminal: t });
  return stats(samples.slice(20)); // drop warm-up
}

async function window_(c) {
  // Withhold CREDIT and count how many bytes the core sends before it stops.
  const t = await newTerminal(c, 'bench-window', ['bash', '--norc', '-i']);
  await sleep(500);
  const a = await c.attach(t, { cols: 120, rows: 40 });
  let got = 0;
  a.on('data', (d) => { got += d.length; });
  await sleep(300);
  const before = got;
  a.write('seq 1 300000\r');
  await sleep(2000);
  const stalledAt = got - before;
  a.credit(got); // release; let it finish
  let after = got;
  a.removeAllListeners('data');
  a.on('data', (d) => { after += d.length; a.credit(d.length); });
  await sleep(1500);
  a.detach();
  await c.call('terminal.kill', { terminal: t });
  return { bytes_before_stall_without_credit: stalledAt, total_after_credit: after - before };
}

async function throughput(c, lines) {
  const t = await newTerminal(c, 'bench-tp', ['bash', '--norc', '-i']);
  await sleep(500);
  const a = await c.attach(t, { cols: 120, rows: 40 });
  await sleep(300);
  let got = 0, done = null;
  const marker = 'BENCH-DONE';
  let tail = '';
  a.on('data', (d) => {
    got += d.length; a.credit(d.length);
    tail = (tail + d.toString('latin1')).slice(-200);
    if (done && tail.includes(marker + '\r\n')) { const f = done; done = null; f(); }
  });
  const t0 = performance.now();
  await new Promise((res) => { done = res; a.write(`seq 1 ${lines}; echo BENCH-""DONE\r`); });
  const ms = performance.now() - t0;
  a.detach();
  await c.call('terminal.kill', { terminal: t });
  // seq output size: digits + "\r\n" per line
  let raw = 0; for (let n = 1; n <= lines; n *= 10) raw += (Math.min(lines, n * 10 - 1) - n + 1) * (String(n).length + 2);
  return { lines, ms: +ms.toFixed(1), bytes_received: got, bytes_program_wrote: raw, MB_per_s_received: +(got / ms / 1000).toFixed(2), lines_per_s: Math.round(lines / ms * 1000) };
}

const c = new HcClient(sock);
const hello = await c.connect();
const out = { core: hello.version, socket: sock };
if (which === 'rtt' || which === 'all') out.rtt_ms = await rtt(c);
if (which === 'window' || which === 'all') out.window = await window_(c);
if (which === 'throughput' || which === 'all') out.throughput = [await throughput(c, 100000), await throughput(c, 1000000)];
console.log(JSON.stringify(out, null, 2));
c.close();
