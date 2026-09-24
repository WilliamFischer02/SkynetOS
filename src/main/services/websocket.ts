import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/**
 * The smallest WebSocket server that is still correct (RFC 6455), for the remote bridge.
 *
 * Written rather than installed: the remote server needs text messages, ping/pong and close,
 * nothing else, and a hand-held 200 lines is a smaller thing to trust on a port that reaches the
 * outside world than a dependency tree. Every frame rule that matters is enforced and tested
 * (test/websocket.test.ts): client frames must be masked, lengths use the 7/16/64-bit forms,
 * fragments reassemble, control frames are never fragmented, and anything over the size cap closes
 * the connection with 1009.
 */

export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OP_CONT = 0x0;
export const OP_TEXT = 0x1;
export const OP_BINARY = 0x2;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

/** The `Sec-WebSocket-Accept` for a client's key. */
export function acceptKey(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

/** A server frame: FIN set, never masked (servers must not mask). */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** A CLIENT frame, masked. For tests; browsers do this themselves. */
export function encodeClientFrame(opcode: number, payload: Buffer, mask: Buffer = Buffer.from([1, 2, 3, 4]), fin = true): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) header = Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = (fin ? 0x80 : 0) | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = (fin ? 0x80 : 0) | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
  const body = Buffer.alloc(len);
  for (let i = 0; i < len; i++) body[i] = payload[i]! ^ mask[i % 4]!;
  return Buffer.concat([header, mask, body]);
}

export interface WsFrame { fin: boolean; opcode: number; payload: Buffer }

/**
 * Frames from a buffer of client bytes. Returns the complete frames and whatever is left over, or
 * an error code to close with (1002 protocol error, 1009 too big).
 */
export function decodeClientFrames(buffer: Buffer, maxBytes: number): { frames: WsFrame[]; rest: Buffer } | { error: number } {
  const frames: WsFrame[] = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const b0 = buffer[offset]!;
    const b1 = buffer[offset + 1]!;
    const fin = (b0 & 0x80) !== 0;
    if (b0 & 0x70) return { error: 1002 }; // no extensions were negotiated, so RSV bits must be clear
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    if (!masked) return { error: 1002 };
    let len = b1 & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (buffer.length - pos < 2) break;
      len = buffer.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (buffer.length - pos < 8) break;
      const big = buffer.readBigUInt64BE(pos);
      if (big > BigInt(maxBytes)) return { error: 1009 };
      len = Number(big);
      pos += 8;
    }
    if (len > maxBytes) return { error: 1009 };
    if (opcode >= 0x8 && (!fin || len > 125)) return { error: 1002 };
    if (buffer.length - pos < 4 + len) break;
    const mask = buffer.subarray(pos, pos + 4);
    pos += 4;
    const payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) payload[i] = buffer[pos + i]! ^ mask[i % 4]!;
    frames.push({ fin, opcode, payload });
    offset = pos + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/** One open WebSocket. Emits 'message' (text) and 'close'. */
export class WsConnection extends EventEmitter {
  private buffered: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private closed = false;

  constructor(private readonly socket: Duplex, private readonly maxBytes: number) {
    super();
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  get isOpen(): boolean { return !this.closed; }

  send(text: string): void {
    if (this.closed) return;
    this.socket.write(encodeFrame(OP_TEXT, Buffer.from(text, 'utf8')));
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    try { this.socket.write(encodeFrame(OP_CLOSE, body)); } catch { /* the socket is going anyway */ }
    this.socket.end();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  private onData(chunk: Buffer): void {
    if (this.closed) return;
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk]) : chunk;
    const decoded = decodeClientFrames(this.buffered, this.maxBytes);
    if ('error' in decoded) { this.close(decoded.error, decoded.error === 1009 ? 'too big' : 'protocol error'); return; }
    this.buffered = Buffer.from(decoded.rest);
    for (const frame of decoded.frames) {
      if (this.closed) return;
      switch (frame.opcode) {
        case OP_PING: this.socket.write(encodeFrame(OP_PONG, frame.payload)); break;
        case OP_PONG: break;
        case OP_CLOSE: this.close(1000); return;
        case OP_TEXT:
        case OP_BINARY:
        case OP_CONT: {
          if (frame.opcode !== OP_CONT) { this.fragments = []; this.fragmentBytes = 0; }
          this.fragments.push(frame.payload);
          this.fragmentBytes += frame.payload.length;
          if (this.fragmentBytes > this.maxBytes) { this.close(1009, 'too big'); return; }
          if (frame.fin) {
            const whole = Buffer.concat(this.fragments);
            this.fragments = [];
            this.fragmentBytes = 0;
            this.emit('message', whole.toString('utf8'));
          }
          break;
        }
        default: this.close(1002, 'unknown opcode'); return;
      }
    }
  }
}

/**
 * Complete an HTTP upgrade into a WebSocket, or refuse it. The caller has already checked the
 * host, the origin and the path; this checks the handshake itself.
 */
export function upgradeToWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer, maxBytes: number): WsConnection | null {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key) || version !== '13'
    || String(req.headers['upgrade'] ?? '').toLowerCase() !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
  );
  const conn = new WsConnection(socket, maxBytes);
  if (head.length) socket.emit('data', head);
  return conn;
}
