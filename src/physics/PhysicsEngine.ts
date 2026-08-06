import RAPIER from '@dimforge/rapier3d-compat';
import { OBSTACLES, PHYSICS, PLAYER, TRACK } from '../config/GameConfig';
import type { Lane, ObstacleKind } from '../core/types';

export interface ObstacleHandle {
  id: number;
  kind: ObstacleKind;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export class PhysicsEngine {
  private world: RAPIER.World | null = null;
  private eventQueue: RAPIER.EventQueue | null = null;
  private playerBody: RAPIER.RigidBody | null = null;
  private playerCollider: RAPIER.Collider | null = null;

  private targetLane: Lane = 0;
  private duckRemainingMs = 0;
  private nextObstacleId = 1;
  private readonly obstaclesByCollider = new Map<number, ObstacleHandle>();
  private readonly activeObstacles = new Set<ObstacleHandle>();
  private hitCallback: ((obstacle: ObstacleHandle) => void) | null = null;
  private standingHalfHeight = PLAYER.HALF_HEIGHT;
  private hitsEnabled = true;

  async init(): Promise<void> {
    await RAPIER.init();

    const world = new RAPIER.World({ x: 0, y: PHYSICS.GRAVITY_Y, z: 0 });
    world.timestep = PHYSICS.FIXED_DT;
    this.world = world;
    this.eventQueue = new RAPIER.EventQueue(true);

    const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(TRACK.LANE_COUNT * TRACK.LANE_WIDTH, 0.5, TRACK.LENGTH).setFriction(0.9),
      groundBody,
    );

    this.createPlayer();
  }

  step(): void {
    const world = this.world;
    const queue = this.eventQueue;
    if (!world || !queue) return;

    world.step(queue);
    queue.drainCollisionEvents((h1, h2, started) => {
      if (!started || !this.playerCollider) return;
      const playerHandle = this.playerCollider.handle;
      let other = -1;
      if (h1 === playerHandle) other = h2;
      else if (h2 === playerHandle) other = h1;
      else return;

      if (!this.hitsEnabled) return;
      const obstacle = this.obstaclesByCollider.get(other);
      if (obstacle) {
        this.hitCallback?.(obstacle);
      }
    });
  }

  setHitsEnabled(enabled: boolean): void {
    this.hitsEnabled = enabled;
  }

  onPlayerHit(cb: (obstacle: ObstacleHandle) => void): void {
    this.hitCallback = cb;
  }

  playerPosition(): { x: number; y: number; z: number } {
    const p = this.playerBody?.translation();
    return p ? { x: p.x, y: p.y, z: p.z } : { x: 0, y: PLAYER.START_Y, z: 0 };
  }

  setTargetLane(lane: Lane): void {
    this.targetLane = lane;
  }

  jump(): boolean {
    const body = this.playerBody;
    const collider = this.playerCollider;
    const world = this.world;
    if (!body || !collider || !world) return false;
    if (!this.isGrounded()) return false;

    body.applyImpulse({ x: 0, y: PLAYER.JUMP_VELOCITY * body.mass(), z: 0 }, true);
    return true;
  }

  startDuck(): void {
    const collider = this.playerCollider;
    const body = this.playerBody;
    if (!collider || !body) return;

    this.duckRemainingMs = PLAYER.DUCK_MS;
    collider.setHalfHeight(PLAYER.DUCK_HALF_HEIGHT);

    // Keep feet on the ground when shrinking the capsule.
    // Copy components — Rapier Vectors must not be held across mutating calls.
    const { x, y, z } = body.translation();
    const duckedCenterY = PLAYER.RADIUS + PLAYER.DUCK_HALF_HEIGHT;
    if (y <= duckedCenterY + 0.05) {
      body.setTranslation({ x, y: duckedCenterY, z }, true);
    }
  }

  isDucking(): boolean {
    return this.duckRemainingMs > 0;
  }

  updatePlayer(dt: number): void {
    const body = this.playerBody;
    const collider = this.playerCollider;
    if (!body || !collider) return;

    if (this.duckRemainingMs > 0) {
      this.duckRemainingMs -= dt * 1000;
      if (this.duckRemainingMs <= 0) {
        this.duckRemainingMs = 0;
        collider.setHalfHeight(this.standingHalfHeight);
      }
    }

    const targetX = this.targetLane * TRACK.LANE_WIDTH;
    const { x, y } = body.translation();
    const { y: velY } = body.linvel();
    const error = targetX - x;
    let vx = error * PLAYER.LANE_GAIN;
    if (vx > PLAYER.LANE_MAX_SPEED) vx = PLAYER.LANE_MAX_SPEED;
    if (vx < -PLAYER.LANE_MAX_SPEED) vx = -PLAYER.LANE_MAX_SPEED;

    // Soft clamp near the target to avoid oscillation.
    if (Math.abs(error) < 0.02) {
      vx = 0;
      body.setTranslation({ x: targetX, y, z: 0 }, true);
    }

    body.setLinvel({ x: vx, y: velY, z: 0 }, true);
  }

  spawnObstacle(lane: Lane, z: number, kind: ObstacleKind): ObstacleHandle {
    const world = this.world;
    if (!world) {
      throw new Error('PhysicsEngine not initialized');
    }

    const spec = kind === 'high' ? OBSTACLES.HIGH : OBSTACLES.LOW;
    const x = lane * TRACK.LANE_WIDTH;
    const y = spec.centreY;

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.w * 0.5, spec.h * 0.5, spec.d * 0.5)
        .setSensor(true)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );

    const handle: ObstacleHandle = {
      id: this.nextObstacleId++,
      kind,
      body,
      collider,
    };
    this.obstaclesByCollider.set(collider.handle, handle);
    this.activeObstacles.add(handle);
    return handle;
  }

  moveObstacle(o: ObstacleHandle, z: number): void {
    if (!this.activeObstacles.has(o)) return;
    const { x, y } = o.body.translation();
    o.body.setNextKinematicTranslation({ x, y, z });
  }

  despawnObstacle(o: ObstacleHandle): void {
    const world = this.world;
    if (!world) return;
    // Idempotent: ObstacleManager and PhysicsEngine must not double-remove.
    if (!this.activeObstacles.has(o)) return;
    this.obstaclesByCollider.delete(o.collider.handle);
    this.activeObstacles.delete(o);
    world.removeRigidBody(o.body);
  }

  /** Resets player pose/state only. Obstacle lifecycle is owned by ObstacleManager. */
  reset(): void {
    this.targetLane = 0;
    this.duckRemainingMs = 0;
    this.hitsEnabled = true;
    this.eventQueue?.clear();

    const body = this.playerBody;
    const collider = this.playerCollider;
    if (!body || !collider) return;

    collider.setHalfHeight(this.standingHalfHeight);
    body.setTranslation({ x: 0, y: PLAYER.START_Y, z: 0 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  dispose(): void {
    for (const obstacle of [...this.activeObstacles]) {
      this.despawnObstacle(obstacle);
    }
    this.eventQueue?.free();
    this.eventQueue = null;
    this.world?.free();
    this.world = null;
    this.playerBody = null;
    this.playerCollider = null;
    this.hitCallback = null;
  }

  private createPlayer(): void {
    const world = this.world;
    if (!world) return;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, PLAYER.START_Y, 0)
      .lockRotations()
      .setLinearDamping(0)
      .setCanSleep(false);
    const body = world.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.capsule(PLAYER.HALF_HEIGHT, PLAYER.RADIUS).setFriction(0.2);
    const collider = world.createCollider(colDesc, body);

    this.playerBody = body;
    this.playerCollider = collider;
    this.standingHalfHeight = PLAYER.HALF_HEIGHT;
  }

  private isGrounded(): boolean {
    const body = this.playerBody;
    const collider = this.playerCollider;
    const world = this.world;
    if (!body || !collider || !world) return false;

    const p = body.translation();
    const halfHeight =
      this.duckRemainingMs > 0 ? PLAYER.DUCK_HALF_HEIGHT : this.standingHalfHeight;
    const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
    const maxToi = halfHeight + PLAYER.RADIUS + PHYSICS.GROUND_RAY_SKIN;
    const hit = world.castRay(ray, maxToi, true, undefined, undefined, collider);
    return hit !== null;
  }
}
