// client/src/components/DependencyGraph.tsx
import React, { useEffect, useRef, useCallback } from 'react';

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

interface FileInput {
  path: string;
  content?: string;
}

interface Node {
  id: string;       // full relative path — unique key
  label: string;    // basename displayed on canvas
  x: number;
  y: number;
  vx: number;       // velocity x
  vy: number;       // velocity y
  mass: number;     // heavier nodes repel more
  pinned: boolean;  // true while user is dragging
}

interface Link {
  source: string;   // Node id
  target: string;   // Node id
}

interface DependencyGraphProps {
  files: FileInput[];
}

// ─────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────

const DEVICE_PIXEL_RATIO =
  typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

// Physics tuning
const REPULSION       = 8000;   // node-to-node repulsion strength
const SPRING_LENGTH   = 120;    // desired link length in px
const SPRING_STRENGTH = 0.04;   // link attraction multiplier
const DAMPING         = 0.82;   // velocity damping per tick (0–1)
const MAX_VELOCITY    = 25;     // clamp velocity to prevent explosions
const CENTER_GRAVITY  = 0.015;  // gentle pull toward canvas center

// Visual
const NODE_RADIUS         = 10;
const NODE_RADIUS_HOVER   = 13;
const NODE_RADIUS_DRAGGED = 15;
const LABEL_OFFSET        = 18; // px below node center
const HIT_RADIUS          = 18; // larger than visual for easier clicking

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i === -1 ? '' : b.slice(i).toLowerCase();
}

function nameWithoutExt(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i === -1 ? b : b.slice(0, i);
}

/**
 * getNodeColor()
 * Color-codes nodes by file type so the graph is scannable at a glance.
 */
function getNodeColor(id: string): string {
  const ext = extname(id);
  switch (ext) {
    case '.c':   return '#6a8fd4'; // blue  — C source
    case '.h':   return '#4ec9b0'; // teal  — C header
    case '.py':  return '#f7c14f'; // amber — Python
    default:     return '#8b8f93'; // grey  — other
  }
}

/**
 * parseDependencies()
 *
 * Parses a file's content and returns the IDs (paths) of other
 * files in the project that it depends on.
 *
 * Handles:
 *   C:      #include "file.h"
 *   Python: import module / from module import x
 *   JS/TS:  import ... from './module' / require('./module')
 */
function parseDependencies(
  filePath: string,
  content: string,
  allPaths: string[]
): string[] {
  const targets = new Set<string>();

  // Build lookup maps: basename → paths[], nameNoExt → paths[]
  const byBasename  = new Map<string, string[]>();
  const byNameNoExt = new Map<string, string[]>();

  for (const p of allPaths) {
    const b    = basename(p);
    const noex = nameWithoutExt(p);

    if (!byBasename.has(b))   byBasename.set(b, []);
    if (!byNameNoExt.has(noex)) byNameNoExt.set(noex, []);

    byBasename.get(b)!.push(p);
    byNameNoExt.get(noex)!.push(p);
  }

  const resolve = (name: string) => {
    // Try exact basename match first
    const exact = byBasename.get(name);
    if (exact) exact.forEach((p) => targets.add(p));

    // Then try name without extension
    const noext = name.replace(/\.[^.]+$/, '');
    const noextMatch = byNameNoExt.get(noext);
    if (noextMatch) noextMatch.forEach((p) => targets.add(p));
  };

  // 1. C: #include "header.h"  (quoted only — ignore <system> headers)
  const cInclude = /#include\s+"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = cInclude.exec(content)) !== null) {
    resolve(m[1]);
    // Also try just the filename part in case path is prefixed
    resolve(basename(m[1]));
  }

  // 2. Python: import X  /  from X import Y  /  from X.Y import Z
  const pyImport = /^\s*(?:from|import)\s+([\w.]+)/gm;
  while ((m = pyImport.exec(content)) !== null) {
    const parts = m[1].split('.');
    // Try the last component (most specific) and the first (package name)
    resolve(parts[parts.length - 1]);
    if (parts.length > 1) resolve(parts[0]);
  }

  // 3. JS/TS: import ... from './x'  /  require('./x')
  const jsImport =
    /(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
  while ((m = jsImport.exec(content)) !== null) {
    const parts = m[1].split('/');
    const last  = parts[parts.length - 1].replace(/\.(js|ts|jsx|tsx)$/, '');
    resolve(last);
    resolve(parts[parts.length - 1]); // also try with extension
  }

  // Remove self-reference
  targets.delete(filePath);

  return Array.from(targets);
}

// ─────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────

const DependencyGraph: React.FC<DependencyGraphProps> = ({ files }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef    = useRef<number | null>(null);

  // Simulation data lives in refs — mutated directly each frame
  // to avoid triggering React re-renders on every tick
  const nodesRef   = useRef<Node[]>([]);
  const linksRef   = useRef<Link[]>([]);
  const nodeMapRef = useRef<Map<string, Node>>(new Map());

  // Mouse interaction
  const draggedRef = useRef<Node | null>(null);
  const hoveredRef = useRef<Node | null>(null);

  // ── Build graph data whenever files prop changes ──
  useEffect(() => {
    const allPaths = files.map((f) => f.path);
    const canvas   = canvasRef.current;
    const cw       = canvas ? canvas.clientWidth  || 800 : 800;
    const ch       = canvas ? canvas.clientHeight || 500 : 500;

    // Create nodes — scatter randomly inside the canvas
    const nodes: Node[] = files.map((f) => ({
      id:     f.path,
      label:  basename(f.path),
      x:      Math.random() * (cw * 0.7) + cw * 0.15,
      y:      Math.random() * (ch * 0.7) + ch * 0.15,
      vx:     0,
      vy:     0,
      mass:   1,
      pinned: false,
    }));

    // Build fast id → node map
    const nodeMap = new Map<string, Node>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    // Build links from dependency parsing
    const links: Link[] = [];
    for (const f of files) {
      if (!f.content) continue;
      const deps = parseDependencies(f.path, f.content, allPaths);
      for (const dep of deps) {
        if (nodeMap.has(f.path) && nodeMap.has(dep)) {
          links.push({ source: f.path, target: dep });
        }
      }
    }

    // Deduplicate links (A→B and B→A count as one visual edge)
    const seen = new Set<string>();
    const dedupedLinks = links.filter((l) => {
      const key = [l.source, l.target].sort().join('||');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    nodesRef.current   = nodes;
    linksRef.current   = dedupedLinks;
    nodeMapRef.current = nodeMap;
  }, [files]);

  // ── Hit test ──
  const getNodeAt = useCallback((cx: number, cy: number): Node | null => {
    const nodes = nodesRef.current;
    // Iterate in reverse so topmost-drawn node wins
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n  = nodes[i];
      const dx = n.x - cx;
      const dy = n.y - cy;
      if (Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS) return n;
    }
    return null;
  }, []);

  // ── Canvas coordinate conversion ──
  const toCanvasCoords = useCallback(
    (e: MouseEvent): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect   = canvas.getBoundingClientRect();
      // Scale from CSS pixels → canvas logical pixels
      return {
        x: (e.clientX - rect.left)  * (canvas.width  / rect.width  / DEVICE_PIXEL_RATIO),
        y: (e.clientY - rect.top)   * (canvas.height / rect.height / DEVICE_PIXEL_RATIO),
      };
    },
    []
  );

  // ── Simulation + rendering loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── Resize canvas to actual pixel dimensions ──
    function syncCanvasSize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w    = Math.max(1, Math.floor(rect.width));
      const h    = Math.max(1, Math.floor(rect.height));
      const pw   = Math.floor(w * DEVICE_PIXEL_RATIO);
      const ph   = Math.floor(h * DEVICE_PIXEL_RATIO);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width        = pw;
        canvas.height       = ph;
        canvas.style.width  = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx?.setTransform(DEVICE_PIXEL_RATIO, 0, 0, DEVICE_PIXEL_RATIO, 0, 0);
      }
    }

    let lastTime = performance.now();

    function tick(now: number) {
      if (!canvas || !ctx) return;

      syncCanvasSize();

      const nodes   = nodesRef.current;
      const links   = linksRef.current;
      const nodeMap = nodeMapRef.current;
      const W       = canvas.clientWidth;
      const H       = canvas.clientHeight;
      const cx      = W / 2;
      const cy      = H / 2;

      const dt = Math.min(0.032, (now - lastTime) / 1000);
      lastTime = now;

      // ── Physics: repulsion (O(n²) — fine for < 200 nodes) ──
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].pinned) continue;
        let fx = 0;
        let fy = 0;

        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          let dx   = nodes[i].x - nodes[j].x;
          let dy   = nodes[i].y - nodes[j].y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 0.001;

          // Jitter overlapping nodes
          if (dist < 0.5) {
            dx   = (Math.random() - 0.5) * 0.5;
            dy   = (Math.random() - 0.5) * 0.5;
            dist = 0.5;
          }

          const force = (REPULSION * nodes[i].mass * nodes[j].mass) / (dist * dist);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }

        // ── Center gravity — prevents nodes drifting off-screen ──
        fx += (cx - nodes[i].x) * CENTER_GRAVITY * nodes[i].mass;
        fy += (cy - nodes[i].y) * CENTER_GRAVITY * nodes[i].mass;

        nodes[i].vx += (fx * dt) / nodes[i].mass;
        nodes[i].vy += (fy * dt) / nodes[i].mass;
      }

      // ── Physics: spring attraction along links ──
      for (const link of links) {
        const a = nodeMap.get(link.source);
        const b = nodeMap.get(link.target);
        if (!a || !b) continue;

        const dx   = b.x - a.x;
        const dy   = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const diff  = dist - SPRING_LENGTH;
        const force = SPRING_STRENGTH * diff;
        const fx    = (dx / dist) * force;
        const fy    = (dy / dist) * force;

        if (!a.pinned) {
          a.vx += (fx * dt) / a.mass;
          a.vy += (fy * dt) / a.mass;
        }
        if (!b.pinned) {
          b.vx -= (fx * dt) / b.mass;
          b.vy -= (fy * dt) / b.mass;
        }
      }

      // ── Integrate positions ──
      const margin = NODE_RADIUS + 24;
      for (const n of nodes) {
        if (n.pinned) continue;

        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.vx  = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, n.vx));
        n.vy  = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, n.vy));

        n.x += n.vx;
        n.y += n.vy;

        // Bounce off canvas edges
        n.x = Math.max(margin, Math.min(W - margin, n.x));
        n.y = Math.max(margin, Math.min(H - margin, n.y));
      }

      // ── Draw: background ──
      ctx.fillStyle = '#0f1113';
      ctx.fillRect(0, 0, W, H);

      // ── Draw: links ──
      for (const link of links) {
        const a = nodeMap.get(link.source);
        const b = nodeMap.get(link.target);
        if (!a || !b) continue;

        // Draw arrowhead to show direction
        const dx     = b.x - a.x;
        const dy     = b.y - a.y;
        const dist   = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux     = dx / dist;
        const uy     = dy / dist;
        // Stop the line at the edge of the target node
        const endX   = b.x - ux * (NODE_RADIUS + 4);
        const endY   = b.y - uy * (NODE_RADIUS + 4);
        const startX = a.x + ux * (NODE_RADIUS + 4);
        const startY = a.y + uy * (NODE_RADIUS + 4);

        // Line
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = 'rgba(100, 150, 200, 0.22)';
        ctx.lineWidth   = 1.2;
        ctx.stroke();

        // Arrowhead
        const arrowLen   = 8;
        const arrowAngle = Math.PI / 6;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - arrowLen * Math.cos(Math.atan2(dy, dx) - arrowAngle),
          endY - arrowLen * Math.sin(Math.atan2(dy, dx) - arrowAngle)
        );
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - arrowLen * Math.cos(Math.atan2(dy, dx) + arrowAngle),
          endY - arrowLen * Math.sin(Math.atan2(dy, dx) + arrowAngle)
        );
        ctx.strokeStyle = 'rgba(100, 150, 200, 0.35)';
        ctx.lineWidth   = 1.2;
        ctx.stroke();
      }

      // ── Draw: nodes ──
      for (const n of nodes) {
        const isDragged = draggedRef.current === n;
        const isHovered = hoveredRef.current === n;
        const radius    = isDragged
          ? NODE_RADIUS_DRAGGED
          : isHovered
          ? NODE_RADIUS_HOVER
          : NODE_RADIUS;
        const color     = getNodeColor(n.id);

        // Glow for hovered/dragged nodes
        if (isHovered || isDragged) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius + 6, 0, Math.PI * 2);
          const glow = ctx.createRadialGradient(n.x, n.y, radius, n.x, n.y, radius + 6);
          glow.addColorStop(0, color + '55');
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // White outline for hovered/dragged
        if (isHovered || isDragged) {
          ctx.strokeStyle = isDragged
            ? 'rgba(255,255,255,0.9)'
            : 'rgba(255,255,255,0.5)';
          ctx.lineWidth = isDragged ? 2.5 : 1.5;
          ctx.stroke();
        }

        // Label below the node
        ctx.fillStyle    = isHovered || isDragged ? '#ffffff' : '#c0cdd8';
        ctx.font         = `${isHovered ? 12 : 11}px 'Consolas', monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(n.label, n.x, n.y + LABEL_OFFSET);
      }

      // ── Draw: node count ──
      ctx.fillStyle    = '#3a4550';
      ctx.font         = '11px sans-serif';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        `${nodesRef.current.length} nodes · ${linksRef.current.length} edges`,
        10,
        H - 8
      );

      rafRef.current = requestAnimationFrame(tick);
    }

    // ── Start loop ──
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    lastTime       = performance.now();
    rafRef.current = requestAnimationFrame(tick);

    // ── Mouse handlers ──
    const onMouseMove = (e: MouseEvent) => {
      const pos  = toCanvasCoords(e);
      const node = getNodeAt(pos.x, pos.y);
      hoveredRef.current = node;

      if (draggedRef.current) {
        draggedRef.current.x  = pos.x;
        draggedRef.current.y  = pos.y;
        draggedRef.current.vx = 0;
        draggedRef.current.vy = 0;
      }

      canvas.style.cursor = node ? 'grab' : 'default';
    };

    const onMouseDown = (e: MouseEvent) => {
      const pos  = toCanvasCoords(e);
      const node = getNodeAt(pos.x, pos.y);
      if (node) {
        node.pinned         = true;
        draggedRef.current  = node;
        canvas.style.cursor = 'grabbing';
      }
    };

    const onMouseUp = () => {
      if (draggedRef.current) {
        draggedRef.current.pinned = false;
        draggedRef.current        = null;
      }
      canvas.style.cursor = hoveredRef.current ? 'grab' : 'default';
    };

    const onMouseLeave = () => {
      if (draggedRef.current) {
        draggedRef.current.pinned = false;
        draggedRef.current        = null;
      }
      hoveredRef.current  = null;
      canvas.style.cursor = 'default';
    };

    const onResize = () => syncCanvasSize();

    canvas.addEventListener('mousemove',  onMouseMove);
    canvas.addEventListener('mousedown',  onMouseDown);
    canvas.addEventListener('mouseup',    onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('resize',     onResize);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousemove',  onMouseMove);
      canvas.removeEventListener('mousedown',  onMouseDown);
      canvas.removeEventListener('mouseup',    onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('resize',     onResize);
    };
  }, [getNodeAt, toCanvasCoords]);

  // ─────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────

  return (
    <div className="dependency-graph-container">

      {/* Header + legend */}
      <div className="graph-header">
        <h3>File Dependencies</h3>
        <div className="graph-legend">
          <span className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: '#6a8fd4' }} />
            .c source
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: '#4ec9b0' }} />
            .h header
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: '#f7c14f' }} />
            .py
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: '#8b8f93' }} />
            other
          </span>
          <span className="legend-item" style={{ marginLeft: 'auto', fontSize: '11px', color: '#3a4550' }}>
            Drag nodes to rearrange
          </span>
        </div>
      </div>

      {/* Canvas */}
      {files.length === 0 ? (
        <div className="graph-empty">
          Upload and analyze a project to see the dependency graph.
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          className="graph-canvas"
        />
      )}

    </div>
  );
};

export default DependencyGraph;