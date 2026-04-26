require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Simple health-check endpoint
app.get('/', (_req, res) => res.json({ status: 'ok', clients: wss?.clients?.size ?? 0 }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── Helpers ────────────────────────────────────────────────────────────────

function broadcast(sender, data) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client !== sender && client.readyState === 1 /* OPEN */) {
      client.send(message);
    }
  });
}

// ─── Connection Handler ──────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[+] Client connected   (${ip}) — total: ${wss.clients.size}`);

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      console.warn('Invalid JSON received, skipping.');
      return;
    }

    // Accept only known event types
    if (data.type === 'draw' || data.type === 'clear') {
      broadcast(ws, data);
    }
  });

  ws.on('close', () => {
    console.log(`[-] Client disconnected (${ip}) — total: ${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🖌  Drawing server running on http://localhost:${PORT}`);
  console.log(`🔌  WebSocket endpoint: ws://localhost:${PORT}`);
});
