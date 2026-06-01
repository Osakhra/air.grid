'use client';

import { useEffect, useRef } from 'react';

type Node = { x: number; y: number };
type Edge = { a: number; b: number; length: number };
type Packet = {
  edgeIdx: number;
  t: number;
  speed: number;
  direction: 1 | -1;
  color: 'teal' | 'purple';
  alive: boolean;
};

/** Convert a hex color string (#RRGGBB) to an "r, g, b" string for rgba() usage. */
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '30, 158, 138';
}

export default function NetworkGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── prefers-reduced-motion: draw static grid once, skip animation loop ──
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let nodes: Node[] = [];
    let edges: Edge[] = [];
    const packets: Packet[] = [];
    let width = 0;
    let height = 0;
    let lastPacketSpawn = 0;
    let lastFrameTime = 0;
    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;

    // ── Theme-aware color reads ──────────────────────────────────────────────
    const getThemeColors = () => {
      const style = getComputedStyle(document.documentElement);
      return {
        teal:   style.getPropertyValue('--accent-teal').trim() || '#1E9E8A',
        purple: style.getPropertyValue('--accent-purple-bright').trim() || '#9B6FD4',
      };
    };

    let colors = getThemeColors();
    let tealRgb   = hexToRgb(colors.teal);
    let purpleRgb = hexToRgb(colors.purple);

    // Re-read colors whenever the theme attribute changes on <html>
    const themeObserver = new MutationObserver(() => {
      colors    = getThemeColors();
      tealRgb   = hexToRgb(colors.teal);
      purpleRgb = hexToRgb(colors.purple);
      // In reduced-motion mode, redraw the static grid with new colors
      if (prefersReducedMotion) drawStatic();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // ── Canvas sizing ────────────────────────────────────────────────────────
    const setSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // ── Grid construction ────────────────────────────────────────────────────
    const buildGrid = () => {
      const spacing = 110;
      const rowHeight = spacing * 0.866;
      const cols = Math.ceil(width / spacing) + 2;
      const rows = Math.ceil(height / rowHeight) + 2;
      nodes = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const offset = r % 2 === 0 ? 0 : spacing / 2;
          const jitterX = (Math.random() - 0.5) * spacing * 0.25;
          const jitterY = (Math.random() - 0.5) * spacing * 0.25;
          nodes.push({
            x: c * spacing + offset + jitterX - spacing,
            y: r * rowHeight + jitterY - spacing,
          });
        }
      }

      edges = [];
      const maxDist = spacing * 1.4;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            edges.push({ a: i, b: j, length: dist });
          }
        }
      }
    };

    // ── Static draw (reduced-motion or paused) ───────────────────────────────
    const drawStatic = () => {
      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = `rgba(${tealRgb}, 0.12)`;
      ctx.lineWidth = 0.6;
      for (const edge of edges) {
        const na = nodes[edge.a];
        const nb = nodes[edge.b];
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();
      }

      ctx.fillStyle = `rgba(${tealRgb}, 0.32)`;
      for (const node of nodes) {
        if (node.x < -10 || node.x > width + 10 || node.y < -10 || node.y > height + 10) continue;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    // ── Packet spawning ──────────────────────────────────────────────────────
    const spawnPacket = () => {
      if (edges.length === 0) return;
      if (packets.filter((p) => p.alive).length >= 4) return;

      let tries = 0;
      while (tries < 12) {
        const edgeIdx = Math.floor(Math.random() * edges.length);
        const e = edges[edgeIdx];
        const na = nodes[e.a];
        const nb = nodes[e.b];
        const onScreen =
          (na.x > -50 && na.x < width + 50 && na.y > -50 && na.y < height + 50) ||
          (nb.x > -50 && nb.x < width + 50 && nb.y > -50 && nb.y < height + 50);
        if (onScreen) {
          packets.push({
            edgeIdx,
            t: 0,
            speed: 0.003 + Math.random() * 0.004,
            direction: Math.random() > 0.5 ? 1 : -1,
            color: Math.random() > 0.7 ? 'purple' : 'teal',
            alive: true,
          });
          return;
        }
        tries++;
      }
    };

    // ── Render loop ──────────────────────────────────────────────────────────
    const render = (now: number) => {
      // Page Visibility API: skip frame if tab is hidden
      if (document.hidden) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }

      // Cap to TARGET_FPS via timestamp check
      const elapsed = now - lastFrameTime;
      if (elapsed < FRAME_INTERVAL) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      lastFrameTime = now - (elapsed % FRAME_INTERVAL);

      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = `rgba(${tealRgb}, 0.12)`;
      ctx.lineWidth = 0.6;
      for (const edge of edges) {
        const na = nodes[edge.a];
        const nb = nodes[edge.b];
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();
      }

      ctx.fillStyle = `rgba(${tealRgb}, 0.32)`;
      for (const node of nodes) {
        if (node.x < -10 || node.x > width + 10 || node.y < -10 || node.y > height + 10) continue;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }

      if (now - lastPacketSpawn > 1800) {
        spawnPacket();
        lastPacketSpawn = now;
      }

      for (const p of packets) {
        if (!p.alive) continue;
        p.t += p.speed * p.direction;
        if (p.t >= 1 || p.t <= 0) {
          p.alive = false;
          continue;
        }

        const edge = edges[p.edgeIdx];
        const na = nodes[edge.a];
        const nb = nodes[edge.b];
        const x = na.x + (nb.x - na.x) * p.t;
        const y = na.y + (nb.y - na.y) * p.t;

        const fade = Math.sin(p.t * Math.PI);
        const packetRgb = p.color === 'teal' ? tealRgb : purpleRgb;

        ctx.strokeStyle = `rgba(${packetRgb}, ${0.25 * fade})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();

        const trailLength = 0.08;
        const trailT = Math.max(0, p.t - trailLength * p.direction);
        const tx = na.x + (nb.x - na.x) * trailT;
        const ty = na.y + (nb.y - na.y) * trailT;
        const gradient = ctx.createLinearGradient(tx, ty, x, y);
        gradient.addColorStop(0, `rgba(${packetRgb}, 0)`);
        gradient.addColorStop(1, `rgba(${packetRgb}, ${0.7 * fade})`);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();

        ctx.shadowBlur = 8;
        ctx.shadowColor = `rgba(${packetRgb}, ${0.8 * fade})`;
        ctx.fillStyle   = `rgba(${packetRgb}, ${0.95 * fade})`;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      for (let i = packets.length - 1; i >= 0; i--) {
        if (!packets[i].alive) packets.splice(i, 1);
      }

      animationRef.current = requestAnimationFrame(render);
    };

    const handleResize = () => {
      setSize();
      buildGrid();
      packets.length = 0;
      if (prefersReducedMotion) drawStatic();
    };

    setSize();
    buildGrid();

    if (prefersReducedMotion) {
      // Draw once and done — no rAF loop
      drawStatic();
    } else {
      animationRef.current = requestAnimationFrame(render);
    }

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      style={{ opacity: 1 }}
      aria-hidden="true"
    />
  );
}
