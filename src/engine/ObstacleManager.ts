import { OBSTACLES, TRACK } from '../config/GameConfig';
import type { Lane, ObstacleKind } from '../core/types';
import type { GameRenderer } from '../graphics/GameRenderer';
import type { ObstacleHandle, PhysicsEngine } from '../physics/PhysicsEngine';
import type * as THREE from 'three/webgpu';

interface PooledObstacle {
  handle: ObstacleHandle | null;
  mesh: THREE.Mesh;
  kind: ObstacleKind;
  z: number;
  active: boolean;
}

export class ObstacleManager {
  private readonly physics: PhysicsEngine;
  private readonly pool: PooledObstacle[] = [];
  private distanceSinceSpawn = 0;
  private nextGap = 0;

  constructor(physics: PhysicsEngine, renderer: GameRenderer) {
    this.physics = physics;

    for (let i = 0; i < OBSTACLES.POOL_SIZE; i++) {
      const kind: ObstacleKind = i % 2 === 0 ? 'high' : 'low';
      const mesh = renderer.createObstacleMesh(kind);
      renderer.add(mesh);
      this.pool.push({
        handle: null,
        mesh,
        kind,
        z: OBSTACLES.SPAWN_Z,
        active: false,
      });
    }

    this.nextGap = OBSTACLES.FIRST_GAP;
  }

  update(dt: number, runSpeed: number): void {
    const travel = runSpeed * dt;
    this.distanceSinceSpawn += travel;

    for (const item of this.pool) {
      if (!item.active || !item.handle) continue;
      item.z += travel;
      this.physics.moveObstacle(item.handle, item.z);
      const t = item.handle.body.translation();
      item.mesh.position.set(t.x, t.y, item.z);
      item.mesh.visible = true;

      if (item.z >= OBSTACLES.DESPAWN_Z) {
        this.recycle(item);
      }
    }

    if (this.distanceSinceSpawn >= this.nextGap) {
      this.trySpawn();
      this.distanceSinceSpawn = 0;
      this.nextGap = this.randomGap();
    }
  }

  reset(): void {
    for (const item of this.pool) {
      if (item.active) this.recycle(item);
    }
    this.distanceSinceSpawn = 0;
    this.nextGap = OBSTACLES.FIRST_GAP;
  }

  private trySpawn(): void {
    const preferredKind: ObstacleKind = Math.random() < 0.55 ? 'high' : 'low';
    const free =
      this.pool.find((item) => !item.active && item.kind === preferredKind) ??
      this.pool.find((item) => !item.active);
    if (!free) return;

    const lane = (Math.floor(Math.random() * 3) - 1) as Lane;
    const spec = free.kind === 'high' ? OBSTACLES.HIGH : OBSTACLES.LOW;
    const handle = this.physics.spawnObstacle(lane, OBSTACLES.SPAWN_Z, free.kind);

    free.handle = handle;
    free.z = OBSTACLES.SPAWN_Z;
    free.active = true;
    free.mesh.visible = true;
    free.mesh.position.set(lane * TRACK.LANE_WIDTH, spec.centreY, free.z);
  }

  private recycle(item: PooledObstacle): void {
    if (item.handle) {
      this.physics.despawnObstacle(item.handle);
      item.handle = null;
    }
    item.active = false;
    item.mesh.visible = false;
  }

  private randomGap(): number {
    return OBSTACLES.MIN_GAP + Math.random() * (OBSTACLES.MAX_GAP - OBSTACLES.MIN_GAP);
  }
}
