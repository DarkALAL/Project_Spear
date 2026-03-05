import React, { useEffect, useRef } from 'react';

type FileInput =
  | string
  | {
      path: string;
      content?: string;
    };

interface DependencyGraphProps {
  files: FileInput[]; // either string paths or {path, content}
}

interface Node {
  id: string;       // full path
  label: string;    // display label (basename)
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
}

interface Link {
  source: string; // id
  target: string; // id
}

const DEVICE_PIXEL_RATIO = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

const DependencyGraph: React.FC<DependencyGraphProps> = ({ files }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // keep simulation data in refs to avoid rerenders
  const nodesRef = useRef<Node[]>([]);
  const linksRef = useRef<Link[]>([]);
  const nodeIndexRef = useRef<Map<string, number>>(new Map());
  
  // Mouse interaction state
  const draggedNodeRef = useRef<Node | null>(null);
  const hoveredNodeRef = useRef<Node | null>(null);
  const mouseXRef = useRef<number>(0);
  const mouseYRef = useRef<number>(0);

  // Utility helpers
  const basename = (p: string) => {
    const parts = p.split('/');
    return parts[parts.length - 1];
  };
  const removeExt = (p: string) => {
    const b = basename(p);
    const idx = b.lastIndexOf('.');
    return idx === -1 ? b : b.slice(0, idx);
  };

  // Parse dependencies from content -> list of target path strings (must match provided files)
  function parseDependenciesForFile(filePath: string, content: string | undefined, allPaths: string[]) {
    if (!content) return [];
    const targets = new Set<string>();

    // Prepare lookup by basename, basename without ext, and full path
    const byBasename = new Map<string, string[]>();
    const byNameNoExt = new Map<string, string[]>();
    for (const p of allPaths) {
      const b = basename(p);
      const noext = removeExt(p);
      if (!byBasename.has(b)) byBasename.set(b, []);
      byBasename.get(b)!.push(p);
      if (!byNameNoExt.has(noext)) byNameNoExt.set(noext, []);
      byNameNoExt.get(noext)!.push(p);
    }

    // 1) C includes: #include "file.h" (we only resolve quoted includes)
    const includeRegex = /#include\s+"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = includeRegex.exec(content)) !== null) {
      const inc = m[1]; // e.g. "myheader.h"
      // try full basename match first
      const cand = byBasename.get(inc);
      if (cand) cand.forEach(p => targets.add(p));
      // also try by name without ext
      const noExt = inc.replace(/\.[^.]+$/, '');
      const cand2 = byNameNoExt.get(noExt);
      if (cand2) cand2.forEach(p => targets.add(p));
    }

    // 2) Python: import X, import X as Y, from X import Y, from X.Y import Z
    // We'll map module X to files whose no-ext basename equals last path component of X
    // allow relative imports like from .module import x
    const pyImportRegex = /^\s*(?:from|import)\s+([A-Za-z0-9_\.]+(?:\.[A-Za-z0-9_\.]+)*)/gm;
    while ((m = pyImportRegex.exec(content)) !== null) {
      let mod = m[1]; // could be "pkg.module" or "module"
      // ignore absolute stdlib names that don't map to file set automatically,
      // but still attempt to resolve to a matching file name
      const parts = mod.split('.');
      const candidateName = parts[parts.length - 1];
      const matched = byNameNoExt.get(candidateName);
      if (matched) matched.forEach(p => targets.add(p));
    }

    // 3) JS/TS: import ... from 'module' or require('module')
    const importFromRegex = /(?:import\s+(?:[^'"]+\s+from\s+)?|require\()\s*['"]([^'"]+)['"]/g;
    while ((m = importFromRegex.exec(content)) !== null) {
      let mod = m[1];
      // ignore absolute packages (no slash and no relative dot)
      if (!mod) continue;
      // If relative or has path parts, take last segment (module name)
      const parts = mod.split('/');
      const candidateName = parts[parts.length - 1].replace(/\.(js|ts|jsx|tsx)$/, '');
      const matched = byNameNoExt.get(candidateName);
      if (matched) matched.forEach(p => targets.add(p));
      // also check full basename match
      const base = parts[parts.length - 1];
      const cand2 = byBasename.get(base);
      if (cand2) cand2.forEach(p => targets.add(p));
    }

    // remove self-targeting
    if (targets.has(filePath)) targets.delete(filePath);

    return Array.from(targets);
  }

  useEffect(() => {
    // Build initial nodes and links whenever the `files` prop changes
    // Normalize files into {path, content?} objects
    const normalized: { path: string; content?: string }[] = files.map(f =>
      typeof f === 'string' ? { path: f } : { path: f.path, content: f.content }
    );

    const allPaths = normalized.map(f => f.path);

    // Create nodes
    const nodes: Node[] = normalized.map((f) => ({
      id: f.path,
      label: basename(f.path),
      x: Math.random() * 600 + 100,
      y: Math.random() * 400 + 50,
      vx: 0,
      vy: 0,
      mass: 1,
    }));

    // Build fast id->index map
    const idxMap = new Map<string, number>();
    nodes.forEach((n, i) => idxMap.set(n.id, i));
    nodeIndexRef.current = idxMap;

    // Build links by parsing content; only create link when a parsed dependency resolves to an existing file
    const links: Link[] = [];
    for (const f of normalized) {
      if (!f.content) continue; // can't infer deps without content
      const deps = parseDependenciesForFile(f.path, f.content, allPaths);
      deps.forEach(depPath => {
        // ensure both source and target exist in our nodes set
        if (idxMap.has(f.path) && idxMap.has(depPath)) {
          // Add one directional link f -> depPath (you can choose to make it bidirectional if you prefer)
          links.push({ source: f.path, target: depPath });
        }
      });
    }

    // Deduplicate links
    const seen = new Set<string>();
    const dedupedLinks = links.filter(l => {
      const key = `${l.source}||${l.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // store in refs
    nodesRef.current = nodes;
    linksRef.current = dedupedLinks;
  }, [files]);

  // Simulation and drawing effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // set DPR-aware size
    function resizeCanvasToDisplaySize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const pxWidth = Math.floor(w * DEVICE_PIXEL_RATIO);
      const pxHeight = Math.floor(h * DEVICE_PIXEL_RATIO);
      if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
        canvas.width = pxWidth;
        canvas.height = pxHeight;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx?.setTransform(DEVICE_PIXEL_RATIO, 0, 0, DEVICE_PIXEL_RATIO, 0, 0);
      }
    }

    // simulation parameters (tweak as needed)
    const REPULSION = 90000; // larger => nodes push away more
    const SPRING_LENGTH = 100; // desired length of links
    const SPRING_STRENGTH = 0.02; // attraction multiplier
    const DAMPING = 0.85; // velocity damping
    const MAX_DISPLACEMENT = 30; // limit per tick to keep stable

    let lastTime = performance.now();

    function step(t: number) {
      if (!canvas || !ctx) return;
      resizeCanvasToDisplaySize();
      const nodes = nodesRef.current;
      const links = linksRef.current;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      // small timestep
      const dt = Math.min(0.03, (t - lastTime) / 1000); // seconds
      lastTime = t;

      // Build position lookup for faster link access
      const posById = new Map<string, Node>();
      nodes.forEach(n => posById.set(n.id, n));

      // Repulsive forces (O(n^2) for small graphs; ok for tens/hundreds)
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        let fx = 0;
        let fy = 0;
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const o = nodes[j];
          let dx = n.x - o.x;
          let dy = n.y - o.y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 === 0) {
            dx = (Math.random() - 0.5) * 1e-3;
            dy = (Math.random() - 0.5) * 1e-3;
            dist2 = dx * dx + dy * dy;
          }
          const dist = Math.sqrt(dist2);
          const force = (REPULSION * n.mass * o.mass) / (dist2 + 0.01);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
        // accumulate repulsive forces into velocities
        n.vx += (fx * dt) / n.mass;
        n.vy += (fy * dt) / n.mass;
      }

      // Attractive spring forces along links
      for (let k = 0; k < links.length; k++) {
        const link = links[k];
        const a = posById.get(link.source);
        const b = posById.get(link.target);
        if (!a || !b) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy) || 1;
        const diff = dist - SPRING_LENGTH;
        const force = SPRING_STRENGTH * diff;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        // apply equal and opposite to both nodes (symmetrical)
        a.vx += (fx * dt) / a.mass;
        a.vy += (fy * dt) / a.mass;
        b.vx -= (fx * dt) / b.mass;
        b.vy -= (fy * dt) / b.mass;
      }

      // Integrate velocities -> positions, apply damping and clamp
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];

        // Apply damping
        n.vx *= DAMPING;
        n.vy *= DAMPING;

        // limit displacement to avoid explosions
        n.vx = Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, n.vx));
        n.vy = Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, n.vy));

        n.x += n.vx;
        n.y += n.vy;

        // Keep inside canvas bounds with margins
        const margin = 24;
        n.x = Math.max(margin, Math.min(width - margin, n.x));
        n.y = Math.max(margin, Math.min(height - margin, n.y));
      }

      // Draw background
      ctx.fillStyle = '#0f1113';
      ctx.fillRect(0, 0, canvas.width / DEVICE_PIXEL_RATIO, canvas.height / DEVICE_PIXEL_RATIO);

      // Draw links (lighter)
      ctx.strokeStyle = 'rgba(100,150,200,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < links.length; k++) {
        const link = links[k];
        const a = posById.get(link.source);
        const b = posById.get(link.target);
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      // Draw nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const isC = n.id.endsWith('.c') || n.id.endsWith('.h');
        const isPy = n.id.endsWith('.py');
        const fill = isC ? '#6a8fd4' : isPy ? '#f7c14f' : '#8b8f93';
        
        const isHovered = hoveredNodeRef.current === n;
        const isDragged = draggedNodeRef.current === n;
        const radius = isDragged ? 16 : isHovered ? 14 : 12;

        // circle
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.fill();

        // highlight outline for hovered/dragged nodes
        if (isHovered || isDragged) {
          ctx.strokeStyle = isDragged ? '#ffffff' : 'rgba(255,255,255,0.5)';
          ctx.lineWidth = isDragged ? 3 : 2;
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius + 2, 0, Math.PI * 2);
          ctx.stroke();
        }

        // label (draw below the node to reduce overlap)
        ctx.fillStyle = '#d4d4d4';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(n.label, n.x, n.y + 16);
      }

      // continue loop
      rafRef.current = requestAnimationFrame(step);
    }

    // start
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    lastTime = performance.now();
    rafRef.current = requestAnimationFrame(step);

    // Mouse event handlers
    const getMousePos = (e: MouseEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    };

    const getNodeAtPoint = (x: number, y: number): Node | null => {
      const nodes = nodesRef.current;
      const hitRadius = 16; // slightly larger than visual radius for easier clicking
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const dx = n.x - x;
        const dy = n.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= hitRadius) return n;
      }
      return null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const pos = getMousePos(e);
      mouseXRef.current = pos.x;
      mouseYRef.current = pos.y;

      const node = getNodeAtPoint(pos.x, pos.y);
      hoveredNodeRef.current = node;

      if (draggedNodeRef.current) {
        draggedNodeRef.current.x = pos.x;
        draggedNodeRef.current.y = pos.y;
        // when dragging, stop velocity
        draggedNodeRef.current.vx = 0;
        draggedNodeRef.current.vy = 0;
      }

      canvas.style.cursor = node ? 'grab' : 'default';
    };

    const handleMouseDown = (e: MouseEvent) => {
      const pos = getMousePos(e);
      const node = getNodeAtPoint(pos.x, pos.y);
      if (node) {
        draggedNodeRef.current = node;
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseUp = () => {
      draggedNodeRef.current = null;
      canvas.style.cursor = hoveredNodeRef.current ? 'grab' : 'default';
    };

    const handleMouseLeave = () => {
      draggedNodeRef.current = null;
      hoveredNodeRef.current = null;
      canvas.style.cursor = 'default';
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // resize on window change
    const handleResize = () => {
      // ensure canvas size update on next tick
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', handleResize);
    };
  }, [canvasRef]); // only once (graph data lives in refs updated by other useEffect)

  return (
    <div className="dependency-graph-container" style={{ width: '100%', height: '100%' }}>
      <div className="graph-header">
        <h3>File Dependencies</h3>
        <p className="graph-legend" aria-hidden>
          <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#6a8fd4' }}></span> .c/.h</span>
          <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#f7c14f' }}></span> .py</span>
          <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#8b8f93' }}></span> Other</span>
        </p>
      </div>
      <canvas ref={canvasRef} className="graph-canvas" style={{ width: '100%', height: 'calc(100% - 56px)', display: 'block' }} />
    </div>
  );
};

export default DependencyGraph;
