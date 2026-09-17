import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DisplaySettings {
  fontSize: number;
  lineHeight: number;
  wordWrap: boolean;
  plainText: boolean;
}

interface RoomState {
  content: string;
  settings: DisplaySettings;
  clients: Map<WebSocket, 'control' | 'display'>;
}

// ─── State ───────────────────────────────────────────────────────────────────

const rooms = new Map<string, RoomState>();
const clientRooms = new Map<WebSocket, string>();

const DEFAULT_SETTINGS: DisplaySettings = {
  fontSize: 22,
  lineHeight: 1.6,
  wordWrap: true,
  plainText: true,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      content: '',
      settings: { ...DEFAULT_SETTINGS },
      clients: new Map(),
    };
    rooms.set(roomId, room);
  }
  return room;
}

function broadcastRaw(room: RoomState, rawMessage: string, exclude?: WebSocket) {
  for (const [client] of room.clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(rawMessage);
    }
  }
}

function notifyPeerStatus(room: RoomState) {
  const hasControl = [...room.clients.values()].includes('control');
  const hasDisplay = [...room.clients.values()].includes('display');
  for (const [client, role] of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      const peerConnected = role === 'control' ? hasDisplay : hasControl;
      const peerRole = role === 'control' ? 'display' : 'control';
      client.send(JSON.stringify({
        type: 'PEER_STATUS',
        connected: peerConnected,
        peerRole,
      }));
    }
  }
}

function getLanIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;
    for (const net of nets) {
      if (!net.internal && net.family === 'IPv4') return net.address;
    }
  }
  return 'localhost';
}

function sanitizeRoomId(id: string): string {
  return id.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 20);
}

// ─── Express ─────────────────────────────────────────────────────────────────

const app = express();
const server = createServer(app);

app.get('/api/ip', (_req, res) => { res.json({ ip: getLanIP() }); });
app.get('/api/health', (_req, res) => { res.json({ status: 'ok', rooms: rooms.size }); });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('{*path}', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => { if (err) next(); });
});

// ─── WebSocket Server ────────────────────────────────────────────────────────
//
// PROTOCOL:
//   HOT PATH (text updates — no JSON):
//     "T" + 13-digit-timestamp + raw-content
//     Example: "T1694961234567Hello World"
//     Server checks first char = "T", forwards raw, zero parsing.
//
//   COLD PATH (joins, settings, sync — JSON):
//     Standard JSON messages.
//

const wss = new WebSocketServer({
  server,
  path: '/ws',
  perMessageDeflate: false,
  maxPayload: 2 * 1024 * 1024,
});

wss.on('connection', (ws: WebSocket, req) => {
  // PERF: Disable Nagle's algorithm
  const socket = (req.socket as any);
  if (socket?.setNoDelay) socket.setNoDelay(true);

  // Heartbeat
  (ws as any).__isAlive = true;
  ws.on('pong', () => { (ws as any).__isAlive = true; });

  let joined = false;

  ws.on('message', (raw: Buffer) => {
    const str = raw.toString();

    // ── HOT PATH: Text Update ────────────────────────────────────────────
    // First char = "T" → binary text protocol, skip JSON entirely.
    // Format: "T" + 13-digit timestamp + raw content
    // Server just: extracts content (for room state), forwards raw message.
    if (str.charCodeAt(0) === 84 /* 'T' */) {
      if (!joined) return;
      const roomId = clientRooms.get(ws);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      // Extract content (skip "T" + 13 digits = 14 chars)
      room.content = str.length > 14 ? str.slice(14) : '';

      // PERF: Forward the EXACT raw string — zero serialization
      broadcastRaw(room, str, ws);
      return;
    }

    // ── COLD PATH: JSON messages (JOIN, SETTINGS, etc.) ──────────────────
    let msg: any;
    try { msg = JSON.parse(str); }
    catch { return; }

    switch (msg.type) {
      case 'JOIN': {
        const roomId = sanitizeRoomId(msg.room);
        if (!roomId) return;
        const role = msg.role === 'display' ? 'display' : 'control';
        const room = getOrCreateRoom(roomId);

        const prevRoomId = clientRooms.get(ws);
        if (prevRoomId) {
          const prevRoom = rooms.get(prevRoomId);
          if (prevRoom) {
            prevRoom.clients.delete(ws);
            notifyPeerStatus(prevRoom);
            if (prevRoom.clients.size === 0) rooms.delete(prevRoomId);
          }
        }

        room.clients.set(ws, role);
        clientRooms.set(ws, roomId);
        joined = true;

        ws.send(JSON.stringify({
          type: 'SYNC',
          content: room.content,
          settings: room.settings,
        }));
        notifyPeerStatus(room);
        break;
      }

      case 'SETTINGS_UPDATE': {
        if (!joined) return;
        const roomId = clientRooms.get(ws);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        if (msg.settings && typeof msg.settings === 'object') {
          room.settings = { ...room.settings, ...msg.settings };
        }
        broadcastRaw(room, str, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    const roomId = clientRooms.get(ws);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.clients.delete(ws);
        notifyPeerStatus(room);
        if (room.clients.size === 0) {
          setTimeout(() => {
            const r = rooms.get(roomId);
            if (r && r.clients.size === 0) rooms.delete(roomId);
          }, 60000);
        }
      }
    }
    clientRooms.delete(ws);
  });

  ws.on('error', () => {});
});

// Heartbeat
setInterval(() => {
  wss.clients.forEach((ws) => {
    if ((ws as any).__isAlive === false) { ws.terminate(); return; }
    (ws as any).__isAlive = false;
    ws.ping();
  });
}, 30000);

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3001', 10);
const lanIP = getLanIP();

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║          NoteShare Server Running             ║');
  console.log('║          ⚡ Ultra-Low Latency Mode            ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log(`║  Local:     http://localhost:${PORT}              ║`);
  console.log(`║  Network:   http://${lanIP}:${PORT}          ║`);
  console.log('║  Protocol:  Binary text (no JSON on hot path) ║');
  console.log('║  Nagle:     DISABLED (TCP_NODELAY)            ║');
  console.log('║  Compress:  DISABLED (zero overhead)          ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('');
});
