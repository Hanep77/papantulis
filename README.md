# 🖌️ GarlicBoard

A minimal real-time collaborative drawing board.  
Multiple browser tabs (or different machines on the same network) share a live canvas — every stroke is broadcast instantly via WebSocket.

---

## Project structure

```
garlic/
├── backend/        Express + ws server
│   └── server.js
└── frontend/       Vite + React app
    └── src/
        ├── components/Canvas.jsx   ← drawing logic & UI
        ├── App.jsx
        └── index.css
```

---

## Quick start (two terminals)

### Terminal 1 — Backend

```bash
cd backend
npm install          # already done if you cloned the repo
npm run dev          # hot-reloads with Node --watch
# → WebSocket ready at ws://localhost:3001
```

### Terminal 2 — Frontend

```bash
cd frontend
npm install          # already done if you cloned the repo
npm run dev
# → Vite dev server at http://localhost:5173
```

Open **http://localhost:5173** in two or more browser windows and draw!

---

## How it works

| Layer      | Tech             | Role |
|------------|------------------|------|
| Backend    | Express + `ws`   | WebSocket hub — receives stroke data, fans out to all other clients |
| Frontend   | React + Canvas   | Draws locally (optimistic), sends/receives JSON stroke events |

### WebSocket message format

```jsonc
// draw event
{ "type": "draw", "x": 120, "y": 80, "prevX": 115, "prevY": 76, "color": "#6c63ff", "size": 4 }

// clear event
{ "type": "clear" }
```

### Performance notes

- Outgoing events are **throttled to ~16 ms** (≈ 60 fps) — only delta strokes are sent, never the full canvas image.
- `ResizeObserver` keeps the canvas sized to the window without losing content.
- Auto-reconnect with 2-second back-off if the WebSocket drops.

---

## Features

- 🖊 Smooth freehand drawing (mouse + touch)
- 🎨 Color picker + 6 preset swatches
- 📏 Adjustable brush size (1–40 px)
- 🗑 Clear canvas button (broadcast to all peers)
- 🟢 Live connection status indicator
- 📱 Responsive — works on mobile too

## Extending

| Goal | Where to start |
|------|----------------|
| Rooms / sessions | Add a `roomId` field to messages; group clients in a `Map` on the server |
| Persistent canvas | Store strokes in a DB; replay them on new-client connect |
| User cursors | Broadcast `{ type: "cursor", x, y, userId }` and render coloured dots |
| Auth | Add a JWT check in the `connection` handler before allowing messages |
