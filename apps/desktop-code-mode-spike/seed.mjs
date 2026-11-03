// Seed an ISOLATED core (never the default one) with spike terminals and a
// herdr-app-shaped layout doc, so the window has live split panes to attach.
//   node seed.mjs <socket-of-isolated-core>
import { HcClient } from './hc-client.mjs';

const sock = process.argv[2];
if (!sock || sock.includes('/default/')) { console.error('refusing: give the socket of an isolated core'); process.exit(2); }
const c = new HcClient(sock);
await c.connect();
const labels = { spike: 'code-mode' };
const cwd = process.cwd();
const run = async (name, argv) => (await c.call('terminal.run', { name, argv, cwd, labels, no_parent: true })).address
  ?? (await c.call('terminal.get', { terminal: name })).address;
const echo = await run('demo-echo', ['cat']);
const sh = await run('demo-shell', ['bash', '--norc', '-i']);
const top = await run('demo-top', ['top', '-o', 'cpu', '-n', '15']);
const block = (id, terminal, weight = 1) => ({ id, type: 'block', size: { weight }, content: { terminal } });
const value = {
  spaces: [{
    id: 'spSpike', name: 'Spike', folder: cwd,
    tabs: [
      { id: 'tbSplit', name: 'split', root: { id: 'tbSplit', type: 'row', children: [block('pA', echo, 1), block('pB', sh, 1.5)] } },
      { id: 'tbTop', name: 'top', root: { id: 'tbTop', type: 'row', children: [block('pC', top)] } },
    ],
  }],
};
const cur = await c.call('doc.get', { name: 'herdr-app' });
const r = await c.call('doc.set', { name: 'herdr-app', value, version: cur.version });
console.log(JSON.stringify({ echo, sh, top, doc_version: r.version }));
c.close();
