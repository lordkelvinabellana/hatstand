import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  type Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import type { Color } from '../../core/profiles.ts';
import { drawAgent, lookFor } from '../../core/agents.ts';
import type { Mood } from '../../core/sprites.ts';
import type { SessionView } from '../../shared.ts';

/**
 * The Office as one building seen from above: a room per profile (its colour on the back wall and on its
 * people's shirts), a Codex HQ across the top, flat pixel people standing in a lit 3D set. Drag to move, scroll
 * to zoom, double-click a room (or its name) to fly in. Nothing shakes or flickers.
 */
export interface WorldZone {
  id: string;
  name: string;
  color: Color;
  running: boolean;
  sessions: SessionView[];
}
interface Handlers {
  open(profile: string, host?: string): void;
  launch(profile: string): void;
}

const rug: Record<Color, string> = {
  teal: '#2f8f74',
  amber: '#c98a2b',
  violet: '#7b62b3',
  blue: '#3f74b5',
  rose: '#c15a74',
  slate: '#5f6b73',
};
const roomWidth = 8;
const roomDepth = 5.6;
const hqDepth = 4;
const gap = 1;
const wallHeight = 1.3;
const agentHeight = 1;
const elevation = (60 * Math.PI) / 180;
/** The world height the camera sees at zoom 1; zoom divides it. */
const viewHeight = 20;
const walkSpeed = 1.3;
const wander: [number, number][] = [
  [-0.4, 0.9],
  [1.4, 1.5],
  [0.2, 0.2],
  [2, 0.6],
];

interface Room {
  id: string;
  name: string;
  color: Color;
  hq: boolean;
  width: number;
  depth: number;
  origin: Vector3;
  running: boolean;
  sessions: SessionView[];
}

export function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const textures = new Map<string, CanvasTexture>();
/** One person's pixels as a hard-edged texture, cached by look, mood and animation step. */
function textureFor(seed: string, shirt: string, mood: Mood, step: number, walking: boolean, blink: boolean) {
  const key = `${seed}/${shirt}/${mood}/${step % 2}/${walking}/${blink}`;
  let texture = textures.get(key);
  if (!texture) {
    const grid = drawAgent(lookFor(seed, shirt), mood, step, walking, blink);
    const canvas = document.createElement('canvas');
    canvas.width = grid[0].length;
    canvas.height = grid.length;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(canvas.width, canvas.height);
    for (const [y, row] of grid.entries())
      for (const [x, pixel] of row.entries()) image.data.set(pixel, (y * canvas.width + x) * 4);
    context.putImageData(image, 0, 0);
    texture = new CanvasTexture(canvas);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.colorSpace = SRGBColorSpace;
    textures.set(key, texture);
  }
  return texture;
}

/** An upright cut-out: a vertical plane, unlit, turned to face the lens around the vertical axis only. */
type Cutout = Mesh<PlaneGeometry, MeshBasicMaterial>;
interface Agent {
  sprite: Cutout;
  shadow: Mesh;
  zone: number;
  /** The session this person is: it decides their face, hair and clothes. */
  seed: string;
  shirt: string;
  mood: Mood;
  label: string;
  profile: string;
  host?: string;
  clickable: boolean;
  /** Target in world space; idle agents pick their own from `wander`. */
  target: Vector3;
  wanders: boolean;
  lane: number;
  /** What the current texture was drawn for, so it is redrawn only when that changes. */
  look: string;
  popup?: HTMLButtonElement;
  caption?: HTMLElement;
}

class World {
  private renderer = new WebGLRenderer({ antialias: true, alpha: true });
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private controls: MapControls;
  private sun = new DirectionalLight('#fff1d6', 2.4);
  private sky = new HemisphereLight('#f4f1e8', '#b8b2a2', 1.1);
  private props: Object3D[] = [];
  private agents = new Map<string, Agent>();
  private rooms: Room[] = [];
  private labels = new Map<string, HTMLElement>();
  private tip = document.createElement('div');
  private overlay = document.createElement('div');
  private raycaster = new Raycaster();
  private pointer = new Vector2(2, 2);
  private hovered?: Agent;
  private signature = '';
  private structure = '';
  private dark = false;
  private cols = 0;
  private extent = { width: 10, depth: 8 };
  /** How far the camera sits from what it looks at; only its direction matters (orthographic). */
  private offset = new Vector3(0, Math.sin(elevation), Math.cos(elevation)).multiplyScalar(60);
  private fit = 1;
  private atFit = true;
  private fly?: { from: Vector3; to: Vector3; fromZoom: number; toZoom: number; start: number };
  private downAt = new Vector2();
  private last = performance.now();
  private raf = 0;
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private observer: ResizeObserver;

  constructor(
    private host: HTMLElement,
    private handlers: Handlers,
  ) {
    const { renderer, scene } = this;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.domElement.className = 'office-canvas';
    this.overlay.className = 'office-overlay';
    this.tip.className = 'office-tip';
    this.tip.hidden = true;
    const tools = document.createElement('div');
    tools.className = 'office-tools';
    const fitAll = document.createElement('button');
    fitAll.type = 'button';
    fitAll.textContent = 'Show all';
    fitAll.title = 'Drag to move, scroll to zoom, double-click a room to fly in';
    fitAll.addEventListener('click', () => this.showAll());
    tools.append(fitAll);
    this.overlay.append(tools);
    host.append(renderer.domElement, this.overlay, this.tip);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    scene.add(this.sun, this.sky, new AmbientLight('#ffffff', 0.25));

    const controls = new MapControls(this.camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enableDamping = false;
    controls.zoomToCursor = true;
    // The user took the camera: stop any flight and stop following the fit.
    controls.addEventListener('start', () => {
      this.fly = undefined;
      this.atFit = false;
    });
    this.controls = controls;

    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', (event) => this.move(event));
    canvas.addEventListener('pointerleave', () => this.pointer.set(2, 2));
    canvas.addEventListener('pointerdown', (event) => this.downAt.set(event.clientX, event.clientY));
    canvas.addEventListener('click', (event) => {
      // A drag that ends over a person is a pan, not a click.
      if (Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y) > 5) return;
      const agent = this.hovered;
      if (agent?.clickable) this.handlers.open(agent.profile, agent.host);
    });
    canvas.addEventListener('dblclick', (event) => {
      this.move(event);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
      const room =
        hit &&
        this.rooms.find(
          (r) => Math.abs(hit.x - r.origin.x) < r.width / 2 && Math.abs(hit.z - r.origin.z) < r.depth / 2,
        );
      if (room) this.flyTo(room);
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(() => this.tick());
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.host.replaceChildren();
  }

  private move(event: PointerEvent | MouseEvent) {
    const box = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - box.left) / box.width) * 2 - 1,
      -((event.clientY - box.top) / box.height) * 2 + 1,
    );
  }

  private get aspect() {
    return (this.host.clientWidth || 600) / (this.host.clientHeight || 400);
  }

  private resize() {
    const width = this.host.clientWidth || 600;
    const height = this.host.clientHeight || 400;
    this.renderer.setSize(width, height, false);
    const half = (this.aspect * viewHeight) / 2;
    Object.assign(this.camera, { left: -half, right: half, top: viewHeight / 2, bottom: -viewHeight / 2 });
    this.camera.updateProjectionMatrix();
    // A wider or narrower card can suit another arrangement of the rooms better.
    if (this.rooms.length > 1 && this.pickCols(this.rooms.length - 1) !== this.cols) {
      this.build(this.zones, this.dark);
      this.assign(this.zones);
    } else this.refit(this.atFit);
  }
  private zones: WorldZone[] = [];

  /** The zoom at which a floor of this size (plus a margin for walls and popups) just fits the card. */
  private zoomFor(width: number, depth: number) {
    return Math.min(
      (this.aspect * viewHeight) / (width + 1),
      viewHeight / (depth * Math.sin(elevation) + 2.6),
    );
  }

  /** The number of columns whose floor best matches the card's shape, so the set fills it. */
  private pickCols(count: number) {
    let best = 1;
    let gapToCard = Number.POSITIVE_INFINITY;
    for (let cols = 1; cols <= Math.min(count, 4); cols++) {
      const rows = Math.ceil(count / cols);
      const width = cols * (roomWidth + gap);
      const depth = hqDepth + gap + rows * (roomDepth + gap);
      const off = Math.abs(Math.log(width / (depth * Math.sin(elevation)) / this.aspect));
      if (off < gapToCard) [best, gapToCard] = [cols, off];
    }
    return best;
  }

  /** Moves the camera to look at `target` at `zoom`: at once, or with a short ease. */
  private view(target: Vector3, zoom: number, jump = false) {
    const to = Math.min(Math.max(zoom, this.controls.minZoom), this.controls.maxZoom);
    if (jump || this.still) {
      this.fly = undefined;
      this.place(target, to);
    } else {
      this.fly = {
        from: this.controls.target.clone(),
        to: target.clone(),
        fromZoom: this.camera.zoom,
        toZoom: to,
        start: performance.now(),
      };
    }
  }
  private place(target: Vector3, zoom: number) {
    this.controls.target.copy(target);
    this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(target).add(this.offset);
    this.controls.update();
  }

  /** Re-derives the zoom limits for the current building, then frames all of it when `frame` is set. */
  private refit(frame: boolean) {
    this.fit = this.zoomFor(this.extent.width, this.extent.depth);
    this.controls.minZoom = this.fit * 0.7;
    this.controls.maxZoom = this.fit * 8;
    if (frame) {
      this.atFit = true;
      this.view(new Vector3(0, 0, 0), this.fit, true);
    }
  }
  private showAll() {
    this.atFit = true;
    this.view(new Vector3(0, 0, 0), this.fit);
  }
  private flyTo(room: Room) {
    this.atFit = false;
    this.view(new Vector3(room.origin.x, 0, room.origin.z), this.zoomFor(room.width, room.depth));
  }

  /** Rebuilds the set when the profiles change and just retargets the agents otherwise. */
  setZones(zones: WorldZone[], theme: string) {
    this.zones = zones;
    const dark = theme === 'dark';
    this.dark = dark;
    this.sky.intensity = dark ? 0.55 : 1.1;
    this.sun.intensity = dark ? 1.3 : 2.4;
    const signature = JSON.stringify([
      dark,
      zones.map((z) => [z.id, z.name, z.color, z.sessions.length, z.running]),
    ]);
    if (signature !== this.signature) {
      const structure = JSON.stringify([
        dark,
        zones.map((z) => [z.id, z.name, z.color, Math.max(3, z.sessions.length)]),
      ]);
      if (structure !== this.structure) this.build(zones, dark);
      this.structure = structure;
      this.signature = signature;
    }
    this.assign(zones);
  }

  private build(zones: WorldZone[], dark: boolean) {
    for (const group of this.props) {
      this.scene.remove(group);
      group.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          (object.material as MeshStandardMaterial).dispose();
        }
      });
    }
    this.props = [];
    for (const label of this.labels.values()) label.remove();
    this.labels.clear();
    for (const agent of this.agents.values()) {
      this.scene.remove(agent.sprite, agent.shadow);
      agent.sprite.material.dispose();
      agent.popup?.remove();
      agent.caption?.remove();
    }
    this.agents.clear();

    const cols = this.pickCols(zones.length || 1);
    this.cols = cols;
    const rows = Math.ceil((zones.length || 1) / cols);
    const width = cols * (roomWidth + gap) - gap;
    const depth = hqDepth + gap + rows * (roomDepth + gap) - gap;
    this.extent = { width: width + 1.8, depth: depth + 1.8 };
    const top = -depth / 2;
    this.rooms = [
      {
        id: 'hq',
        name: 'Codex HQ',
        color: 'slate',
        hq: true,
        width,
        depth: hqDepth,
        origin: new Vector3(0, 0, top + hqDepth / 2),
        running: true,
        sessions: [],
      },
      ...zones.map((zone, i) => ({
        id: zone.id,
        name: zone.name,
        color: zone.color,
        hq: false,
        width: roomWidth,
        depth: roomDepth,
        origin: new Vector3(
          (i % cols) * (roomWidth + gap) - (cols * (roomWidth + gap) - gap) / 2 + roomWidth / 2,
          0,
          top + hqDepth + gap + Math.floor(i / cols) * (roomDepth + gap) + roomDepth / 2,
        ),
        running: zone.running,
        sessions: zone.sessions,
      })),
    ];

    const matte = (color: string, emissive?: string) =>
      new MeshStandardMaterial({
        color,
        roughness: 1,
        metalness: 0,
        ...(emissive ? { emissive, emissiveIntensity: 0.6 } : {}),
      });
    const add = (parent: Group, mesh: Mesh, x: number, y: number, z: number, shadow = true) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const slab = (w: number, h: number, d: number, color: string, emissive?: string) =>
      new Mesh(new BoxGeometry(w, h, d), matte(color, emissive));
    // The building's floor, which shows as corridors between the rooms.
    const floor = slab(this.extent.width, 0.3, this.extent.depth, dark ? '#222a27' : '#c9c4b3');
    floor.position.set(0, -0.15, 0);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.props.push(floor);

    for (const room of this.rooms) {
      const root = new Group();
      root.position.copy(room.origin);
      const tint = room.hq ? (dark ? '#56656f' : '#3b4650') : rug[room.color];
      const edge = new Mesh(new PlaneGeometry(room.width - 0.1, room.depth - 0.1), matte(tint));
      edge.rotation.x = -Math.PI / 2;
      edge.position.y = 0.012;
      edge.receiveShadow = true;
      const inner = new Mesh(
        new PlaneGeometry(room.width - 0.5, room.depth - 0.5),
        matte(dark ? '#38433e' : '#ece8da'),
      );
      inner.rotation.x = -Math.PI / 2;
      inner.position.y = 0.02;
      inner.receiveShadow = true;
      root.add(edge, inner);
      // The back wall carries the profile's colour; the sides are plain. The front is open so the room can be seen into.
      add(root, slab(room.width, wallHeight, 0.2, tint), 0, wallHeight / 2, -room.depth / 2 + 0.1);
      const side = dark ? '#47524c' : '#e4dfcf';
      add(root, slab(0.2, wallHeight, room.depth, side), -room.width / 2 + 0.1, wallHeight / 2, 0);
      add(root, slab(0.2, wallHeight, room.depth, side), room.width / 2 - 0.1, wallHeight / 2, 0);

      if (room.hq) {
        add(root, slab(6, 0.8, 0.8, '#5b6670'), 0, 0.4, -room.depth / 2 + 1.1);
        for (const x of [-2.2, -0.75, 0.75, 2.2])
          add(root, slab(1.0, 0.55, 0.06, '#26302f', '#6fb8ff'), x, 1.1, -room.depth / 2 + 1.35);
        add(root, slab(1.6, 0.4, 1.0, '#6e8b7d'), -room.width / 2 + 2, 0.2, 0.5);
        add(root, slab(1.6, 0.4, 1.0, '#6e8b7d'), room.width / 2 - 2, 0.2, 0.5);
      } else {
        const zone = room.sessions;
        const desks = Math.max(3, zone.length);
        for (let d = 0; d < desks; d++) {
          const x = -room.width / 2 + 1 + ((d + 0.5) * (room.width - 3)) / desks;
          const working = zone[d]?.state === 'working';
          add(root, slab(1.2, 0.75, 0.65, '#a8794a'), x, 0.375, -1.8);
          add(root, slab(0.55, 0.36, 0.05, '#3a4540', working ? '#5fe0aa' : undefined), x, 1.0, -1.95);
        }
        // Where people wait when they need you: an amber mat near the front.
        const mat = new Mesh(new PlaneGeometry(2.2, 1.6), matte('#e5a23a'));
        mat.rotation.x = -Math.PI / 2;
        mat.position.set(2.6, 0.03, 1.3);
        mat.receiveShadow = true;
        root.add(mat);
        add(root, slab(2.4, 0.5, 0.9, '#6e8b7d'), -2.2, 0.25, 2.1);
        add(root, slab(2.4, 0.55, 0.22, '#5a7568'), -2.2, 0.75, 1.7);
        add(root, new Mesh(new CylinderGeometry(0.2, 0.16, 0.34, 12), matte('#b0683d')), 0.6, 0.17, 2.4);
        add(root, new Mesh(new IcosahedronGeometry(0.34, 0), matte('#3f8f5b')), 0.6, 0.62, 2.4);
      }
      this.scene.add(root);
      this.props.push(root);

      // The room's name sits on its wall: the name flies in, the arrow brings that profile's Claude forward.
      const label = document.createElement('div');
      label.className = `office-zone ${room.color}${room.hq ? ' hq' : ''}`;
      const name = document.createElement('button');
      name.type = 'button';
      name.textContent = room.name;
      name.title = `Zoom to ${room.name}`;
      name.addEventListener('click', () => this.flyTo(room));
      label.append(name);
      if (!room.hq) {
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = '↗';
        open.title = `Open ${room.name}`;
        open.setAttribute('aria-label', `Open ${room.name}`);
        open.addEventListener('click', () => this.handlers.launch(room.id));
        label.append(open);
      }
      this.overlay.append(label);
      this.labels.set(room.id, label);
    }
    this.sun.position.set(-width * 0.3, 18, depth * 0.4 + 6);
    const reach = Math.max(width, depth) / 2 + 3;
    Object.assign(this.sun.shadow.camera, {
      left: -reach,
      right: reach,
      top: reach,
      bottom: -reach,
      near: 1,
      far: 60,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.refit(true);
  }

  /** Decides where each agent goes: working ones to a desk, ones that need you to the mat, finished ones to the couch. */
  private assign(zones: WorldZone[]) {
    const seen = new Set<string>();
    const busy = zones.some((z) => z.sessions.some((s) => s.state === 'working'));
    for (const [r, room] of this.rooms.entries()) {
      const desks = Math.max(3, room.sessions.length);
      let asking = 0;
      let resting = 0;
      type Entry = { key: string; mood: Mood; s?: SessionView; x: number; z: number; label: string };
      let entries: Entry[];
      if (room.hq) {
        // Codex sits at the console while anything is running, otherwise it strolls about.
        entries = [
          {
            key: 'hq/codex',
            mood: busy ? 'working' : 'idle',
            x: 0,
            z: -room.depth / 2 + 1.75,
            label: 'Codex',
          },
        ];
      } else if (room.sessions.length) {
        entries = room.sessions.map((s, index) => {
          let x = 0;
          let z = 0;
          if (s.state === 'working') {
            x = -room.width / 2 + 1 + ((index + 0.5) * (room.width - 3)) / desks;
            z = -0.95;
          } else if (s.state === 'ask') {
            const n = asking++;
            x = 2.1 + (n % 2) * 0.9;
            z = 1.0 + Math.floor(n / 2) * 0.7;
          } else {
            const n = resting++;
            x = -3.0 + (n % 3) * 0.85;
            z = n < 3 ? 2.0 : 2.8;
          }
          return {
            key: `${room.id}/${s.id}`,
            mood: s.state as Mood,
            s,
            x,
            z,
            label: s.summary?.title || 'Claude Code session',
          };
        });
      } else {
        entries = [
          {
            key: `${room.id}/idle`,
            mood: room.running ? 'idle' : 'sleep',
            x: room.running ? 0 : -2.2,
            z: room.running ? 1 : 2.0,
            label: room.running ? 'Idle' : 'Not running',
          },
        ];
      }
      const shirt = room.hq ? '#f2f0e8' : rug[room.color];
      for (const entry of entries) {
        seen.add(entry.key);
        let agent = this.agents.get(entry.key);
        const at = room.origin;
        if (!agent) {
          const sprite: Cutout = new Mesh(
            new PlaneGeometry(1, 1).translate(0, 0.5, 0),
            new MeshBasicMaterial({ alphaTest: 0.5, side: DoubleSide }),
          );
          const shadow = new Mesh(
            new CircleGeometry(0.26, 16),
            new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22 }),
          );
          shadow.rotation.x = -Math.PI / 2;
          sprite.position.set(at.x + entry.x, 0, at.z + entry.z);
          this.scene.add(sprite, shadow);
          agent = {
            sprite,
            shadow,
            zone: r,
            seed: entry.key,
            shirt,
            mood: entry.mood,
            label: entry.label,
            profile: room.id,
            clickable: false,
            target: new Vector3(),
            wanders: false,
            lane: r,
            look: '',
          };
          this.agents.set(entry.key, agent);
        }
        agent.zone = r;
        agent.shirt = shirt;
        agent.mood = entry.mood;
        agent.label = entry.label;
        agent.host = entry.s?.host;
        agent.clickable = !!entry.s;
        agent.wanders = !entry.s && room.running && entry.mood === 'idle';
        agent.target.set(
          at.x + entry.x,
          entry.mood === 'done' || entry.mood === 'sleep' ? 0.5 : 0,
          at.z + entry.z,
        );
        agent.look = '';
      }
    }
    for (const [key, agent] of this.agents)
      if (!seen.has(key)) {
        this.scene.remove(agent.sprite, agent.shadow);
        agent.sprite.material.dispose();
        agent.popup?.remove();
        agent.caption?.remove();
        this.agents.delete(key);
      }
  }

  /** Eases an in-flight camera move, keeps the view over the building and the look at the ground. */
  private steer(now: number) {
    const { controls, camera } = this;
    if (this.fly) {
      const f = this.fly;
      const p = Math.min(1, (now - f.start) / 800);
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      controls.target.lerpVectors(f.from, f.to, e);
      // Zoom in log space so a long flight feels even.
      camera.zoom = Math.exp(Math.log(f.fromZoom) + (Math.log(f.toZoom) - Math.log(f.fromZoom)) * e);
      camera.updateProjectionMatrix();
      camera.position.copy(controls.target).add(this.offset);
      if (p >= 1) this.fly = undefined;
    }
    const t = controls.target;
    const x = Math.max(-this.extent.width / 2, Math.min(this.extent.width / 2, t.x));
    const z = Math.max(-this.extent.depth / 2, Math.min(this.extent.depth / 2, t.z));
    if (x !== t.x || z !== t.z || t.y !== 0) {
      const shift = new Vector3(x - t.x, -t.y, z - t.z);
      t.add(shift);
      camera.position.add(shift);
    }
    controls.update();
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const time = now / 1000;
    const step = Math.floor(time / 0.22);
    for (const agent of this.agents.values()) {
      if (agent.wanders) {
        const [x, z] = wander[(Math.floor(time / 5) + agent.lane) % wander.length];
        const at = this.rooms[agent.zone]?.origin;
        if (at) agent.target.set(at.x + x, 0, at.z + z);
      }
      const position = agent.sprite.position;
      const dx = agent.target.x - position.x;
      const dz = agent.target.z - position.z;
      const distance = Math.hypot(dx, dz);
      const walking = distance > 0.03;
      if (walking) {
        const move = Math.min(distance, walkSpeed * dt * (this.still ? 4 : 1));
        position.x += (dx / distance) * move;
        position.z += (dz / distance) * move;
      }
      position.y = agent.target.y;
      // A small bob while walking, a slow hop while waiting for you.
      if (!this.still) {
        if (walking) position.y += Math.abs(Math.sin(time * 9)) * 0.07;
        else if (agent.mood === 'ask') position.y += (1 + Math.sin(time * 4)) * 0.06;
      }
      agent.shadow.position.set(position.x, 0.03, position.z);
      const blink = step % 28 === 0;
      const look = `${agent.mood}/${agent.shirt}/${walking}/${walking || agent.mood === 'working' ? step % 2 : 0}/${blink}`;
      if (agent.look !== look) {
        agent.look = look;
        const texture = textureFor(agent.seed, agent.shirt, agent.mood, step, walking, blink);
        agent.sprite.material.map = texture;
        agent.sprite.material.needsUpdate = true;
        const { width, height } = texture.image as HTMLCanvasElement;
        // A vertical plane is foreshortened by the camera's pitch, so it is stretched to read at full height.
        agent.sprite.scale.set((agentHeight * width) / height, agentHeight / Math.cos(elevation), 1);
      }
    }
    this.steer(now);
    this.camera.updateMatrixWorld();
    this.hover();
    this.overlays();
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    for (const room of this.rooms) {
      const label = this.labels.get(room.id);
      if (!label) continue;
      const screen = new Vector3(
        room.origin.x - room.width / 2 + 0.3,
        wallHeight * 0.55,
        room.origin.z - room.depth / 2,
      ).project(this.camera);
      label.style.transform = `translate(${((screen.x + 1) / 2) * w}px, ${((1 - screen.y) / 2) * h}px) translateY(-50%)`;
    }
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(() => this.tick());
  }

  /**
   * A card over every person who needs you (three a room; the rest are in the Needs you column), and, once
   * the camera is close, a small caption under everyone else with their session's title.
   */
  private overlays() {
    const shown = new Map<number, number>();
    const near = this.camera.zoom > this.fit * 1.7;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    for (const agent of this.agents.values()) {
      const rank = shown.get(agent.zone) ?? 0;
      const popup = agent.mood === 'ask' && agent.clickable && rank < 3;
      if (!popup) {
        agent.popup?.remove();
        agent.popup = undefined;
      } else {
        shown.set(agent.zone, rank + 1);
        if (!agent.popup) {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'office-popup';
          card.append(document.createElement('strong'), document.createElement('span'));
          card.addEventListener('click', () => this.handlers.open(agent.profile, agent.host));
          this.overlay.append(card);
          agent.popup = card;
        }
        const [title, note] = agent.popup.children;
        title.textContent = agent.label;
        note.textContent = 'Needs your input';
        const screen = agent.sprite.position
          .clone()
          .add(new Vector3(0, agentHeight + 0.3, 0))
          .project(this.camera);
        agent.popup.style.transform = `translate(${((screen.x + 1) / 2) * w}px, ${((1 - screen.y) / 2) * h - rank * 52}px) translate(-50%, -100%)`;
      }
      if (near && !popup && agent.clickable) {
        if (!agent.caption) {
          agent.caption = document.createElement('div');
          agent.caption.className = 'office-caption';
          this.overlay.append(agent.caption);
        }
        agent.caption.textContent = agent.label;
        const screen = agent.sprite.position.clone().project(this.camera);
        agent.caption.style.transform = `translate(${((screen.x + 1) / 2) * w}px, ${((1 - screen.y) / 2) * h + 4}px) translateX(-50%)`;
      } else {
        agent.caption?.remove();
        agent.caption = undefined;
      }
    }
  }

  private hover() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const sprites = [...this.agents.values()].map((a) => a.sprite);
    const hit = this.raycaster.intersectObjects(sprites)[0]?.object;
    const agent = [...this.agents.values()].find((a) => a.sprite === hit);
    this.hovered = agent;
    this.renderer.domElement.style.cursor = agent?.clickable ? 'pointer' : '';
    if (!agent) {
      this.tip.hidden = true;
      return;
    }
    const screen = agent.sprite.position
      .clone()
      .add(new Vector3(0, agentHeight + 0.2, 0))
      .project(this.camera);
    this.tip.textContent = agent.label;
    this.tip.hidden = false;
    this.tip.style.transform = `translate(${((screen.x + 1) / 2) * this.host.clientWidth}px, ${((1 - screen.y) / 2) * this.host.clientHeight}px) translate(-50%, -100%)`;
  }
}

export function OfficeWorld(props: {
  zones: WorldZone[];
  theme: string;
  onOpen(profile: string, host?: string): void;
  onLaunch(profile: string): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<World | undefined>(undefined);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const instance = new World(host.current!, {
      open: (profile, session) => latest.current.onOpen(profile, session),
      launch: (profile) => latest.current.onLaunch(profile),
    });
    world.current = instance;
    instance.setZones(latest.current.zones, latest.current.theme);
    return () => {
      instance.dispose();
      world.current = undefined;
    };
  }, []);
  useEffect(() => world.current?.setZones(props.zones, props.theme), [props.zones, props.theme]);
  return <div className="office-world" ref={host} />;
}
