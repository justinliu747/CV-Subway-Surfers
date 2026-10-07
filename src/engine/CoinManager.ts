import { COIN, TRACK } from '../config/GameConfig';
import type { Lane } from '../core/types';
import type { GameRenderer } from '../graphics/GameRenderer';
import type { CoinHandle, PhysicsEngine } from '../physics/PhysicsEngine';
import type * as THREE from 'three/webgpu';

interface PooledCoin {
  handle: CoinHandle | null;
  mesh: THREE.Object3D;
  z: number;
  active: boolean;
  spin: number;
}

export class CoinManager {
  private readonly physics: PhysicsEngine;
  private readonly pool: PooledCoin[] = [];
  private readonly byHandleId = new Map<number, PooledCoin>();
  private collectCallback: ((points: number) => void) | null = null;
  private time = 0;

  constructor(physics: PhysicsEngine, renderer: GameRenderer) {
    this.physics = physics;

    for (let i = 0; i < COIN.POOL_SIZE; i++) {
      const mesh = renderer.createCoinMesh();
      renderer.add(mesh);
      this.pool.push({
        handle: null,
        mesh,
        z: COIN.SPAWN_Z,
        active: false,
        spin: Math.random() * Math.PI * 2,
      });
    }

    physics.onCoinCollect((coin) => this.handleCollect(coin));
  }

  onCollect(cb: (points: number) => void): void {
    this.collectCallback = cb;
  }

  update(dt: number, runSpeed: number): void {
    const travel = runSpeed * dt;
    this.time += dt;

    for (const item of this.pool) {
      if (!item.active || !item.handle) continue;
      item.z += travel;
      this.physics.moveCoin(item.handle, item.z);

      item.spin += dt * 4;
      const bob = Math.sin(this.time * 5 + item.spin) * 0.08;
      item.mesh.position.set(
        item.handle.body.translation().x,
        COIN.CENTRE_Y + bob,
        item.z,
      );
      item.mesh.rotation.y = item.spin;
      item.mesh.visible = true;

      if (item.z >= COIN.DESPAWN_Z) {
        this.recycle(item);
      }
    }
  }

  /** Spawn a short line of coins in free lanes at a base Z (world spawn space). */
  spawnLine(lanes: Lane[], baseZ: number, count = 3): void {
    for (let i = 0; i < count; i++) {
      const z = baseZ - i * COIN.LINE_SPACING;
      for (const lane of lanes) {
        this.spawnOne(lane, z);
      }
    }
  }

  spawnOne(lane: Lane, z: number): boolean {
    const free = this.pool.find((item) => !item.active);
    if (!free) return false;

    const handle = this.physics.spawnCoin(lane, z);
    free.handle = handle;
    free.z = z;
    free.active = true;
    free.mesh.visible = true;
    free.mesh.position.set(lane * TRACK.LANE_WIDTH, COIN.CENTRE_Y, z);
    this.byHandleId.set(handle.id, free);
    return true;
  }

  reset(): void {
    for (const item of this.pool) {
      if (item.active) this.recycle(item);
    }
    this.time = 0;
  }

  private handleCollect(coin: CoinHandle): void {
    const item = this.byHandleId.get(coin.id);
    if (!item || !item.active) return;
    this.recycle(item);
    this.collectCallback?.(COIN.POINTS);
  }

  private recycle(item: PooledCoin): void {
    if (item.handle) {
      this.byHandleId.delete(item.handle.id);
      this.physics.despawnCoin(item.handle);
      item.handle = null;
    }
    item.active = false;
    item.mesh.visible = false;
  }
}
