// Minimal herdr-core (hc) client: framed JSON-RPC over the core's unix socket.
//
// Wire format, decoded from `hc attach` traffic (hc 0.1.17, protocol generation 1) and confirmed
// against herdr-core's schema/README.md:
//   1. Plain mode: one JSON-RPC message per line. Send `hello {framed:true}`;
//      its reply is the last plain line.
//   2. Framed mode: every message is  u32 channel (LE) | u8 type | u32 length (LE) | payload.
//      Channel 0 carries JSON-RPC (type 0). terminal.attach returns a channel number;
//      on that channel:
//        type 0 DATA    raw terminal bytes, both directions (keys in, screen out)
//        type 1 CREDIT  u32 LE: bytes the viewer consumed (flow control)
//        type 2 CLOSE   empty; either side ends the stream, the other echoes it
//        type 3 RESIZE  u16 cols LE, u16 rows LE
//        type 4 FOCUS   u8, 1 = focused, 0 = not
//        type 5 FACTS   viewer -> core: JSON display facts (from upstream schema/README.md)
//        type 6 AUTOMATIC_INPUT  query replies; only when hello and attach both confirm `automatic_input`
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export const T = { DATA: 0, CREDIT: 1, CLOSE: 2, RESIZE: 3, FOCUS: 4, FACTS: 5, AUTOMATIC_INPUT: 6 };

export function defaultSocket(session = process.env.HC_SESSION || 'default') {
  if (process.env.HC_SOCKET) return process.env.HC_SOCKET;
  const state = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(state, 'herdr-core', session, `${session}.sock`);
}

function frame(channel, type, payload = Buffer.alloc(0)) {
  const h = Buffer.alloc(9);
  h.writeUInt32LE(channel, 0);
  h[4] = type;
  h.writeUInt32LE(payload.length, 5);
  return Buffer.concat([h, payload]);
}

export class HcClient extends EventEmitter {
  constructor(socketPath = defaultSocket()) {
    super();
    this.socketPath = socketPath;
    this.nextId = 1;
    this.pending = new Map();
    this.channels = new Map(); // channel -> Attachment
    this.framed = false;
    this.buf = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.connect(this.socketPath);
      this.sock.setNoDelay?.(true);
      this.sock.once('error', reject);
      this.sock.on('data', (d) => this.#onData(d));
      this.sock.on('close', () => this.emit('close'));
      this.sock.once('connect', async () => {
        this.sock.off('error', reject);
        this.sock.on('error', (e) => this.emit('error', e));
        // hello goes as a plain line; its reply is the last plain line.
        this.sock.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'hello', params: { framed: true, generation: 1 } }) + '\n');
        this.pending.set(0, { resolve: (r) => { this.hello = r; resolve(r); }, reject });
      });
    });
  }

  #onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (!this.framed) {
      const nl = this.buf.indexOf(10);
      if (nl < 0) return;
      const msg = JSON.parse(this.buf.subarray(0, nl).toString());
      this.buf = this.buf.subarray(nl + 1);
      this.framed = true;
      this.#onRpc(msg);
    }
    while (this.buf.length >= 9) {
      const ch = this.buf.readUInt32LE(0), ty = this.buf[4], len = this.buf.readUInt32LE(5);
      if (this.buf.length < 9 + len) break;
      const p = this.buf.subarray(9, 9 + len);
      this.buf = this.buf.subarray(9 + len);
      if (ch === 0) this.#onRpc(JSON.parse(p.toString()));
      else this.channels.get(ch)?._frame(ty, p);
    }
  }

  #onRpc(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(Object.assign(new Error(msg.error.message), { data: msg.error.data }));
      else resolve(msg.result);
    } else if (msg.method) {
      this.emit('notification', msg); // events.subscribe: method "event", "heartbeat", "missed"
    }
  }

  call(method, params = {}) {
    const id = this.nextId++;
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.sock.write(frame(0, 0, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }))));
    return p;
  }

  send(channel, type, payload) { this.sock.write(frame(channel, type, payload)); }

  async attach(terminal, { cols = 80, rows = 24, observe = false, history = 0 } = {}) {
    const r = await this.call('terminal.attach', { terminal, cols, rows, observe, history, display: { bg: null, cell: null, cursor: null, fg: null } });
    const a = new Attachment(this, r.channel, r.terminal);
    this.channels.set(r.channel, a);
    return a;
  }

  close() { this.sock?.end(); }
}

export class Attachment extends EventEmitter {
  constructor(client, channel, terminal) {
    super();
    Object.assign(this, { client, channel, terminal });
  }
  _frame(type, p) {
    if (type === T.DATA) {
      this.emit('data', p);
    } else if (type === T.CLOSE) {
      this.client.channels.delete(this.channel);
      this.emit('close');
    } else this.emit('frame', type, p);
  }
  // Credit after the bytes are consumed (rendered). hc attach credits per chunk.
  credit(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); this.client.send(this.channel, T.CREDIT, b); }
  write(data) { this.client.send(this.channel, T.DATA, Buffer.isBuffer(data) ? data : Buffer.from(data)); }
  resize(cols, rows) { const b = Buffer.alloc(4); b.writeUInt16LE(cols, 0); b.writeUInt16LE(rows, 2); this.client.send(this.channel, T.RESIZE, b); }
  focus(on) { this.client.send(this.channel, T.FOCUS, Buffer.from([on ? 1 : 0])); }
  detach() { this.client.send(this.channel, T.CLOSE); }
}
