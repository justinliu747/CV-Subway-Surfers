import { COIN, OBSTACLES, TRACK } from '../config/GameConfig';
import type { Lane, ObstacleKind } from '../core/types';
import type { CoinManager } from './CoinManager';
import type { GameRenderer } from '../graphics/GameRenderer';
import type { ObstacleHandle, PhysicsEngine } from '../physics/PhysicsEngine';
import type * as THREE from 'three/webgpu';

interface PooledObstacle {
  handle: ObstacleHandle | null;
  mesh: THREE.Object3D;
  kind: ObstacleKind;
  z: number;
  active: boolean;
  /** Cleared once the player successfully poses through a gate. */
  gateCleared: boolean;
}

type PatternId =
  | 'single'
  | 'doubleLane'
  | 'jumpDuck'
  | 'wallGap'
  | 'mixedGate'
  | 'poseGate';

interface SpawnPiece {
  lane: Lane;
  kind: ObstacleKind;
  zOffset: number;
}

const ALL_LANES: Lane[] = [-1, 0, 1];
const KIND_CYCLE: ObstacleKind[] = ['high', 'low', 'poseStar'];

export class ObstacleManager {
  private readonly physics: PhysicsEngine;
  private readonly pool: PooledObstacle[] = [];
  private distanceSinceSpawn = 0;
  private nextGap = 0;
  private firstSpawn = true;
  private coins: CoinManager | null = null;
  private runDistance = 0;

  constructor(physics: PhysicsEngine, renderer: GameRenderer) {
    this.physics = physics;

    for (let i = 0; i < OBSTACLES.POOL_SIZE; i++) {
      const kind = KIND_CYCLE[i % KIND_CYCLE.length]!;
      const mesh = renderer.createObstacleMesh(kind);
      renderer.add(mesh);
      this.pool.push({
        handle: null,
        mesh,
        kind,
        z: OBSTACLES.SPAWN_Z,
        active: false,
        gateCleared: false,
      });
    }

    this.nextGap = OBSTACLES.FIRST_GAP;
  }

  setCoinManager(coins: CoinManager): void {
    this.coins = coins;
  }

  update(dt: number, runSpeed: number, distance: number): void {
    const travel = runSpeed * dt;
    this.runDistance = distance;
    this.distanceSinceSpawn += travel;

    for (const item of this.pool) {
      if (!item.active || !item.handle) continue;
      item.z += travel;
      this.physics.moveObstacle(item.handle, item.z);
      const t = item.handle.body.translation();
      item.mesh.position.set(t.x, 0, item.z);
      item.mesh.visible = true;

      if (item.z >= OBSTACLES.DESPAWN_Z) {
        this.recycle(item);
      }
    }

    if (this.distanceSinceSpawn >= this.nextGap) {
      this.trySpawnPattern();
      this.distanceSinceSpawn = 0;
      this.nextGap = this.randomGap();
    }
  }

  /** Active star gates for pass-window checks. */
  getActivePoseGates(): Array<{ lane: Lane; z: number; id: number }> {
    const out: Array<{ lane: Lane; z: number; id: number }> = [];
    for (const item of this.pool) {
      if (!item.active || !item.handle || item.gateCleared) continue;
      if (item.kind !== 'poseStar') continue;
      const t = item.handle.body.translation();
      out.push({
        lane: Math.round(t.x / TRACK.LANE_WIDTH) as Lane,
        z: item.z,
        id: item.handle.id,
      });
    }
    return out;
  }

  /** Remove an obstacle the player passed: a cleared star gate or a forgiven hit. */
  clearObstacle(id: number): void {
    for (const item of this.pool) {
      if (item.handle?.id === id) {
        item.gateCleared = true;
        this.physics.despawnObstacle(item.handle);
        item.handle = null;
        item.mesh.visible = false;
        item.active = false;
        return;
      }
    }
  }

  reset(): void {
    for (const item of this.pool) {
      if (item.active) this.recycle(item);
    }
    this.distanceSinceSpawn = 0;
    this.nextGap = OBSTACLES.FIRST_GAP;
    this.firstSpawn = true;
    this.runDistance = 0;
  }

  private difficulty(): number {
    return Math.min(1, this.runDistance / OBSTACLES.DIFFICULTY_DISTANCE);
  }

  private randomGap(): number {
    const t = this.difficulty();
    const min = OBSTACLES.MIN_GAP_EASY + (OBSTACLES.MIN_GAP_HARD - OBSTACLES.MIN_GAP_EASY) * t;
    const max = OBSTACLES.MAX_GAP_EASY + (OBSTACLES.MAX_GAP_HARD - OBSTACLES.MAX_GAP_EASY) * t;
    return min + Math.random() * (max - min);
  }

  private trySpawnPattern(): void {
    const pattern = this.firstSpawn ? 'single' : this.pickPattern();
    this.firstSpawn = false;

    const pieces = this.buildPattern(pattern);
    let spawnedAny = false;

    for (const piece of pieces) {
      if (!this.spawnPiece(piece.lane, piece.kind, OBSTACLES.SPAWN_Z + piece.zOffset)) {
        continue;
      }
      spawnedAny = true;
    }

    if (!spawnedAny) return;

    const blockedAtZero = new Set(
      pieces.filter((p) => p.zOffset === 0).map((p) => p.lane),
    );
    const freeLanes = ALL_LANES.filter((l) => !blockedAtZero.has(l));
    const coinLanes =
      freeLanes.length > 0
        ? freeLanes
        : [ALL_LANES[Math.floor(Math.random() * 3)] as Lane];

    this.coins?.spawnLine(
      coinLanes,
      OBSTACLES.SPAWN_Z - COIN.PATTERN_OFFSET,
      2 + Math.floor(this.difficulty() * 2),
    );
  }

  private pickPattern(): PatternId {
    const t = this.difficulty();
    const roll = Math.random();

    if (t < 0.2) {
      return roll < 0.75 ? 'single' : 'doubleLane';
    }
    if (t < 0.45) {
      if (roll < 0.35) return 'single';
      if (roll < 0.6) return 'doubleLane';
      if (roll < 0.8) return 'jumpDuck';
      if (roll < 0.9) return 'wallGap';
      return 'poseGate';
    }
    if (t < 0.75) {
      if (roll < 0.15) return 'single';
      if (roll < 0.3) return 'doubleLane';
      if (roll < 0.45) return 'jumpDuck';
      if (roll < 0.6) return 'wallGap';
      if (roll < 0.75) return 'mixedGate';
      return 'poseGate';
    }
    if (roll < 0.08) return 'single';
    if (roll < 0.22) return 'doubleLane';
    if (roll < 0.38) return 'jumpDuck';
    if (roll < 0.55) return 'wallGap';
    if (roll < 0.7) return 'mixedGate';
    return 'poseGate';
  }

  private buildPattern(pattern: PatternId): SpawnPiece[] {
    const shuffle = <T,>(arr: T[]): T[] => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = copy[i]!;
        copy[i] = copy[j]!;
        copy[j] = tmp;
      }
      return copy;
    };

    const randomKind = (): ObstacleKind => (Math.random() < 0.55 ? 'high' : 'low');

    switch (pattern) {
      case 'single': {
        const lane = ALL_LANES[Math.floor(Math.random() * 3)] as Lane;
        return [{ lane, kind: randomKind(), zOffset: 0 }];
      }
      case 'doubleLane': {
        const lanes = shuffle(ALL_LANES).slice(0, 2) as Lane[];
        const kind = randomKind();
        return lanes.map((lane) => ({ lane, kind, zOffset: 0 }));
      }
      case 'jumpDuck': {
        const lane = ALL_LANES[Math.floor(Math.random() * 3)] as Lane;
        const first: ObstacleKind = Math.random() < 0.5 ? 'high' : 'low';
        const second: ObstacleKind = first === 'high' ? 'low' : 'high';
        return [
          { lane, kind: first, zOffset: 0 },
          { lane, kind: second, zOffset: -OBSTACLES.COMBO_Z_OFFSET },
        ];
      }
      case 'wallGap': {
        const open = ALL_LANES[Math.floor(Math.random() * 3)] as Lane;
        return ALL_LANES.filter((l) => l !== open).map((lane) => ({
          lane,
          kind: 'high' as ObstacleKind,
          zOffset: 0,
        }));
      }
      case 'mixedGate': {
        const lanes = shuffle(ALL_LANES);
        return [
          { lane: lanes[0]!, kind: 'high', zOffset: 0 },
          { lane: lanes[1]!, kind: 'low', zOffset: 0 },
        ];
      }
      case 'poseGate': {
        const lane = ALL_LANES[Math.floor(Math.random() * 3)] as Lane;
        return [{ lane, kind: 'poseStar', zOffset: 0 }];
      }
    }
  }

  private spawnPiece(lane: Lane, kind: ObstacleKind, z: number): boolean {
    const free =
      this.pool.find((item) => !item.active && item.kind === kind) ??
      this.pool.find((item) => !item.active);
    if (!free || free.kind !== kind) return false;

    const handle = this.physics.spawnObstacle(lane, z, kind);
    free.handle = handle;
    free.z = z;
    free.active = true;
    free.gateCleared = false;
    free.mesh.visible = true;
    free.mesh.position.set(lane * TRACK.LANE_WIDTH, 0, z);
    return true;
  }

  private recycle(item: PooledObstacle): void {
    if (item.handle) {
      this.physics.despawnObstacle(item.handle);
      item.handle = null;
    }
    item.active = false;
    item.gateCleared = false;
    item.mesh.visible = false;
  }
}
