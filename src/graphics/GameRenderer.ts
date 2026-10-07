import * as THREE from 'three/webgpu';
import { COIN, PLAYER, TRACK } from '../config/GameConfig';
import type { ObstacleKind } from '../core/types';

interface TrackProp {
  group: THREE.Group;
  z: number;
}

interface SideBuilding {
  group: THREE.Group;
  z: number;
  side: -1 | 1;
}

const BUILDING_COLORS = [0x5c6bc0, 0x78909c, 0xef5350, 0x26a69a, 0xffa726, 0x7e57c2];
const BUILDING_SPACING = 18;

export class GameRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly container: HTMLElement;
  private readonly forceWebGL: boolean;
  private renderer: THREE.WebGPURenderer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private ties: TrackProp[] = [];
  private buildings: SideBuilding[] = [];
  private laneMeshes: THREE.Mesh[] = [];
  private _backendName: 'webgpu' | 'webgl' = 'webgl';

  constructor(container: HTMLElement, forceWebGL: boolean) {
    this.container = container;
    this.forceWebGL = forceWebGL;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b5d9);
    this.scene.fog = new THREE.Fog(0x87b5d9, 50, 160);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    this.camera.position.set(0, 5.5, 10);
    this.camera.lookAt(0, 1.2, -20);
  }

  get backendName(): 'webgpu' | 'webgl' {
    return this._backendName;
  }

  async init(): Promise<void> {
    const renderer = new THREE.WebGPURenderer({
      antialias: true,
      forceWebGL: this.forceWebGL,
    });
    await renderer.init();

    this.renderer = renderer;
    this._backendName = this.detectBackend(renderer);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(renderer.domElement);
    this.applySize();

    this.setupLights();
    this.setupTrack();
    this.setupSideScenery();

    this.resizeObserver = new ResizeObserver(() => this.applySize());
    this.resizeObserver.observe(this.container);

    console.info(`[graphics] backend = ${this._backendName}`);
  }

  createPlayerMesh(): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0, PLAYER.START_Y, 0);

    const skin = new THREE.MeshStandardMaterial({
      color: 0xffdbac,
      roughness: 0.55,
      metalness: 0.05,
    });
    const shirt = new THREE.MeshStandardMaterial({
      color: 0xff6b35,
      roughness: 0.5,
      metalness: 0.1,
    });
    const pants = new THREE.MeshStandardMaterial({
      color: 0x2d5a87,
      roughness: 0.55,
      metalness: 0.05,
    });
    const shoes = new THREE.MeshStandardMaterial({
      color: 0xf4d35e,
      roughness: 0.4,
      metalness: 0.2,
    });

    const originY = -PLAYER.START_Y;

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.35), shirt);
    torso.position.set(0, originY + 1.15, 0);
    torso.castShadow = true;
    torso.name = 'torso';
    group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
    head.position.set(0, originY + 1.62, 0.02);
    head.castShadow = true;
    head.name = 'head';
    group.add(head);

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.23, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.7 }),
    );
    hair.position.set(0, originY + 1.7, -0.02);
    hair.name = 'hair';
    group.add(hair);

    for (const side of [-1, 1] as const) {
      const sideName = side < 0 ? 'L' : 'R';
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.28, 4, 8), shirt);
      arm.position.set(side * 0.4, originY + 1.1, 0);
      arm.rotation.z = side * 0.25;
      arm.castShadow = true;
      arm.name = `arm${sideName}`;
      arm.userData.rest = {
        x: arm.position.x,
        y: arm.position.y,
        z: arm.position.z,
        rx: 0,
        ry: 0,
        rz: side * 0.25,
      };
      group.add(arm);

      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.35, 4, 8), pants);
      leg.position.set(side * 0.16, originY + 0.45, 0);
      leg.castShadow = true;
      leg.name = `leg${sideName}`;
      leg.userData.rest = {
        x: leg.position.x,
        y: leg.position.y,
        z: leg.position.z,
        rx: 0,
        ry: 0,
        rz: 0,
      };
      group.add(leg);

      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.28), shoes);
      shoe.position.set(side * 0.16, originY + 0.08, 0.04);
      shoe.castShadow = true;
      shoe.name = `shoe${sideName}`;
      shoe.userData.rest = {
        x: shoe.position.x,
        y: shoe.position.y,
        z: shoe.position.z,
        rx: 0,
        ry: 0,
        rz: 0,
      };
      group.add(shoe);
    }

    return group;
  }

  /** Drive named limbs into the star pose, or back to rest. */
  applyPlayerStarPose(group: THREE.Object3D, star: boolean): void {
    const originY = -PLAYER.START_Y;
    const setLimb = (
      name: string,
      pos: { x: number; y: number; z: number },
      rot: { x: number; y: number; z: number },
    ) => {
      const limb = group.getObjectByName(name);
      if (!limb) return;
      limb.position.set(pos.x, pos.y, pos.z);
      limb.rotation.set(rot.x, rot.y, rot.z);
    };

    const restore = (name: string) => {
      const limb = group.getObjectByName(name);
      const rest = limb?.userData.rest as
        | { x: number; y: number; z: number; rx: number; ry: number; rz: number }
        | undefined;
      if (!limb || !rest) return;
      limb.position.set(rest.x, rest.y, rest.z);
      limb.rotation.set(rest.rx, rest.ry, rest.rz);
    };

    group.rotation.y = 0;
    if (!star) {
      for (const n of ['armL', 'armR', 'legL', 'legR', 'shoeL', 'shoeR']) restore(n);
      return;
    }

    // Front-facing jumping-star / X pose
    setLimb('armL', { x: -0.55, y: originY + 1.35, z: 0 }, { x: 0, y: 0, z: 1.1 });
    setLimb('armR', { x: 0.55, y: originY + 1.35, z: 0 }, { x: 0, y: 0, z: -1.1 });
    setLimb('legL', { x: -0.35, y: originY + 0.4, z: 0 }, { x: 0, y: 0, z: 0.55 });
    setLimb('legR', { x: 0.35, y: originY + 0.4, z: 0 }, { x: 0, y: 0, z: -0.55 });
    setLimb('shoeL', { x: -0.45, y: originY + 0.08, z: 0.04 }, { x: 0, y: 0, z: 0.2 });
    setLimb('shoeR', { x: 0.45, y: originY + 0.08, z: 0.04 }, { x: 0, y: 0, z: -0.2 });
  }

  createObstacleMesh(kind: ObstacleKind): THREE.Group {
    const group = new THREE.Group();
    group.visible = false;

    if (kind === 'high') {
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xe53935,
        roughness: 0.45,
        metalness: 0.25,
      });
      const darkMat = new THREE.MeshStandardMaterial({
        color: 0x263238,
        roughness: 0.6,
        metalness: 0.3,
      });
      const stripeMat = new THREE.MeshStandardMaterial({
        color: 0xffeb3b,
        roughness: 0.4,
        metalness: 0.1,
      });

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 1.4), bodyMat);
      body.position.y = 0.45;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.22, 0.2), darkMat);
      bumper.position.set(0, 0.2, 0.75);
      bumper.castShadow = true;
      group.add(bumper);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 1.42), stripeMat);
      stripe.position.y = 0.55;
      group.add(stripe);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.5), darkMat);
      cabin.position.set(0, 1.0, -0.2);
      cabin.castShadow = true;
      group.add(cabin);
    } else if (kind === 'low') {
      const barMat = new THREE.MeshStandardMaterial({
        color: 0x43a047,
        roughness: 0.5,
        metalness: 0.15,
      });
      const postMat = new THREE.MeshStandardMaterial({
        color: 0x546e7a,
        roughness: 0.55,
        metalness: 0.2,
      });
      const signMat = new THREE.MeshStandardMaterial({
        color: 0xffee58,
        roughness: 0.45,
        metalness: 0.05,
      });

      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), postMat);
        post.position.set(side * 0.85, 1.1, 0);
        post.castShadow = true;
        group.add(post);
      }

      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 0.45), barMat);
      bar.position.y = 1.75;
      bar.castShadow = true;
      bar.receiveShadow = true;
      group.add(bar);

      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.08), signMat);
      sign.position.set(0, 1.75, 0.28);
      group.add(sign);
    } else {
      this.buildStarGate(group);
    }

    return group;
  }

  createGuardMesh(): THREE.Group {
    const group = new THREE.Group();
    group.visible = false;

    const uniform = new THREE.MeshStandardMaterial({
      color: 0x1565c0,
      roughness: 0.5,
      metalness: 0.1,
    });
    const skin = new THREE.MeshStandardMaterial({
      color: 0xffcc80,
      roughness: 0.55,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), uniform);
    body.position.y = 1.1;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skin);
    head.position.y = 1.75;
    group.add(head);

    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 12), dark);
    hat.position.y = 1.95;
    group.add(hat);

    const badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xffd54f, metalness: 0.6, roughness: 0.3 }),
    );
    badge.position.set(0.2, 1.25, 0.22);
    group.add(badge);

    return group;
  }

  private buildStarGate(group: THREE.Group): void {
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x7b1fa2,
      roughness: 0.5,
      metalness: 0.15,
    });
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x37474f,
      roughness: 0.7,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
    });
    const cutMat = new THREE.MeshStandardMaterial({
      color: 0xffecb3,
      emissive: 0xffa000,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });

    // Outer frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.5, 0.2), frameMat);
    frame.position.y = 1.25;
    frame.castShadow = true;
    group.add(frame);

    // Dark panel behind cutout
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.1, 0.08), panelMat);
    panel.position.set(0, 1.25, 0.05);
    group.add(panel);

    // X silhouette approximation with crossed capsules
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 1.4, 4, 8), cutMat);
    a.rotation.z = Math.PI / 4;
    a.position.set(0, 1.3, 0.12);
    group.add(a);
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 1.4, 4, 8), cutMat);
    b.rotation.z = -Math.PI / 4;
    b.position.set(0, 1.3, 0.12);
    group.add(b);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), cutMat);
    head.position.set(0, 2.05, 0.12);
    group.add(head);
  }

  createCoinMesh(): THREE.Group {
    const group = new THREE.Group();
    group.visible = false;

    const gold = new THREE.MeshStandardMaterial({
      color: 0xffc107,
      roughness: 0.25,
      metalness: 0.85,
      emissive: 0x332200,
      emissiveIntensity: 0.35,
    });
    const rim = new THREE.MeshStandardMaterial({
      color: 0xffe082,
      roughness: 0.3,
      metalness: 0.7,
    });

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(COIN.RADIUS, COIN.RADIUS, 0.08, 20),
      gold,
    );
    disc.rotation.z = Math.PI / 2;
    disc.castShadow = true;
    group.add(disc);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(COIN.RADIUS * 0.72, 0.04, 8, 20), rim);
    ring.rotation.y = Math.PI / 2;
    group.add(ring);

    return group;
  }

  add(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  remove(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  scrollTrack(distance: number): void {
    const tieSpan = this.ties.length * (TRACK.RUNG_SPACING * 0.5);
    for (const tie of this.ties) {
      tie.z += distance;
      if (tie.z > TRACK.LENGTH * 0.35) {
        tie.z -= tieSpan;
      }
      tie.group.position.z = tie.z;
    }

    const buildingSpan = this.buildings.length * BUILDING_SPACING * 0.5;
    for (const building of this.buildings) {
      building.z += distance;
      if (building.z > TRACK.LENGTH * 0.35) {
        building.z -= buildingSpan;
      }
      building.group.position.z = building.z;
    }
  }

  setAnimationLoop(cb: (() => void) | null): void {
    this.renderer?.setAnimationLoop(cb);
  }

  render(): void {
    if (!this.renderer) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    for (const object of [...this.scene.children]) {
      this.disposeObject(object);
      this.scene.remove(object);
    }

    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
      this.renderer = null;
    }

    this.ties = [];
    this.buildings = [];
    this.laneMeshes = [];
  }

  private detectBackend(renderer: THREE.WebGPURenderer): 'webgpu' | 'webgl' {
    const backend = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean } })
      .backend;
    if (backend?.isWebGPUBackend) return 'webgpu';
    if (backend?.isWebGLBackend) return 'webgl';
    return this.forceWebGL || !('gpu' in navigator) ? 'webgl' : 'webgpu';
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xfff5e0, 0x6b8e6b, 1.15);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xfff3e0, 1.55);
    dir.position.set(8, 18, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);

    const fill = new THREE.DirectionalLight(0xa0c4ff, 0.35);
    fill.position.set(-6, 8, -4);
    this.scene.add(fill);
  }

  private setupTrack(): void {
    const trackWidth = TRACK.LANE_COUNT * TRACK.LANE_WIDTH;

    // Gravel / ballast bed
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(trackWidth + 2.4, 0.25, TRACK.LENGTH),
      new THREE.MeshStandardMaterial({ color: 0x6d5d4b, roughness: 0.95, metalness: 0 }),
    );
    bed.position.set(0, -0.05, -TRACK.LENGTH * 0.35);
    bed.receiveShadow = true;
    this.scene.add(bed);

    // Lane strips (asphalt)
    const laneColors = [0x4a5568, 0x5a6a7a, 0x4a5568];
    for (let i = 0; i < TRACK.LANE_COUNT; i++) {
      const lane = i - 1;
      const geo = new THREE.PlaneGeometry(TRACK.LANE_WIDTH * 0.9, TRACK.LENGTH);
      const mat = new THREE.MeshStandardMaterial({
        color: laneColors[i] ?? 0x4a5568,
        roughness: 0.88,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(lane * TRACK.LANE_WIDTH, 0.08, -TRACK.LENGTH * 0.35);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.laneMeshes.push(mesh);
    }

    // Rails
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x90a4ae,
      roughness: 0.35,
      metalness: 0.85,
    });
    for (const x of [-trackWidth * 0.42, trackWidth * 0.42]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, TRACK.LENGTH), railMat);
      rail.position.set(x, 0.12, -TRACK.LENGTH * 0.35);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.scene.add(rail);
    }

    // Wooden ties
    const tieMat = new THREE.MeshStandardMaterial({
      color: 0x5d4037,
      roughness: 0.9,
      metalness: 0.05,
    });
    const tieSpacing = TRACK.RUNG_SPACING * 0.5;
    const tieCount = Math.ceil(TRACK.LENGTH / tieSpacing) + 2;
    for (let i = 0; i < tieCount; i++) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(trackWidth + 0.6, 0.08, 0.28), tieMat);
      mesh.position.y = 0.06;
      mesh.receiveShadow = true;
      group.add(mesh);
      const z = 20 - i * tieSpacing;
      group.position.z = z;
      this.scene.add(group);
      this.ties.push({ group, z });
    }
  }

  private setupSideScenery(): void {
    const count = Math.ceil(TRACK.LENGTH / BUILDING_SPACING) + 2;
    let index = 0;
    for (let i = 0; i < count; i++) {
      for (const side of [-1, 1] as const) {
        const group = this.makeBuilding(side, index++);
        const z = 15 - i * BUILDING_SPACING - (side === 1 ? BUILDING_SPACING * 0.4 : 0);
        group.position.set(side * (TRACK.LANE_COUNT * TRACK.LANE_WIDTH * 0.5 + 3.2), 0, z);
        this.scene.add(group);
        this.buildings.push({ group, z, side });
      }
    }

    // Ground strips beside track
    for (const side of [-1, 1]) {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(10, TRACK.LENGTH),
        new THREE.MeshStandardMaterial({ color: 0x7cb342, roughness: 0.95, metalness: 0 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(side * (TRACK.LANE_COUNT * TRACK.LANE_WIDTH * 0.5 + 5), 0.01, -TRACK.LENGTH * 0.35);
      ground.receiveShadow = true;
      this.scene.add(ground);
    }
  }

  private makeBuilding(side: -1 | 1, seed: number): THREE.Group {
    const group = new THREE.Group();
    const color = BUILDING_COLORS[seed % BUILDING_COLORS.length] ?? 0x78909c;
    const h = 4 + (seed % 5) * 1.2;
    const w = 2.2 + (seed % 3) * 0.4;
    const d = 3 + (seed % 4) * 0.5;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 }),
    );
    body.position.y = h * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xfff59d,
      roughness: 0.3,
      metalness: 0.2,
      emissive: 0x665511,
      emissiveIntensity: 0.25,
    });
    const floors = Math.max(2, Math.floor(h / 1.4));
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < 2; c++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.06), windowMat);
        win.position.set((c - 0.5) * 0.7, 1.2 + f * 1.3, side * (d * 0.5 + 0.02));
        group.add(win);
      }
    }

    return group;
  }

  private applySize(): void {
    if (!this.renderer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) {
          for (const m of material) m.dispose();
        } else {
          material?.dispose();
        }
      }
    });
  }
}
