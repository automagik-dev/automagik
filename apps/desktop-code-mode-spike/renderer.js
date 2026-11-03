// Renderer: spaces sidebar + split layout + xterm.js panes fed by the hc attach stream.
const { ipcRenderer } = require('electron');

let cores = [];
let selected = null; // { core, spaceId, tabId }
const panes = new Map(); // paneId -> { term, fit, hooks: Set }
let paneSeq = 0;

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function countBlocks(n) { return n.type === 'block' ? 1 : (n.children || []).reduce((s, c) => s + countBlocks(c), 0); }
function termOf(core, addr) { return core.terminals.find((t) => t.address === addr || t.name === addr); }

function renderSide() {
  const side = $('#side');
  side.textContent = '';
  for (const core of cores) {
    const h = el('div', 'core', `${core.key} · ${core.core?.name} · hc ${core.version}`);
    if (core.readonly) h.append(el('span', 'badge', 'read-only'));
    side.append(h);
    if (!core.spaces.length) side.append(el('div', 'tab', '(no spaces in doc herdr-app)'));
    for (const sp of core.spaces) {
      side.append(el('div', 'space', sp.name));
      for (const tab of sp.tabs) {
        const row = el('div', 'tab');
        row.append(el('span', '', tab.name || tab.id.slice(0, 8)), el('span', 'n', `${countBlocks(tab.root)} pane${countBlocks(tab.root) === 1 ? '' : 's'}`));
        if (selected && selected.core === core.key && selected.tabId === tab.id) row.classList.add('on');
        row.onclick = () => select(core.key, sp.id, tab.id);
        side.append(row);
      }
    }
    const loose = core.terminals.filter((t) => t.state === 'live').length;
    side.append(el('div', 'tab', `${loose} live terminals on this core`));
  }
}

function clearStage() {
  for (const [id, p] of panes) { ipcRenderer.send('pane-close', id); p.term.dispose(); }
  panes.clear();
  $('#stage').textContent = '';
}

function select(coreKey, spaceId, tabId) {
  selected = { core: coreKey, spaceId, tabId };
  const core = cores.find((c) => c.key === coreKey);
  const space = core.spaces.find((s) => s.id === spaceId);
  const tab = space.tabs.find((t) => t.id === tabId);
  $('#where').textContent = `${space.name} › ${tab.name || tab.id}`;
  clearStage();
  $('#stage').append(buildNode(core, tab.root));
  renderSide();
}

function buildNode(core, node) {
  if (node.type === 'block') return buildPane(core, node);
  const box = el('div', `split ${node.type === 'column' ? 'column' : 'row'}`);
  for (const child of node.children || []) {
    const c = buildNode(core, child);
    c.style.flex = `${child.size?.weight ?? 1} 1 0`;
    box.append(c);
  }
  return box;
}

function buildPane(core, block) {
  const addr = block.content?.terminal;
  const t = termOf(core, addr);
  const pane = el('div', 'pane');
  const title = el('div', 'title');
  title.append(el('span', '', `${addr}${t?.name ? ' · ' + t.name : ''}`), el('span', '', t?.agent || ''), el('span', `st ${t?.status || ''}`, t?.state === 'live' ? (t?.status || 'live') : (t?.state || 'unknown')));
  const body = el('div', 'term');
  pane.append(title, body);
  if (core.readonly || t?.labels?.spike !== 'code-mode') {
    pane.classList.add('ro');
    body.textContent = core.readonly ? 'listed from your real core: the spike never attaches here' : 'not a spike terminal';
    return pane;
  }
  queueMicrotask(() => attachPane(core, addr, body));
  return pane;
}

async function attachPane(core, addr, body) {
  const term = new Terminal({ fontFamily: 'Menlo, monospace', fontSize: 12, cursorBlink: true, allowProposedApi: true, theme: { background: '#0f1115' } });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(body);
  let webgl = false;
  try { term.loadAddon(new WebglAddon.WebglAddon()); webgl = true; } catch { /* falls back to DOM renderer */ }
  fit.fit();
  const paneId = `p${++paneSeq}`;
  const p = { term, fit, hooks: new Set(), addr, webgl };
  panes.set(paneId, p);
  await ipcRenderer.invoke('attach', { core: core.key, terminal: addr, cols: term.cols, rows: term.rows, paneId });
  term.onData((d) => ipcRenderer.send('pane-input', paneId, new TextEncoder().encode(d)));
  term.onBinary((d) => ipcRenderer.send('pane-input', paneId, Uint8Array.from(d, (c) => c.charCodeAt(0))));
  term.textarea?.addEventListener('focus', () => ipcRenderer.send('pane-focus', paneId, true));
  term.textarea?.addEventListener('blur', () => ipcRenderer.send('pane-focus', paneId, false));
  new ResizeObserver(() => { fit.fit(); ipcRenderer.send('pane-resize', paneId, term.cols, term.rows); }).observe(body);
  return paneId;
}

// Stream in: write, and credit the core only once xterm has consumed the bytes.
ipcRenderer.on('pane-data', (_e, paneId, data) => {
  const p = panes.get(paneId);
  if (!p) return;
  const arrived = performance.now();
  p.term.write(data, () => {
    ipcRenderer.send('pane-credit', paneId, data.length);
    for (const h of p.hooks) h(data, arrived);
  });
});
ipcRenderer.on('pane-closed', (_e, paneId) => panes.get(paneId)?.term.write('\r\n[stream closed]\r\n'));

ipcRenderer.on('cores', (_e, snap) => {
  const first = !cores.length;
  cores = snap;
  renderSide();
  if (first) autoSelect();
});

async function autoSelect() {
  const live = cores.find((c) => !c.readonly && c.spaces.length);
  if (live) select(live.key, live.spaces[0].id, live.spaces[0].tabs[0].id);
  const cfg = await ipcRenderer.invoke('bench-config');
  if (cfg?.bench) setTimeout(runBench, 1500);
}

// ---- in-window measurements
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2); };
const stats = (a) => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99), max: +Math.max(...a).toFixed(2) });

function paneByName(name) { for (const [id, p] of panes) if (p.addr === name || p.addr.endsWith(name)) return [id, p]; return []; }

async function runBench() {
  const ids = [...panes.keys()];
  const [echoId, echo] = [ids[0], panes.get(ids[0])];
  const [tpId, tp] = [ids[1], panes.get(ids[1])];
  const out = { webgl: echo.webgl };

  // 1. key -> painted echo, through IPC, hc, pty and xterm.js (WebGL renderer)
  const toWrite = [], toPaint = [];
  for (let i = 0; i < 220; i++) {
    const t0 = performance.now();
    await new Promise((res) => {
      const hook = (d, arrived) => {
        if (!new TextDecoder().decode(d).includes('x')) return;
        echo.hooks.delete(hook);
        toWrite.push(arrived - t0);
        requestAnimationFrame(() => { toPaint.push(performance.now() - t0); res(); });
      };
      echo.hooks.add(hook);
      ipcRenderer.send('pane-input', echoId, new TextEncoder().encode('x'));
    });
    if (i % 60 === 59) { ipcRenderer.send('pane-input', echoId, new Uint8Array([0x15])); await sleep(40); }
    await sleep(8);
  }
  out.key_to_arrival_ms = stats(toWrite.slice(20));
  out.key_to_next_frame_ms = stats(toPaint.slice(20));

  // 2. throughput through xterm.js with real backpressure (credit after parse)
  for (const lines of [100000, 1000000]) {
    let got = 0, tail = '';
    const t0 = performance.now();
    await new Promise((res) => {
      const hook = (d) => {
        got += d.length;
        tail = (tail + new TextDecoder().decode(d)).slice(-120);
        if (tail.includes('BENCH-DONE\r\n')) { tp.hooks.delete(hook); res(); }
      };
      tp.hooks.add(hook);
      ipcRenderer.send('pane-input', tpId, new TextEncoder().encode(`seq 1 ${lines}; echo BENCH-""DONE\r`));
    });
    const ms = performance.now() - t0;
    out[`seq_${lines}`] = { ms: +ms.toFixed(1), bytes: got, MB_per_s: +(got / ms / 1000).toFixed(2) };
    await sleep(300);
  }
  await sleep(500);
  const lines = (t) => { const b = t.buffer.active, o = []; for (let i = Math.max(0, b.length - t.rows); i < b.length; i++) o.push(b.getLine(i)?.translateToString(true)); return o.filter(Boolean).slice(-6); };
  out.window_text = { header: $('header').innerText, sidebar: $('#side').innerText.split('\n').slice(0, 60), panes: [...panes.values()].map((p) => ({ addr: p.addr, cols: p.term.cols, rows: p.term.rows, last_lines: lines(p.term) })) };
  await ipcRenderer.invoke('bench-done', out);
}
