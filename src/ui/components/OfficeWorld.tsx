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
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Color } from '../../core/profiles.ts';
import { drawPet, type Mood } from '../../core/sprites.ts';
import type { SessionView } from '../../shared.ts';

/**
 * The Office as a small lit 3D set with flat pixel characters standing in it, the same idea as the
 * 3d-animation skill: the set has real light and shadow, the people are cut-outs that always face the lens.
 * Nothing shakes, flickers or zooms; the camera only drifts slowly.
 */
export interface WorldZone {
  id: string;
  name: string;
  color: Color;
  species: number;
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
const zoneWidth = 8;
const zoneDepth = 6;
const gap = 0.9;
const agentHeight = 1.5;
const elevation = (50 * Math.PI) / 180;
const walkSpeed = 1.5;
const wander: [number, number][] = [
  [-0.4, 0.9],
  [1.4, 1.5],
  [0.2, 0.2],
  [2, 0.6],
];

export function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const textures = new Map<string, CanvasTexture>();
/** The pet's pixels as a hard-edged texture; one per look, shared by every agent that has it. */
function textureFor(species: number, color: Color, mood: Mood, frame: number) {
  const key = `${species}/${color}/${mood}/${frame % 48}`;
  let texture = textures.get(key);
  if (!texture) {
    const grid = drawPet(species, color, mood, frame);
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
  species: number;
  color: Color;
  mood: Mood;
  label: string;
  profile: string;
  host?: string;
  clickable: boolean;
  /** Target in world space; idle agents pick their own from `wander`. */
  target: Vector3;
  wanders: boolean;
  seed: number;
  frame: number;
}

class World {
  private renderer = new WebGLRenderer({ antialias: true, alpha: true });
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.1, 100);
  private sun = new DirectionalLight('#fff1d6', 2.4);
  private sky = new HemisphereLight('#f4f1e8', '#b8b2a2', 1.1);
  private props: Object3D[] = [];
  private agents = new Map<string, Agent>();
  private origins: Vector3[] = [];
  private labels = new Map<string, HTMLButtonElement>();
  private tip = document.createElement('div');
  private overlay = document.createElement('div');
  private raycaster = new Raycaster();
  private pointer = new Vector2(2, 2);
  private hovered?: Agent;
  private signature = '';
  private zones: WorldZone[] = [];
  private center = new Vector3();
  private extent = { width: 10, depth: 8 };
  private yaw = 0;
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
    host.append(renderer.domElement, this.overlay, this.tip);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    scene.add(this.sun, this.sky, new AmbientLight('#ffffff', 0.25));
    renderer.domElement.addEventListener('pointermove', (event) => this.move(event));
    renderer.domElement.addEventListener('pointerleave', () => this.pointer.set(2, 2));
    renderer.domElement.addEventListener('click', () => {
      const agent = this.hovered;
      if (agent?.clickable) this.handlers.open(agent.profile, agent.host);
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(() => this.tick());
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.renderer.dispose();
    this.host.replaceChildren();
  }

  private move(event: PointerEvent) {
    const box = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - box.left) / box.width) * 2 - 1,
      -((event.clientY - box.top) / box.height) * 2 + 1,
    );
  }

  private resize() {
    const width = this.host.clientWidth || 600;
    const height = this.host.clientHeight || 400;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Rebuilds the set when the profiles change and just retargets the agents otherwise. */
  setZones(zones: WorldZone[], theme: string) {
    this.zones = zones;
    const dark = theme === 'dark';
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
  private structure = '';

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
    }
    this.agents.clear();
    const cols = Math.min(zones.length || 1, 2);
    const rows = Math.ceil((zones.length || 1) / cols);
    const width = cols * (zoneWidth + gap) - gap;
    const depth = rows * (zoneDepth + gap) - gap;
    this.extent = { width: width + 2, depth: depth + 2 };
    this.origins = zones.map(
      (_, i) =>
        new Vector3(
          (i % cols) * (zoneWidth + gap) - width / 2 + zoneWidth / 2,
          0,
          Math.floor(i / cols) * (zoneDepth + gap) - depth / 2 + zoneDepth / 2,
        ),
    );
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
    const floor = new Mesh(new BoxGeometry(width + 2, 0.3, depth + 2), matte(dark ? '#2b3430' : '#d8d4c5'));
    floor.position.set(0, -0.15, 0);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.props.push(floor);
    for (const [i, zone] of zones.entries()) {
      const at = this.origins[i];
      const root = new Group();
      root.position.copy(at);
      const edge = new Mesh(new PlaneGeometry(zoneWidth - 0.1, zoneDepth - 0.1), matte(rug[zone.color]));
      edge.rotation.x = -Math.PI / 2;
      edge.position.y = 0.012;
      edge.receiveShadow = true;
      const inner = new Mesh(
        new PlaneGeometry(zoneWidth - 0.5, zoneDepth - 0.5),
        matte(dark ? '#38433e' : '#ece8da'),
      );
      inner.rotation.x = -Math.PI / 2;
      inner.position.y = 0.02;
      inner.receiveShadow = true;
      root.add(edge, inner);
      const desks = Math.max(3, zone.sessions.length);
      for (let d = 0; d < desks; d++) {
        const x = -zoneWidth / 2 + 1 + ((d + 0.5) * (zoneWidth - 3)) / desks;
        const working = zone.sessions[d]?.state === 'working';
        add(root, new Mesh(new BoxGeometry(1.2, 0.75, 0.65), matte('#a8794a')), x, 0.375, -1.8);
        add(
          root,
          new Mesh(new BoxGeometry(0.55, 0.36, 0.05), matte('#3a4540', working ? '#5fe0aa' : undefined)),
          x,
          1.0,
          -1.95,
        );
      }
      add(
        root,
        new Mesh(new BoxGeometry(1.1, 2.3, 0.14), matte('#7d5733')),
        zoneWidth / 2 - 0.75,
        1.15,
        -2.7,
      );
      add(root, new Mesh(new BoxGeometry(2.4, 0.5, 0.9), matte('#6e8b7d')), -2.2, 0.25, 2.1);
      add(root, new Mesh(new BoxGeometry(2.4, 0.55, 0.22), matte('#5a7568')), -2.2, 0.75, 1.7);
      add(root, new Mesh(new CylinderGeometry(0.2, 0.16, 0.34, 12), matte('#b0683d')), 0.6, 0.17, 2.4);
      add(root, new Mesh(new IcosahedronGeometry(0.34, 0), matte('#3f8f5b')), 0.6, 0.62, 2.4);
      this.scene.add(root);
      this.props.push(root);
      // The zone's name floats over its rug; clicking it brings that profile's Claude forward.
      const label = document.createElement('button');
      label.type = 'button';
      label.className = `office-zone ${zone.color}`;
      label.textContent = zone.name;
      label.title = `Open ${zone.name}`;
      label.addEventListener('click', () => this.handlers.launch(zone.id));
      this.overlay.append(label);
      this.labels.set(zone.id, label);
    }
    this.sun.position.set(-width * 0.4, 14, depth * 0.5 + 4);
    const reach = Math.max(width, depth) / 2 + 3;
    Object.assign(this.sun.shadow.camera, {
      left: -reach,
      right: reach,
      top: reach,
      bottom: -reach,
      near: 1,
      far: 40,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** Decides where each agent goes: working ones to a desk, ones that need you to the door, finished ones to the couch. */
  private assign(zones: WorldZone[]) {
    const seen = new Set<string>();
    for (const [i, zone] of zones.entries()) {
      const at = this.origins[i];
      if (!at) continue;
      const desks = Math.max(3, zone.sessions.length);
      let asking = 0;
      let resting = 0;
      const entries = zone.sessions.length
        ? zone.sessions.map((s, index) => {
            let x = 0;
            let z = 0;
            if (s.state === 'working') {
              x = -zoneWidth / 2 + 1 + ((index + 0.5) * (zoneWidth - 3)) / desks;
              z = -0.95;
            } else if (s.state === 'ask') {
              const n = asking++;
              x = zoneWidth / 2 - 1.2 - Math.floor(n / 2) * 0.8;
              z = -1.6 + (n % 2) * 0.7;
            } else {
              x = -3.2 + resting++ * 0.85;
              z = 2.0;
            }
            return {
              key: `${zone.id}/${s.id}`,
              mood: s.state as Mood,
              s,
              x,
              z,
              label: s.summary?.title || 'Claude Code session',
            };
          })
        : [
            {
              key: `${zone.id}/idle`,
              mood: (zone.running ? 'idle' : 'sleep') as Mood,
              s: undefined,
              x: zone.running ? 0 : -2.2,
              z: zone.running ? 1 : 2.0,
              label: zone.running ? 'Idle' : 'Not running',
            },
          ];
      for (const entry of entries) {
        seen.add(entry.key);
        let agent = this.agents.get(entry.key);
        if (!agent) {
          const sprite: Cutout = new Mesh(
            new PlaneGeometry(1, 1).translate(0, 0.5, 0),
            new MeshBasicMaterial({ alphaTest: 0.5, side: DoubleSide }),
          );
          const shadow = new Mesh(
            new CircleGeometry(0.4, 16),
            new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22 }),
          );
          shadow.rotation.x = -Math.PI / 2;
          sprite.position.set(at.x + entry.x, 0, at.z + entry.z);
          this.scene.add(sprite, shadow);
          agent = {
            sprite,
            shadow,
            zone: i,
            species: zone.species,
            color: zone.color,
            mood: entry.mood,
            label: entry.label,
            profile: zone.id,
            clickable: false,
            target: new Vector3(),
            wanders: false,
            seed: i,
            frame: -1,
          };
          this.agents.set(entry.key, agent);
        }
        agent.zone = i;
        agent.species = zone.species;
        agent.color = zone.color;
        agent.mood = entry.mood;
        agent.label = entry.label;
        agent.host = entry.s?.host;
        agent.clickable = !!entry.s;
        agent.wanders = !entry.s && zone.running;
        agent.target.set(
          at.x + entry.x,
          entry.mood === 'done' || entry.mood === 'sleep' ? 0.5 : 0,
          at.z + entry.z,
        );
        agent.frame = -1;
      }
    }
    for (const [key, agent] of this.agents)
      if (!seen.has(key)) {
        this.scene.remove(agent.sprite, agent.shadow);
        agent.sprite.material.dispose();
        this.agents.delete(key);
      }
  }

  private fitCamera(time: number) {
    const fovV = (this.camera.fov * Math.PI) / 180;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const halfV = (this.extent.depth * Math.sin(elevation) + 3.2) / 2;
    const distance = Math.max(this.extent.width / 2 / Math.tan(fovH / 2), halfV / Math.tan(fovV / 2)) * 1.02;
    // A very slow sway (about 2 minutes a cycle, a few degrees) so the set reads as 3D; none with reduced motion.
    const yaw = this.still ? 0 : Math.sin(time * 0.05) * 0.07;
    this.yaw = yaw;
    this.camera.position.set(
      this.center.x + Math.sin(yaw) * Math.cos(elevation) * distance,
      this.center.y + Math.sin(elevation) * distance,
      this.center.z + Math.cos(yaw) * Math.cos(elevation) * distance,
    );
    this.camera.lookAt(this.center.x, 0.2, this.center.z);
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const time = now / 1000;
    const step = Math.floor(time / 0.45);
    for (const agent of this.agents.values()) {
      if (agent.wanders) {
        const [x, z] = wander[(Math.floor(time / 5) + agent.seed) % wander.length];
        const at = this.origins[agent.zone];
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
      agent.sprite.rotation.y = this.yaw;
      agent.shadow.position.set(position.x, 0.03, position.z);
      if (agent.frame !== step) {
        agent.frame = step;
        const texture = textureFor(agent.species, agent.color, agent.mood, step);
        agent.sprite.material.map = texture;
        agent.sprite.material.needsUpdate = true;
        const { width, height } = texture.image as HTMLCanvasElement;
        // A vertical plane is foreshortened by the camera's pitch, so it is stretched to read at full height.
        agent.sprite.scale.set((agentHeight * width) / height, agentHeight / Math.cos(elevation), 1);
      }
    }
    this.fitCamera(time);
    this.camera.updateMatrixWorld();
    this.hover();
    for (const [i, zone] of this.zones.entries()) {
      const label = this.labels.get(zone.id);
      const at = this.origins[i];
      if (!label || !at) continue;
      const screen = at
        .clone()
        .add(new Vector3(-zoneWidth / 2 + 0.4, 0, zoneDepth / 2 - 0.2))
        .project(this.camera);
      label.style.transform = `translate(${((screen.x + 1) / 2) * this.host.clientWidth}px, ${((1 - screen.y) / 2) * this.host.clientHeight}px)`;
    }
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(() => this.tick());
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
