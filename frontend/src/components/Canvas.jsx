import { useRef, useEffect, useCallback, useState } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
const THROTTLE_MS = 16; // ~60fps cap on outgoing events
const CANVAS_BG = '#ffffff';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex) {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  return [r, g, b, 255];
}

function floodFill(ctx, startX, startY, fillColorHex) {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;
  startX = Math.floor(startX);
  startY = Math.floor(startY);

  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  const targetRgba = hexToRgba(fillColorHex);
  
  const startPos = (startY * width + startX) * 4;
  const startR = data[startPos];
  const startG = data[startPos + 1];
  const startB = data[startPos + 2];
  const startA = data[startPos + 3];
  
  if (startR === targetRgba[0] && startG === targetRgba[1] && startB === targetRgba[2] && startA === targetRgba[3]) {
    return;
  }

  const matchStartColor = (pos) => {
    return data[pos] === startR && data[pos + 1] === startG && data[pos + 2] === startB && data[pos + 3] === startA;
  };

  const colorPixel = (pos) => {
    data[pos] = targetRgba[0];
    data[pos + 1] = targetRgba[1];
    data[pos + 2] = targetRgba[2];
    data[pos + 3] = targetRgba[3];
  };

  const pixelStack = [[startX, startY]];

  while (pixelStack.length) {
    const newPos = pixelStack.pop();
    const x = newPos[0];
    let y = newPos[1];

    let pixelPos = (y * width + x) * 4;
    while (y >= 0 && matchStartColor(pixelPos)) {
      y--;
      pixelPos -= width * 4;
    }
    pixelPos += width * 4;
    y++;
    
    let reachLeft = false;
    let reachRight = false;
    
    while (y < height && matchStartColor(pixelPos)) {
      colorPixel(pixelPos);
      
      if (x > 0) {
        if (matchStartColor(pixelPos - 4)) {
          if (!reachLeft) {
            pixelStack.push([x - 1, y]);
            reachLeft = true;
          }
        } else if (reachLeft) {
          reachLeft = false;
        }
      }
      
      if (x < width - 1) {
        if (matchStartColor(pixelPos + 4)) {
          if (!reachRight) {
            pixelStack.push([x + 1, y]);
            reachRight = true;
          }
        } else if (reachRight) {
          reachRight = false;
        }
      }
      y++;
      pixelPos += width * 4;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

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

  const [tool, setTool] = useState('pen'); // pen, eraser, fill
  const [color, setColor] = useState('#222222'); // default to black
  const [size, setSize] = useState(4);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('connecting…');

  const [cursorPos, setCursorPos] = useState(null);

  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  
  useEffect(() => { toolRef.current = tool; }, [tool]);
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

        if (data.type === 'draw' || data.type === 'erase') {
          drawSegment(ctx, data);
        } else if (data.type === 'fill') {
          floodFill(ctx, data.x, data.y, data.color);
        } else if (data.type === 'clear') {
          ctx.fillStyle = CANVAS_BG;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  // ── Canvas resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = canvas.width;
      tmpCanvas.height = canvas.height;
      tmpCanvas.getContext('2d').drawImage(canvas, 0, 0);

      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = CANVAS_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(tmpCanvas, 0, 0);
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Send drawing data ────────────────────────────────────────────────────
  const sendDraw = useCallback((payload, force = false) => {
    const now = Date.now();
    if (!force && now - lastSentRef.current < THROTTLE_MS) return;
    lastSentRef.current = now;

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const getPos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  // ── Pointer handlers ─────────────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    const pos = getPos(e);
    
    if (toolRef.current === 'fill') {
      const ctx = canvasRef.current.getContext('2d');
      floodFill(ctx, pos.x, pos.y, colorRef.current);
      sendDraw({ type: 'fill', x: pos.x, y: pos.y, color: colorRef.current }, true);
      return; // fill does not trigger continuous drawing
    }

    isDrawingRef.current = true;
    prevPosRef.current = pos;
    setCursorPos(pos);
  }, [getPos, sendDraw]);

  const onPointerMove = useCallback((e) => {
    const pos = getPos(e);
    setCursorPos(pos); // Update visual cursor

    if (!isDrawingRef.current) return;
    e.preventDefault();

    const { x: prevX, y: prevY } = prevPosRef.current;
    
    const isEraser = toolRef.current === 'eraser';
    const payload = {
      type: isEraser ? 'erase' : 'draw',
      x: pos.x,
      y: pos.y,
      prevX,
      prevY,
      // Erase simply paints with the white background color
      color: isEraser ? CANVAS_BG : colorRef.current,
      size: sizeRef.current,
    };

    const ctx = canvasRef.current.getContext('2d');
    drawSegment(ctx, payload);
    sendDraw(payload);
    
    prevPosRef.current = pos;
  }, [getPos, sendDraw]);

  const onPointerUp = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    sendDraw({ type: 'clear' }, true);
  }, [sendDraw]);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar__brand">
          <span className="toolbar__icon">🖌️</span>
          <span className="toolbar__title">GarlicBoard</span>
        </div>

        <div className="toolbar__controls">
          {/* Tool selector */}
          <div className="tool-selector">
            <button 
              className={`tool-btn ${tool === 'pen' ? 'tool-btn--active' : ''}`}
              onClick={() => setTool('pen')}
              title="Pen"
            >
              Pen
            </button>
            <button 
              className={`tool-btn ${tool === 'eraser' ? 'tool-btn--active' : ''}`}
              onClick={() => setTool('eraser')}
              title="Eraser"
            >
              Eraser
            </button>
            <button 
              className={`tool-btn ${tool === 'fill' ? 'tool-btn--active' : ''}`}
              onClick={() => setTool('fill')}
              title="Fill (Bucket)"
            >
              Fill
            </button>
          </div>

          <label className="control-group" title="Brush color">
            <div className="color-swatch" style={{ background: color }}>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="color-input"
              />
            </div>
          </label>

          <label className="control-group" title="Brush size">
            <span className="control-label">Size&nbsp;{size}px</span>
            <input
              type="range"
              min={1}
              max={80}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="size-slider"
            />
          </label>

          <div className="color-presets">
            {['#222222', '#ff6584', '#43e97b', '#6c63ff', '#f7971e', '#ffffff'].map((c) => (
              <button
                key={c}
                className={`preset ${color === c ? 'preset--active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="toolbar__actions">
          <span className={`status-pill ${connected ? 'status-pill--on' : 'status-pill--off'}`}>
            <span className="status-dot" />
            {status}
          </span>
          <button className="btn btn--danger" onClick={clearCanvas}>
            Clear
          </button>
        </div>
      </header>

      <div 
        className="canvas-container"
        onMouseLeave={() => setCursorPos(null)}
      >
        <canvas
          ref={canvasRef}
          className="drawing-canvas"
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
        />
        
        {/* Visual Brush Cursor Indicator */}
        {cursorPos && (
          <div 
            className="brush-cursor"
            style={{
              left: cursorPos.x,
              top: cursorPos.y,
              width: size,
              height: size,
              display: tool === 'fill' ? 'none' : 'block' // hide custom cursor when bucket filling
            }}
          />
        )}
      </div>
    </div>
  );
}
