import * as THREE from 'three/webgpu';
import { OBSTACLES, PLAYER, TRACK } from '../config/GameConfig';
import type { ObstacleKind } from '../core/types';

interface TrackRung {
  mesh: THREE.Mesh;
  z: number;
}

export class GameRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly container: HTMLElement;
  private readonly forceWebGL: boolean;
  private renderer: THREE.WebGPURenderer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rungs: TrackRung[] = [];
  private laneMeshes: THREE.Mesh[] = [];
  private _backendName: 'webgpu' | 'webgl' = 'webgl';

  constructor(container: HTMLElement, forceWebGL: boolean) {
    this.container = container;
    this.forceWebGL = forceWebGL;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101820);
    this.scene.fog = new THREE.Fog(0x101820, 40, 180);

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

    this.resizeObserver = new ResizeObserver(() => this.applySize());
    this.resizeObserver.observe(this.container);

    console.info(`[graphics] backend = ${this._backendName}`);
  }

  createPlayerMesh(): THREE.Mesh {
    const geometry = new THREE.CapsuleGeometry(PLAYER.RADIUS, PLAYER.HALF_HEIGHT * 2, 6, 12);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffc857,
      roughness: 0.45,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(0, PLAYER.START_Y, 0);
    return mesh;
  }

  createObstacleMesh(kind: ObstacleKind): THREE.Mesh {
    const spec = kind === 'high' ? OBSTACLES.HIGH : OBSTACLES.LOW;
    const geometry = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
    const material = new THREE.MeshStandardMaterial({
      color: kind === 'high' ? 0xe4572e : 0x2e86ab,
      roughness: 0.55,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    return mesh;
  }

  add(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  remove(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  scrollTrack(distance: number): void {
    const span = this.rungs.length * TRACK.RUNG_SPACING;
    for (const rung of this.rungs) {
      rung.z += distance;
      if (rung.z > TRACK.LENGTH * 0.35) {
        rung.z -= span;
      }
      rung.mesh.position.z = rung.z;
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

    this.rungs = [];
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
    const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x334455, 1.1);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(6, 14, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);
  }

  private setupTrack(): void {
    const trackWidth = TRACK.LANE_COUNT * TRACK.LANE_WIDTH;
    const floorGeo = new THREE.PlaneGeometry(trackWidth + 2, TRACK.LENGTH);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x243447,
      roughness: 0.95,
      metalness: 0.0,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -TRACK.LENGTH * 0.35);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const laneColors = [0x3a506b, 0x4a6fa5, 0x3a506b];
    for (let i = 0; i < TRACK.LANE_COUNT; i++) {
      const lane = i - 1;
      const geo = new THREE.PlaneGeometry(TRACK.LANE_WIDTH * 0.92, TRACK.LENGTH);
      const mat = new THREE.MeshStandardMaterial({
        color: laneColors[i] ?? 0x3a506b,
        roughness: 0.9,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(lane * TRACK.LANE_WIDTH, 0.01, -TRACK.LENGTH * 0.35);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.laneMeshes.push(mesh);
    }

    const rungCount = Math.ceil(TRACK.LENGTH / TRACK.RUNG_SPACING) + 2;
    const rungGeo = new THREE.BoxGeometry(trackWidth + 0.4, 0.08, 0.35);
    const rungMat = new THREE.MeshStandardMaterial({
      color: 0x8da9c4,
      roughness: 0.7,
      metalness: 0.15,
    });

    for (let i = 0; i < rungCount; i++) {
      const mesh = new THREE.Mesh(rungGeo, rungMat);
      const z = 20 - i * TRACK.RUNG_SPACING;
      mesh.position.set(0, 0.05, z);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.rungs.push({ mesh, z });
    }
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
