// Spike: code mode inside an Electron window, on herdr-core.
// Lists herdr-app's spaces/tabs/split layouts (doc "herdr-app") and live terminal
// status from one or more hc cores, and attaches xterm.js panes to terminals.
//
// Safety for the spike: a core given in CODE_MODE_READONLY_SOCKET is listed only
// (never attached, never written). Attaching is allowed only on CODE_MODE_SOCKET and
// only to terminals labelled spike=code-mode.
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HcClient } from './hc-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LIVE = process.env.CODE_MODE_SOCKET;
const READONLY = process.env.CODE_MODE_READONLY_SOCKET;
const BENCH = process.env.CODE_MODE_BENCH; // path to write renderer measurements to

const cores = {}; // key -> { client, readonly, terminals: Map }
let win;
const t0 = Date.now();

async function openCore(key, sock, readonly) {
  const client = new HcClient(sock);
  const hello = await client.connect();
  const core = { key, client, readonly, hello, terminals: new Map(), spaces: [] };
  cores[key] = core;
  const doc = await client.call('doc.get', { name: 'herdr-app' });
  core.spaces = doc.value?.spaces ?? [];
  // events.subscribe in framed mode: a snapshot now, then JSON lines on a channel.
  const sub = await client.call('events.subscribe', {});
  for (const t of sub.terminals) core.terminals.set(t.address, t);
  if (sub.channel != null) {
    let pend = '';
    client.channels.set(sub.channel, {
      _frame(type, p) {
        if (type !== 0) return;
        const credit = Buffer.alloc(4); credit.writeUInt32LE(p.length);
        client.send(sub.channel, 1, credit);
        pend += p.toString();
        let i;
        while ((i = pend.indexOf('\n')) >= 0) {
          const line = pend.slice(0, i); pend = pend.slice(i + 1);
          if (line.trim()) onEvent(core, JSON.parse(line));
        }
      },
    });
  }
  return core;
}

function onEvent(core, msg) {
  const ev = msg.params ?? msg;
  if (msg.method === 'event' && ev?.terminal) {
    const t = typeof ev.terminal === 'object' ? ev.terminal : null;
    if (t?.address) core.terminals.set(t.address, t);
  }
  if (msg.method === 'event' && ev?.kind === 'doc' && ev?.name === 'herdr-app') {
    core.client.call('doc.get', { name: 'herdr-app' }).then((d) => { core.spaces = d.value?.spaces ?? []; push(); });
    return;
  }
  push();
}

function snapshot() {
  return Object.values(cores).map((c) => ({
    key: c.key, readonly: c.readonly, version: c.hello.version, core: c.hello.core,
    spaces: c.spaces,
    terminals: [...c.terminals.values()].map((t) => ({ address: t.address, name: t.name, state: t.state, status: t.status, labels: t.labels, agent: t.foreground?.name })),
  }));
}
let pushTimer;
function push() { clearTimeout(pushTimer); pushTimer = setTimeout(() => win?.webContents.send('cores', snapshot()), 50); }

// ---- attach plumbing: renderer pane id <-> hc channel
const panes = new Map(); // paneId -> Attachment
ipcMain.handle('attach', async (_e, { core, terminal, cols, rows, paneId }) => {
  const c = cores[core];
  if (!c || c.readonly) throw new Error('read-only core: listing only');
  const t = c.terminals.get(terminal);
  if (t?.labels?.spike !== 'code-mode') throw new Error('spike attaches only to its own terminals (label spike=code-mode)');
  const a = await c.client.attach(terminal, { cols, rows });
  panes.set(paneId, a);
  a.on('data', (d) => win?.webContents.send('pane-data', paneId, d));
  a.on('close', () => { panes.delete(paneId); win?.webContents.send('pane-closed', paneId); });
  return { channel: a.channel };
});
ipcMain.on('pane-close', (_e, paneId) => { panes.get(paneId)?.detach(); panes.delete(paneId); });
ipcMain.on('pane-input', (_e, paneId, data) => panes.get(paneId)?.write(Buffer.from(data)));
ipcMain.on('pane-credit', (_e, paneId, n) => panes.get(paneId)?.credit(n));
ipcMain.on('pane-resize', (_e, paneId, cols, rows) => panes.get(paneId)?.resize(cols, rows));
ipcMain.on('pane-focus', (_e, paneId, on) => panes.get(paneId)?.focus(on));
ipcMain.handle('snapshot', () => snapshot());
ipcMain.handle('bench-done', async (_e, result) => {
  const metrics = app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, rss_mb: Math.round((m.memory.workingSetSize ?? 0) / 1024) }));
  const img = await win.webContents.capturePage();
  const shot = path.join(here, 'shots', 'code-mode-window.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  fs.writeFileSync(shot, img.toPNG());
  fs.writeFileSync(BENCH, JSON.stringify({ ...result, start_to_bench_ms: Date.now() - t0, app_metrics: metrics, total_rss_mb: metrics.reduce((s, m) => s + m.rss_mb, 0), screenshot: shot }, null, 2));
  if (process.env.CODE_MODE_QUIT) app.quit();
});
ipcMain.handle('bench-config', () => (BENCH ? { bench: true } : null));

app.whenReady().then(async () => {
  if (READONLY) await openCore('this-mac', READONLY, true);
  if (LIVE) await openCore('spike', LIVE, false);
  win = new BrowserWindow({
    width: 1400, height: 860, title: 'Automagik — code mode spike',
    backgroundColor: '#0f1115',
    webPreferences: { nodeIntegration: true, contextIsolation: false }, // spike only
  });
  win.loadFile(path.join(here, 'index.html'));
  win.webContents.on('did-finish-load', () => push());
});
app.on('window-all-closed', () => app.quit());
