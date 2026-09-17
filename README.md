# NoteShare ⚡

Ultra-fast real-time text sharing between Mac and iPhone over local Wi-Fi.

**Mac → Paste → Instant update → iPhone**

No lag. No submit button. No database. Sub-20ms latency on local network.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start WebSocket server (terminal 1)
npm run server

# Start Vite dev server (terminal 2)
npm run dev
```

Then:
1. Open `http://localhost:5173/control` on Mac
2. Scan QR code with iPhone camera
3. Paste text on Mac → iPhone updates instantly

---

## How It Works

```
Mac textarea → WebSocket → Server (in-memory) → WebSocket → iPhone DOM
```

- **Zero database** — content stored in-memory only
- **TCP_NODELAY** — Nagle's algorithm disabled (~40ms saved)
- **No compression** — zero overhead on local network
- **Direct DOM updates** — bypasses React on display page
- **Raw message forwarding** — server doesn't re-serialize JSON

---

## Performance Optimizations

| Optimization | Latency Saved |
|---|---|
| TCP_NODELAY (disable Nagle) | ~40ms |
| perMessageDeflate: false | ~5-10ms |
| Raw message forwarding | ~1-2ms |
| Direct DOM update on display | ~2-5ms |
| No debounce on paste | ~150ms |
| Binary-ready WebSocket | ~1ms |

**Expected total latency: 3-8ms on local Wi-Fi**

---

## Deployment

### Option 1: Render.com (Recommended — Free)

1. Push to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start:prod`
   - **Environment:** Node
5. Add environment variable: `PORT=3001`
6. Deploy!

### Option 2: Railway

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Railway auto-detects Node.js
4. Set start command: `npm run start:prod`
5. Done!

### Option 3: VPS (DigitalOcean, AWS, etc.)

```bash
# On server
git clone <your-repo>
cd NoteShare
npm install
npm run build
PORT=3001 npm run start:prod

# Use PM2 for process management
npm install -g pm2
PORT=3001 pm2 start server/index.ts --interpreter tsx --name noteshare
```

### Option 4: Docker

```bash
docker build -t noteshare .
docker run -p 3001:3001 noteshare
```

### What changes for production?

| Setting | Development | Production |
|---|---|---|
| Frontend | Vite dev server (port 5173) | Built static files served by Express |
| Server | `tsx server/index.ts` | `tsx server/index.ts` (same) |
| WebSocket | Proxied via Vite | Direct to Express server |
| Port | 5173 (Vite) + 3001 (server) | Single port (3001) |
| URL | `localhost:5173` | Your domain/IP |

### HTTPS/WSS (for public deployment)

Use a reverse proxy like Caddy (auto-HTTPS):

```
# Caddyfile
yourdomain.com {
    reverse_proxy localhost:3001
}
```

Or nginx:

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite
- **Backend:** Express 5, ws (raw WebSocket)
- **QR Code:** react-qr-code (SVG, ~5KB)
- **Total bundle:** ~95KB gzipped
- **Dependencies:** 5 production, 6 dev

---

## Project Structure

```
NoteShare/
├── server/index.ts          # Express + WebSocket server
├── src/
│   ├── main.tsx             # React entry
│   ├── App.tsx              # Router
│   ├── hooks/useWebSocket.ts # WebSocket + reconnection
│   ├── pages/
│   │   ├── ControlPage.tsx  # Mac input
│   │   └── DisplayPage.tsx  # iPhone output
│   ├── components/
│   │   ├── ConnectionStatus.tsx
│   │   ├── QRCodePanel.tsx
│   │   └── FormattedText.tsx
│   ├── utils/room.ts
│   └── index.css
├── index.html
├── vite.config.ts
└── package.json
```

## License

MIT
