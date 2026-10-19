import { UndirectedGraph } from 'graphology';
import fa2 from 'graphology-layout-forceatlas2';
import fa2Worker from 'graphology-layout-forceatlas2/worker.js';
import { useEffect, useRef } from 'react';
import Sigma from 'sigma';
import type { NodeHoverDrawingFunction } from 'sigma/rendering';
import { GROUPS, type GraphData, type Group } from '../core/graph.ts';

/** Node positions kept across rebuilds and remounts, so the graph doesn't reshuffle on every vault change. */
export type Positions = Map<string, { x: number; y: number }>;
interface NodeAttrs {
  x: number;
  y: number;
  size: number;
  label: string;
  group: Group;
  ghost: boolean;
}

// CommonJS typings read as namespaces under NodeNext; at runtime (esbuild) the default import is the export itself.
const forceAtlas2 = fa2 as unknown as typeof fa2.default;
const FA2Layout = fa2Worker as unknown as typeof fa2Worker.default;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const palette = () => ({
  ...(Object.fromEntries(GROUPS.map((g) => [g, css(`--g-${g.toLowerCase()}`)])) as Record<Group, string>),
  ghost: css('--g-ghost'),
  dim: css('--g-dim'),
  edge: css('--g-edge'),
  edgeOn: css('--g-edge-on'),
  ink: css('--ink'),
  surface: css('--surface'),
});

export function GraphView(props: {
  data: GraphData;
  theme: string;
  active: string | null;
  /** Search matches to keep lit; everything else dims. */
  highlight: Set<string> | null;
  positions: Positions;
  compact?: boolean;
  label: string;
  onOpen(id: string, label: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const sigma = useRef<Sigma<NodeAttrs> | null>(null);
  const graph = useRef(new UndirectedGraph<NodeAttrs>());
  const layout = useRef<{ kill(): void } | null>(null);
  const live = useRef({
    ...props,
    colors: palette(),
    hovered: null as string | null,
    near: new Set<string>(),
  });
  live.current = { ...live.current, ...props };

  // biome-ignore lint/correctness/useExhaustiveDependencies: built once; later props reach it through `live`.
  useEffect(() => {
    const g = graph.current;
    const drawHover: NodeHoverDrawingFunction<NodeAttrs> = (ctx, data, settings) => {
      const { colors } = live.current;
      const size = settings.labelSize;
      ctx.font = `600 ${size}px ${settings.labelFont}`;
      const width = ctx.measureText(data.label ?? '').width;
      ctx.fillStyle = colors.surface;
      ctx.shadowColor = 'rgb(0 0 0 / 0.25)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
      ctx.roundRect(data.x + data.size + 1, data.y - size / 2 - 5, width + 14, size + 10, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = colors.ink;
      ctx.fillText(data.label ?? '', data.x + data.size + 8, data.y + size / 3);
    };
    const s = new Sigma<NodeAttrs>(g, container.current!, {
      allowInvalidContainer: true,
      stagePadding: props.compact ? 56 : 30,
      zIndex: true,
      labelFont: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      labelSize: props.compact ? 11 : 12,
      labelColor: { color: live.current.colors.ink },
      labelRenderedSizeThreshold: props.compact ? 4 : 6,
      labelDensity: props.compact ? 2 : 0.6,
      defaultDrawNodeHover: drawHover,
      minCameraRatio: 0.05,
      maxCameraRatio: 4,
      nodeReducer: (id, attrs) => {
        const { colors, hovered, near, highlight, active } = live.current;
        const out: Record<string, unknown> = {
          ...attrs,
          color: attrs.ghost ? colors.ghost : colors[attrs.group],
        };
        const focus = hovered ? near : highlight;
        if (focus && !focus.has(id)) Object.assign(out, { color: colors.dim, label: '', zIndex: 0 });
        else if (focus) Object.assign(out, { zIndex: 1, forceLabel: hovered !== null || focus.size <= 40 });
        if (id === active) Object.assign(out, { highlighted: true, forceLabel: true, zIndex: 2 });
        return out;
      },
      edgeReducer: (edge, attrs) => {
        const { colors, hovered, highlight } = live.current;
        if (hovered)
          return g.hasExtremity(edge, hovered)
            ? { ...attrs, color: colors.edgeOn, size: 1.5, zIndex: 1 }
            : { ...attrs, hidden: true };
        if (highlight && !g.extremities(edge).every((id) => highlight.has(id)))
          return { ...attrs, color: colors.dim, size: 0.5 };
        return { ...attrs, color: colors.edge, size: props.compact ? 1 : 0.8 };
      },
    });
    s.on('enterNode', ({ node }) => {
      live.current.hovered = node;
      live.current.near = new Set([node, ...g.neighbors(node)]);
      container.current!.style.cursor = 'pointer';
      s.refresh({ skipIndexation: true });
    });
    s.on('leaveNode', () => {
      live.current.hovered = null;
      container.current!.style.cursor = '';
      s.refresh({ skipIndexation: true });
    });
    s.on('clickNode', ({ node }) => live.current.onOpen(node, g.getNodeAttribute(node, 'label')));
    sigma.current = s;
    // Lets the UI check find where a note is drawn.
    Object.assign(container.current!, { sigma: s });
    const resize = new ResizeObserver(() => s.refresh());
    resize.observe(container.current!);
    return () => {
      resize.disconnect();
      layout.current?.kill();
      remember();
      s.kill();
      sigma.current = null;
    };
  }, []);

  const remember = () =>
    graph.current.forEachNode((id, a) => live.current.positions.set(id, { x: a.x, y: a.y }));

  // Sync the drawn graph with the data, keeping positions, and settle the layout when its shape changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: positions and compact are fixed per view.
  useEffect(() => {
    const g = graph.current;
    const { data, positions, compact } = props;
    const ids = new Set(data.nodes.map((n) => n.id));
    let changed = false;
    g.forEachNode((id, a) => {
      if (ids.has(id)) return;
      positions.set(id, { x: a.x, y: a.y });
      g.dropNode(id);
      changed = true;
    });
    const near = new Map<string, string[]>();
    for (const [a, b] of data.edges) {
      near.get(a)?.push(b) ?? near.set(a, [b]);
      near.get(b)?.push(a) ?? near.set(b, [a]);
    }
    const spread = Math.sqrt(data.nodes.length) * 10 + 10;
    for (const n of data.nodes) {
      const attrs = {
        label: n.label,
        group: n.group,
        ghost: n.ghost,
        size: compact ? 3 + Math.sqrt(n.links) * 1.4 : 2.5 + Math.min(Math.sqrt(n.links) * 2, 16),
      };
      if (g.hasNode(n.id)) {
        g.mergeNodeAttributes(n.id, attrs);
        continue;
      }
      // New notes start next to a note they link to, so the layout only has to nudge them.
      const anchor = (near.get(n.id) ?? []).find((id) => g.hasNode(id));
      const base = positions.get(n.id) ?? (anchor ? g.getNodeAttributes(anchor) : { x: 0, y: 0 });
      const jitter = positions.has(n.id) ? 0 : anchor ? 4 : spread;
      g.addNode(n.id, {
        ...attrs,
        x: base.x + (Math.random() - 0.5) * jitter,
        y: base.y + (Math.random() - 0.5) * jitter,
      });
      changed ||= !positions.has(n.id);
    }
    const keys = new Set(data.edges.map(([a, b]) => `${a}\n${b}`));
    g.forEachEdge((edge) => {
      if (keys.has(edge)) return;
      g.dropEdge(edge);
      changed = true;
    });
    for (const [a, b] of data.edges)
      if (!g.hasEdge(`${a}\n${b}`)) {
        g.addEdgeWithKey(`${a}\n${b}`, a, b);
        changed = true;
      }
    if (!changed || g.order < 2) return;

    const settings = {
      ...forceAtlas2.inferSettings(g),
      barnesHutOptimize: g.order > 300,
      // Strong gravity keeps orphans and small islands near the rest instead of drifting off-screen.
      strongGravityMode: true,
      gravity: compact ? 1 : 0.4,
      slowDown: compact ? 2 : 4,
    };
    layout.current?.kill();
    if (compact) {
      // Local graphs are small: settle them in one go, no worker.
      forceAtlas2.assign(g, { iterations: 120, settings });
      remember();
      return;
    }
    const worker = new FA2Layout(g, { settings });
    worker.start();
    const first = positions.size === 0;
    const timer = setTimeout(
      () => {
        worker.stop();
        remember();
      },
      first ? Math.min(1500 + g.order * 2, 6000) : 1500,
    );
    layout.current = {
      kill: () => {
        clearTimeout(timer);
        worker.kill();
      },
    };
  }, [props.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: theme is the trigger; the colours come from CSS.
  useEffect(() => {
    live.current.colors = palette();
    sigma.current?.setSetting('labelColor', { color: live.current.colors.ink });
  }, [props.theme]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reducers read these through `live`; this redraws.
  useEffect(() => {
    sigma.current?.refresh({ skipIndexation: true });
  }, [props.active, props.highlight, props.theme]);

  return <div className="n-graph-canvas" ref={container} role="img" aria-label={props.label} />;
}
