import { useRef, useEffect, useCallback, useState } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
const THROTTLE_MS = 16; // ~60fps cap on outgoing events

// ─── Draw a single stroke segment on a canvas context ────────────────────────
function drawSegment(ctx, { x, y, prevX, prevY, color, size }) {
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(prevX, prevY);
  ctx.lineTo(x, y);
  ctx.stroke();
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Canvas() {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const isDrawingRef = useRef(false);
  const prevPosRef = useRef({ x: 0, y: 0 });
  const lastSentRef = useRef(0);

  const [color, setColor] = useState('#6c63ff');
  const [size, setSize] = useState(4);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('connecting…');

  // Keep latest color/size accessible inside stable callbacks
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { sizeRef.current = size; }, [size]);

  // ── WebSocket setup ──────────────────────────────────────────────────────
  useEffect(() => {
    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setStatus('connected');
      };

      ws.onclose = () => {
        setConnected(false);
        setStatus('reconnecting…');
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        setStatus('error — retrying');
      };

      ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (data.type === 'draw') {
          drawSegment(ctx, data);
        } else if (data.type === 'clear') {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  // ── Canvas resize (keep it full-window) ──────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      // Save content, resize, restore
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = canvas.width;
      tmpCanvas.height = canvas.height;
      tmpCanvas.getContext('2d').drawImage(canvas, 0, 0);

      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;

      canvas.getContext('2d').drawImage(tmpCanvas, 0, 0);
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Send drawing data over WebSocket (throttled) ─────────────────────────
  const sendDraw = useCallback((payload) => {
    const now = Date.now();
    if (now - lastSentRef.current < THROTTLE_MS) return;
    lastSentRef.current = now;

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'draw', ...payload }));
    }
  }, []);

  // ── Get canvas-relative position from a mouse/touch event ───────────────
  const getPos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  // ── Mouse / touch handlers ───────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    isDrawingRef.current = true;
    const pos = getPos(e);
    prevPosRef.current = pos;
  }, [getPos]);

  const onPointerMove = useCallback((e) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();

    const pos = getPos(e);
    const { x: prevX, y: prevY } = prevPosRef.current;
    const payload = {
      x: pos.x,
      y: pos.y,
      prevX,
      prevY,
      color: colorRef.current,
      size: sizeRef.current,
    };

    // Draw locally (optimistic)
    drawSegment(canvasRef.current.getContext('2d'), payload);

    // Broadcast
    sendDraw(payload);

    prevPosRef.current = pos;
  }, [getPos, sendDraw]);

  const onPointerUp = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  // ── Clear canvas ─────────────────────────────────────────────────────────
  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'clear' }));
    }
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <header className="toolbar">
        <div className="toolbar__brand">
          <span className="toolbar__icon">🖌️</span>
          <span className="toolbar__title">GarlicBoard</span>
        </div>

        <div className="toolbar__controls">
          {/* Color picker */}
          <label className="control-group" title="Brush color">
            <span className="control-label">Color</span>
            <div className="color-swatch" style={{ background: color }}>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="color-input"
                id="color-picker"
              />
            </div>
          </label>

          {/* Brush size */}
          <label className="control-group" title="Brush size">
            <span className="control-label">Size&nbsp;{size}px</span>
            <input
              type="range"
              min={1}
              max={40}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="size-slider"
              id="size-slider"
            />
          </label>

          {/* Preset color swatches */}
          <div className="color-presets" aria-label="Color presets">
            {['#6c63ff', '#ff6584', '#43e97b', '#f7971e', '#fff', '#222'].map((c) => (
              <button
                key={c}
                className={`preset ${color === c ? 'preset--active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                title={c}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="toolbar__actions">
          {/* Status pill */}
          <span className={`status-pill ${connected ? 'status-pill--on' : 'status-pill--off'}`}>
            <span className="status-dot" />
            {status}
          </span>

          <button className="btn btn--danger" onClick={clearCanvas} id="clear-btn">
            Clear
          </button>
        </div>
      </header>

      {/* ── Canvas ───────────────────────────────────────────── */}
      <canvas
        ref={canvasRef}
        className="drawing-canvas"
        id="drawing-canvas"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
      />

      {/* ── Brush preview cursor ─────────────────────────────── */}
    </div>
  );
}
