import { JUDGE, PHYSICS, PLAYER, POSE_GATE, RUN, STAMINA } from '../config/GameConfig';
import { SoundManager } from '../audio/SoundManager';
import { EventBus } from '../core/EventBus';
import { commitHighScore, loadHighScore } from '../core/HighScore';
import type { GameEvents, GameState, GestureEvent, Lane } from '../core/types';
import { CoinManager } from './CoinManager';
import { ObstacleManager } from './ObstacleManager';
import { GameRenderer } from '../graphics/GameRenderer';
import { KeyboardSource } from '../input/KeyboardSource';
import type { ObstacleHandle } from '../physics/PhysicsEngine';
import { PhysicsEngine } from '../physics/PhysicsEngine';
import { CalibrationScreen } from '../ui/CalibrationScreen';
import { DebugOverlay } from '../ui/DebugOverlay';
import { HandCursorOverlay } from '../ui/HandCursorOverlay';
import { HandUiController } from '../ui/HandUiController';
import { HUD } from '../ui/HUD';
import { StartScreen } from '../ui/StartScreen';
import { HandCalibrator } from '../vision/HandCalibrator';
import {
  hasHandProfile,
  loadHandProfile,
  saveHandProfile,
  type HandProfile,
} from '../vision/HandProfile';
import { HandTracker } from '../vision/HandTracker';
import { PoseCalibrator } from '../vision/PoseCalibrator';
import { hasSavedProfile, loadProfile, saveProfile, type PoseProfile } from '../vision/PoseProfile';
import { PoseTracker } from '../vision/PoseTracker';
import { SkeletonOverlay } from '../vision/SkeletonOverlay';
import type * as THREE from 'three/webgpu';

export class GameEngine {
  private readonly container: HTMLElement;
  private readonly hudRoot: HTMLElement;
  private readonly uiRoot: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly cameraStage: HTMLElement;
  private readonly skeletonCanvas: HTMLCanvasElement;
  private readonly forceWebGL: boolean;

  private readonly bus = new EventBus<GameEvents>();
  private renderer: GameRenderer | null = null;
  private physics: PhysicsEngine | null = null;
  private obstacles: ObstacleManager | null = null;
  private coins: CoinManager | null = null;
  private sound: SoundManager | null = null;
  private hud: HUD | null = null;
  private startScreen: StartScreen | null = null;
  private calibrationScreen: CalibrationScreen | null = null;
  private handCalibrationScreen: CalibrationScreen | null = null;
  private handCursor: HandCursorOverlay | null = null;
  private handUi: HandUiController | null = null;
  private keyboard: KeyboardSource | null = null;
  private pose: PoseTracker | null = null;
  private hands: HandTracker | null = null;
  private calibrator: PoseCalibrator | null = null;
  private handCalibrator: HandCalibrator | null = null;
  private skeleton: SkeletonOverlay | null = null;
  private playerMesh: THREE.Object3D | null = null;
  private guardMesh: THREE.Object3D | null = null;
  private profile: PoseProfile | null = null;
  private handProfile: HandProfile | null = null;
  private cameraStream: MediaStream | null = null;

  private state: GameState = 'BOOTING';
  private score = 0;
  private highScore = 0;
  private runSpeed: number = RUN.START_SPEED;
  private runDistance = 0;
  private currentLane: Lane = 0;
  private accumulator = 0;
  private lastTime = 0;
  private loopRunning = false;
  private hitGraceUntil = 0;
  private unsubscribers: Array<() => void> = [];
  private cameraStarting: Promise<void> | null = null;
  private poseStarting: Promise<void> | null = null;
  private handsStarting: Promise<void> | null = null;
  private duckVisual = 0;
  private runBob = 0;

  /** True while playing with motion controls (stamina enabled). */
  private motionMode = false;
  private poseRunActive = false;
  private idleMs: number = STAMINA.IDLE_MS;
  private catchElapsed = 0;
  private gameOverReason: 'obstacle' | 'caught' | 'pose' = 'obstacle';

  /** Action times (performance.now) for the obstacle judgment windows. */
  private lastJumpAt = -Infinity;
  private lastCrouchAt = -Infinity;
  private lastStarJumpAt = -Infinity;
  private lastActionAt = -Infinity;
  private poseCrouchDepth = 0;
  private poseCrouchActive = false;
  private poseCrouchSince = 0;
  private poseCrouchSounded = false;
  /** Hits held open for JUDGE.LATE_MS before they end the run. */
  private pendingHits: Array<{ obstacle: ObstacleHandle; at: number }> = [];
  private starPose = false;
  private starPoseSince = 0;

  constructor(opts: {
    container: HTMLElement;
    hudRoot: HTMLElement;
    uiRoot: HTMLElement;
    video: HTMLVideoElement;
    cameraStage: HTMLElement;
    skeletonCanvas: HTMLCanvasElement;
    forceWebGL: boolean;
  }) {
    this.container = opts.container;
    this.hudRoot = opts.hudRoot;
    this.uiRoot = opts.uiRoot;
    this.video = opts.video;
    this.cameraStage = opts.cameraStage;
    this.skeletonCanvas = opts.skeletonCanvas;
    this.forceWebGL = opts.forceWebGL;
  }

  async init(): Promise<void> {
    this.profile = loadProfile();
    this.handProfile = loadHandProfile();
    this.highScore = loadHighScore();
    this.sound = new SoundManager();

    this.hud = new HUD(this.hudRoot);
    this.hud.onRestart(() => {
      this.sound?.unlock();
      this.restart();
    });
    this.hud.onMainMenu(() => {
      this.sound?.unlock();
      this.returnToMenu();
    });

    this.startScreen = new StartScreen(this.uiRoot);
    this.calibrationScreen = new CalibrationScreen(this.uiRoot);
    this.handCalibrationScreen = new CalibrationScreen(this.uiRoot, 'Hand controls · ');
    this.handCursor = new HandCursorOverlay(this.uiRoot);
    this.handUi = new HandUiController(this.bus, this.handCursor);
    this.calibrator = new PoseCalibrator(this.bus);
    this.handCalibrator = new HandCalibrator(this.bus);
    const debug = new DebugOverlay(this.uiRoot, this.bus, () => this.profile);

    this.startScreen.onPlayKeyboard(() => {
      this.sound?.unlock();
      this.beginRun('keyboard');
    });
    this.startScreen.onPlayMotion(() => {
      this.sound?.unlock();
      void this.beginMotionPlay();
    });
    this.startScreen.onOpenCalibrate(() => {
      this.sound?.unlock();
      void this.beginCalibration();
    });
    this.startScreen.onOpenHandUi(() => {
      this.sound?.unlock();
      void this.beginHandCalibration();
    });
    this.startScreen.onOpenDebug(() => debug.show());

    this.calibrationScreen.onCancelCalib(() => this.calibrator?.cancel());

    this.handCalibrationScreen.onCancelCalib(() => this.handCalibrator?.cancel());

    this.setCameraStage('hidden');
    this.setState('BOOTING');

    const renderer = new GameRenderer(this.container, this.forceWebGL);
    await renderer.init();
    this.renderer = renderer;

    const physics = new PhysicsEngine();
    await physics.init();
    this.physics = physics;

    physics.onPlayerHit((obstacle) => {
      if (this.state !== 'RUNNING') return;
      if (performance.now() < this.hitGraceUntil) return;
      this.handleObstacleHit(obstacle);
    });

    const playerMesh = renderer.createPlayerMesh();
    renderer.add(playerMesh);
    this.playerMesh = playerMesh;

    const guardMesh = renderer.createGuardMesh();
    renderer.add(guardMesh);
    this.guardMesh = guardMesh;

    this.obstacles = new ObstacleManager(physics, renderer);
    this.coins = new CoinManager(physics, renderer);
    this.obstacles.setCoinManager(this.coins);
    this.coins.onCollect((points) => this.handleCoinCollect(points));

    this.keyboard = new KeyboardSource(this.bus);
    await this.keyboard.start();

    this.unsubscribers.push(
      this.bus.on('gesture', (event) => this.handleGesture(event)),
      this.bus.on('poseLane', ({ lane }) => this.handlePoseLane(lane)),
      this.bus.on('poseRun', ({ active }) => {
        this.poseRunActive = active;
      }),
      this.bus.on('poseJump', () => this.handlePoseJump()),
      this.bus.on('poseCrouch', ({ active, depth01 }) => this.handlePoseCrouch(active, depth01)),
      this.bus.on('poseStarJump', () => this.handleStarJump()),
      this.bus.on('status', ({ text }) => this.hud?.setStatus(text)),
      this.bus.on('calibration', (update) => {
        this.calibrationScreen?.update(update);
      }),
      this.bus.on('handCalibration', (update) => {
        this.handCalibrationScreen?.update(update);
      }),
      this.bus.on('poseFrame', ({ landmarks }) => {
        this.skeleton?.draw(landmarks);
      }),
    );

    this.showStartMenu();
  }

  start(): void {
    if (!this.renderer || this.loopRunning) return;
    this.loopRunning = true;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  restart(): void {
    if (!this.physics || !this.obstacles || !this.hud) return;

    this.physics.setHitsEnabled(false);
    this.obstacles.reset();
    this.coins?.reset();
    this.physics.reset();
    this.score = 0;
    this.runSpeed = RUN.START_SPEED;
    this.runDistance = 0;
    this.currentLane = 0;
    this.accumulator = 0;
    this.duckVisual = 0;
    this.runBob = 0;
    this.resetStaminaAndPose();
    this.hideGuard();
    this.hitGraceUntil = performance.now() + 750;
    this.hud.setScore(0);
    if (this.playerMesh) this.playerMesh.scale.set(1, 1, 1);
    this.setState('RUNNING');
    this.syncHandTracking();
    this.physics.setHitsEnabled(true);
    this.setCameraStage(this.cameraStream ? 'corner' : 'hidden');
    this.hud.setStaminaVisible(this.motionMode);
    this.updateStatusLine('Running');
  }

  returnToMenu(): void {
    this.physics?.setHitsEnabled(false);
    this.obstacles?.reset();
    this.coins?.reset();
    this.physics?.reset();
    this.score = 0;
    this.runSpeed = RUN.START_SPEED;
    this.runDistance = 0;
    this.currentLane = 0;
    this.accumulator = 0;
    this.duckVisual = 0;
    this.runBob = 0;
    this.motionMode = false;
    this.resetStaminaAndPose();
    this.hideGuard();
    if (this.playerMesh) this.playerMesh.scale.set(1, 1, 1);
    this.hud?.setScore(0);
    this.hud?.setStaminaVisible(false);
    this.pose?.setDetectionEnabled(false);
    this.showStartMenu();
  }

  dispose(): void {
    this.loopRunning = false;
    this.renderer?.setAnimationLoop(null);
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.calibrator?.cancel();
    this.handCalibrator?.cancel();
    this.handUi?.dispose();
    this.keyboard?.stop();
    this.pose?.stop();
    this.hands?.stop();
    this.stopCamera();
    this.obstacles?.reset();
    this.coins?.reset();
    this.physics?.dispose();
    this.sound?.dispose();
    this.renderer?.dispose();
    this.bus.clear();
  }

  private showStartMenu(): void {
    this.calibrationScreen?.hide();
    this.handCalibrationScreen?.hide();
    this.setCameraStage(this.cameraStream ? 'corner' : 'hidden');
    this.skeleton?.setVisible(false);
    this.setState('START_MENU');
    this.startScreen?.show({
      backend: this.renderer?.backendName ?? '?',
      hasProfile: !!this.profile || hasSavedProfile(),
      hasHandProfile: !!this.handProfile || hasHandProfile(),
      handControlsActive: !!this.hands?.isEnabled(),
      highScore: this.highScore,
    });
    this.hud?.setStatus(`Backend: ${this.renderer?.backendName ?? '?'} · Choose a play mode`);
    this.syncHandTracking();
  }

  private beginRun(mode: 'keyboard' | 'motion'): void {
    this.startScreen?.hide();
    this.calibrationScreen?.hide();
    this.handCalibrationScreen?.hide();
    this.obstacles?.reset();
    this.coins?.reset();
    this.physics?.reset();
    this.score = 0;
    this.runSpeed = RUN.START_SPEED;
    this.runDistance = 0;
    this.currentLane = 0;
    this.accumulator = 0;
    this.duckVisual = 0;
    this.runBob = 0;
    this.motionMode = mode === 'motion';
    this.resetStaminaAndPose();
    this.hideGuard();
    if (this.playerMesh) this.playerMesh.scale.set(1, 1, 1);
    this.hitGraceUntil = performance.now() + 500;
    this.hud?.setScore(0);
    this.hud?.setStaminaVisible(this.motionMode);
    if (this.motionMode) this.hud?.setStamina(1);

    if (mode === 'motion' && this.pose && this.profile) {
      this.pose.setProfile(this.profile);
      this.pose.setDetectionEnabled(true);
      this.setCameraStage('corner');
      this.skeleton?.setVisible(false);
    } else {
      this.pose?.setDetectionEnabled(false);
      this.setCameraStage(this.cameraStream ? 'corner' : 'hidden');
    }

    this.setState('RUNNING');
    this.syncHandTracking();
    this.updateStatusLine('Running');
  }

  private async beginMotionPlay(): Promise<void> {
    try {
      await this.ensurePoseStarted();
    } catch (error) {
      console.warn('[motion] camera unavailable:', error);
      this.hud?.setStatus('Camera unavailable — use keyboard or try again');
      return;
    }

    if (!this.profile) {
      await this.beginCalibration();
      return;
    }

    this.beginRun('motion');
  }

  private async beginCalibration(): Promise<void> {
    try {
      await this.ensurePoseStarted();
    } catch (error) {
      console.warn('[calib] camera unavailable:', error);
      this.hud?.setStatus('Camera unavailable — calibration needs webcam access');
      return;
    }

    if (!this.calibrator || !this.calibrationScreen || !this.pose) return;

    this.startScreen?.hide();
    this.handCalibrationScreen?.hide();
    this.pose.setDetectionEnabled(false);
    this.setCameraStage('center');
    this.skeleton?.setVisible(true);
    this.setState('CALIBRATING');
    this.calibrationScreen.show();
    this.syncHandTracking();

    this.calibrator.start((profile) => {
      this.pose?.setDetectionEnabled(false);
      this.skeleton?.setVisible(false);
      this.calibrationScreen?.hide();

      if (profile) {
        this.profile = profile;
        saveProfile(profile);
        this.pose?.setProfile(profile);
        this.hud?.setStatus('Calibration saved');
      } else {
        this.hud?.setStatus('Calibration cancelled');
      }

      this.showStartMenu();
    });
  }

  private async beginHandCalibration(): Promise<void> {
    // Saved profile + hands not running this session → just enable (reload bootstrap).
    // Saved profile + hands already on → full recalibrate.
    // No profile → full setup.
    const hasProfile = !!this.handProfile || hasHandProfile();
    if (hasProfile && !this.hands?.isEnabled()) {
      try {
        await this.ensureHandsStarted();
      } catch (error) {
        console.warn('[hand-ui] camera unavailable:', error);
        this.hud?.setStatus('Camera unavailable — Hand UI needs webcam access');
        return;
      }
      if (!this.handProfile) this.handProfile = loadHandProfile();
      this.hands?.setProfile(this.handProfile);
      this.setCameraStage('corner');
      this.syncHandTracking();
      this.startScreen?.show({
        backend: this.renderer?.backendName ?? '?',
        hasProfile: !!this.profile || hasSavedProfile(),
        hasHandProfile: true,
        handControlsActive: !!this.hands?.isEnabled(),
        highScore: this.highScore,
      });
      this.hud?.setStatus('Hand controls enabled for menus');
      return;
    }

    try {
      await this.ensureHandsStarted();
    } catch (error) {
      console.warn('[hand-calib] camera unavailable:', error);
      this.hud?.setStatus('Camera unavailable — Hand UI setup needs webcam access');
      return;
    }

    if (!this.handCalibrator || !this.handCalibrationScreen || !this.hands) return;

    this.startScreen?.hide();
    this.calibrationScreen?.hide();
    this.pose?.setDetectionEnabled(false);
    // The skeleton shows which wrist the cursor will follow.
    this.skeleton?.setVisible(true);
    // Fresh setup: drop the previous hand and pinch thresholds.
    this.hands.setProfile(null);
    this.hands.clearSessionHandedness();
    this.setCameraStage('center');
    this.setState('HAND_CALIBRATING');
    this.handCalibrationScreen.show();
    this.syncHandTracking();

    this.handCalibrator.start(
      (profile) => {
        this.handCalibrationScreen?.hide();
        this.skeleton?.setVisible(false);

        if (profile) {
          this.handProfile = profile;
          saveHandProfile(profile);
          this.hands?.setProfile(profile);
          this.hud?.setStatus('Hand UI setup saved');
        } else {
          // Restore previous profile if cancel mid-recalibrate.
          if (this.handProfile) this.hands?.setProfile(this.handProfile);
          this.hud?.setStatus('Hand UI setup cancelled');
        }

        this.showStartMenu();
      },
      (close, open) => {
        this.hands?.setPinchThresholds(close, open);
      },
      (handedness) => {
        this.hands?.lockSessionHandedness(handedness);
      },
    );
  }

  /**
   * Hands only on START_MENU / GAME_OVER / CALIBRATING / HAND_CALIBRATING.
   * Always off during RUNNING. Requires a saved hand profile except mid hand-setup.
   */
  private syncHandTracking(): void {
    const inHandSetup = this.state === 'HAND_CALIBRATING';
    const menuLike =
      this.state === 'START_MENU' ||
      this.state === 'GAME_OVER' ||
      this.state === 'CALIBRATING' ||
      inHandSetup;

    const wantHands =
      this.state !== 'RUNNING' &&
      this.state !== 'CATCHING' &&
      this.hands !== null &&
      (inHandSetup || (menuLike && !!this.handProfile));

    if (!this.hands) {
      this.handUi?.setActive(false);
      this.handCursor?.setVisible(false);
      return;
    }

    this.hands.setEnabled(!!wantHands);

    // Cursor + pinch-click on menu buttons whenever hands are on (incl. setup Cancel/Redo).
    const uiActive = !!wantHands;
    this.handUi?.setActive(uiActive);
    if (!uiActive) {
      this.handCursor?.setVisible(false);
    }
  }

  private async ensureCameraStarted(): Promise<void> {
    if (this.cameraStream) return;
    if (this.cameraStarting) {
      await this.cameraStarting;
      return;
    }

    this.cameraStarting = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 60 },
        },
      });
      this.cameraStream = stream;
      this.video.srcObject = stream;
      await this.video.play();
    })();

    try {
      await this.cameraStarting;
    } finally {
      this.cameraStarting = null;
    }
  }

  private stopCamera(): void {
    if (this.cameraStream) {
      for (const track of this.cameraStream.getTracks()) track.stop();
      this.cameraStream = null;
    }
    this.video.srcObject = null;
  }

  private async ensurePoseStarted(): Promise<void> {
    await this.ensureCameraStarted();
    if (this.pose) return;
    if (this.poseStarting) {
      await this.poseStarting;
      return;
    }

    this.poseStarting = (async () => {
      const tracker = new PoseTracker(this.video, this.bus);
      tracker.setHandSideSource(() => this.hands?.requestedHand() ?? null);
      if (this.profile) tracker.setProfile(this.profile);
      await tracker.start();
      this.pose = tracker;
      this.skeleton = new SkeletonOverlay(this.skeletonCanvas, this.video);
      this.skeleton.setVisible(false);
    })();

    try {
      await this.poseStarting;
    } finally {
      this.poseStarting = null;
    }
  }

  /** The hand cursor follows the body tracker's wrist, so pose tracking starts too. */
  private async ensureHandsStarted(): Promise<void> {
    await this.ensurePoseStarted();
    if (this.hands) return;
    if (this.handsStarting) {
      await this.handsStarting;
      return;
    }

    this.handsStarting = (async () => {
      const tracker = new HandTracker(this.bus);
      if (this.handProfile) tracker.setProfile(this.handProfile);
      await tracker.start();
      this.hands = tracker;
    })();

    try {
      await this.handsStarting;
    } finally {
      this.handsStarting = null;
    }
  }

  private setCameraStage(mode: 'hidden' | 'corner' | 'center'): void {
    this.cameraStage.classList.remove('stage-hidden', 'stage-corner', 'stage-center');
    this.cameraStage.classList.add(`stage-${mode}`);
  }

  private updateStatusLine(suffix?: string): void {
    const backend = this.renderer?.backendName ?? '?';
    const input = this.pose && this.profile ? 'keyboard + pose' : 'keyboard';
    const extra = suffix ? ` · ${suffix}` : '';
    this.hud?.setStatus(`Backend: ${backend} · Input: ${input}${extra}`);
  }

  private handleCoinCollect(points: number): void {
    if (this.state !== 'RUNNING') return;
    this.score += points;
    this.hud?.setScore(this.score);
    this.bus.emit('coin', { value: points, total: this.score });
    this.bus.emit('score', { value: this.score });
    this.sound?.playCoin();
  }

  private handleObstacleHit(obstacle: ObstacleHandle): void {
    const now = performance.now();
    if (this.motionMode) {
      // Body and camera delay: give the needed action a short window to land.
      this.pendingHits.push({ obstacle, at: now });
      this.resolvePendingHits(now);
      return;
    }
    if (obstacle.kind === 'poseStar' && this.actionCovers('poseStar', now)) {
      this.obstacles?.clearObstacle(obstacle.id);
      this.sound?.playCoin();
      return;
    }
    this.gameOverReason = obstacle.kind === 'poseStar' ? 'pose' : 'obstacle';
    this.handleGameOver();
  }

  /** Did the action this obstacle needs happen in its window around the hit time? */
  private actionCovers(kind: ObstacleHandle['kind'], hitAt: number): boolean {
    switch (kind) {
      case 'high':
        return this.lastJumpAt >= hitAt - JUDGE.JUMP_EARLY_MS;
      case 'low':
        return this.lastCrouchAt >= hitAt - JUDGE.CROUCH_EARLY_MS || !!this.physics?.isDucking();
      case 'poseStar':
        return this.lastStarJumpAt >= hitAt - JUDGE.STAR_EARLY_MS;
    }
  }

  private resolvePendingHits(now: number): void {
    if (this.pendingHits.length === 0) return;
    const open: typeof this.pendingHits = [];
    for (const hit of this.pendingHits) {
      if (this.actionCovers(hit.obstacle.kind, hit.at)) {
        this.obstacles?.clearObstacle(hit.obstacle.id);
        if (hit.obstacle.kind === 'poseStar') this.sound?.playCoin();
        continue;
      }
      if (now - hit.at >= JUDGE.LATE_MS) {
        this.pendingHits = [];
        this.gameOverReason = hit.obstacle.kind === 'poseStar' ? 'pose' : 'obstacle';
        this.handleGameOver();
        return;
      }
      open.push(hit);
    }
    this.pendingHits = open;
  }

  private handleGameOver(): void {
    if (this.state === 'GAME_OVER') return;
    this.hideGuard();
    const result = commitHighScore(this.score);
    this.highScore = result.highScore;
    const messages = {
      obstacle: { title: 'Game Over', message: 'You hit an obstacle.' },
      caught: { title: 'Caught!', message: 'Keep running in place!' },
      pose: { title: 'Game Over', message: 'Star gate: jump with arms and legs out.' },
    } as const;
    const copy = messages[this.gameOverReason];
    this.hud?.setGameOverScores({
      score: this.score,
      highScore: result.highScore,
      isNewHigh: result.isNew,
      title: copy.title,
      message: copy.message,
    });
    this.sound?.playDeath();
    this.setState('GAME_OVER');
    this.syncHandTracking();
  }

  private beginCatchSequence(): void {
    if (this.state !== 'RUNNING') return;
    this.catchElapsed = 0;
    this.gameOverReason = 'caught';
    this.runSpeed *= STAMINA.SLOW_FACTOR;
    if (this.guardMesh && this.playerMesh) {
      const p = this.physics?.playerPosition() ?? { x: 0, y: PLAYER.START_Y, z: 0 };
      this.guardMesh.visible = true;
      this.guardMesh.position.set(p.x + 1.2, 0, p.z + 4);
    }
    this.setState('CATCHING');
    this.syncHandTracking();
  }

  private updateCatch(dt: number): void {
    this.catchElapsed += dt * 1000;
    if (this.guardMesh && this.playerMesh) {
      const p = this.playerMesh.position;
      const g = this.guardMesh.position;
      const t = Math.min(1, this.catchElapsed / STAMINA.CATCH_MS);
      g.x += (p.x + 0.35 - g.x) * Math.min(1, dt * 6);
      g.z += (p.z + 0.6 - g.z) * Math.min(1, dt * 6);
      g.y = 0;
      // Nudge player slightly
      this.playerMesh.position.x += (g.x - 0.4 - this.playerMesh.position.x) * t * 0.05;
    }
    if (this.catchElapsed >= STAMINA.CATCH_MS) {
      this.handleGameOver();
    }
  }

  private updateStamina(dt: number): void {
    if (!this.motionMode || this.state !== 'RUNNING') return;

    const recentAction = performance.now() - this.lastActionAt < JUDGE.ACTIVITY_MS;
    const running = this.poseRunActive || recentAction || this.starPose;

    if (running) {
      this.idleMs = Math.min(
        STAMINA.IDLE_MS,
        this.idleMs + dt * 1000 * STAMINA.REFILL_RATE,
      );
    } else {
      this.idleMs -= dt * 1000;
      if (this.idleMs <= 0) {
        this.idleMs = 0;
        this.beginCatchSequence();
        return;
      }
    }

    this.hud?.setStamina(this.idleMs / STAMINA.IDLE_MS);
  }

  /** A recent star jump clears the star gate in your lane as it arrives. */
  private updatePoseGates(): void {
    if (this.state !== 'RUNNING' || !this.obstacles) return;
    if (performance.now() - this.lastStarJumpAt > JUDGE.STAR_EARLY_MS) return;
    for (const gate of this.obstacles.getActivePoseGates()) {
      if (Math.abs(gate.z) > POSE_GATE.WINDOW_Z) continue;
      if (gate.lane !== this.currentLane) continue;
      this.obstacles.clearObstacle(gate.id);
      this.sound?.playCoin();
    }
  }

  private setStarPose(on: boolean): void {
    if (this.starPose === on) return;
    this.starPose = on;
    this.starPoseSince = performance.now();
    if (this.playerMesh && this.renderer) {
      this.renderer.applyPlayerStarPose(this.playerMesh, on);
    }
  }

  private handlePoseJump(): void {
    if (this.state !== 'RUNNING' || !this.physics) return;
    const now = performance.now();
    this.lastJumpAt = now;
    this.lastActionAt = now;
    if (this.physics.jump()) this.sound?.playJump();
  }

  private handlePoseCrouch(active: boolean, depth01: number): void {
    if (this.state !== 'RUNNING' || !this.physics) {
      this.poseCrouchDepth = 0;
      this.poseCrouchActive = false;
      return;
    }
    this.poseCrouchDepth = depth01;
    const now = performance.now();
    if (active) {
      if (!this.poseCrouchActive) {
        this.poseCrouchSince = now;
        this.poseCrouchSounded = false;
      }
      // A jump wind-up crouches for a frame or two; only a held duck gets the sound.
      if (!this.poseCrouchSounded && now - this.poseCrouchSince >= 150) {
        this.poseCrouchSounded = true;
        this.sound?.playDuck();
      }
      this.lastCrouchAt = now;
      this.lastActionAt = now;
    }
    this.poseCrouchActive = active;
    this.physics.setCrouch(active);
  }

  /** Pose star jump or keyboard J: jump with the star shape. */
  private handleStarJump(): void {
    if (this.state !== 'RUNNING' || !this.physics) return;
    const now = performance.now();
    this.lastStarJumpAt = now;
    this.lastJumpAt = now;
    this.lastActionAt = now;
    if (this.physics.jump()) this.sound?.playJump();
    this.setStarPose(true);
    this.updatePoseGates();
  }

  private resetStaminaAndPose(): void {
    this.idleMs = STAMINA.IDLE_MS;
    this.poseRunActive = false;
    this.catchElapsed = 0;
    this.gameOverReason = 'obstacle';
    this.lastJumpAt = -Infinity;
    this.lastCrouchAt = -Infinity;
    this.lastStarJumpAt = -Infinity;
    this.lastActionAt = -Infinity;
    this.poseCrouchDepth = 0;
    this.poseCrouchActive = false;
    this.pendingHits = [];
    this.physics?.setCrouch(false);
    this.setStarPose(false);
    this.hud?.setStamina(1);
  }

  private hideGuard(): void {
    if (this.guardMesh) {
      this.guardMesh.visible = false;
    }
  }

  private tick(): void {
    const renderer = this.renderer;
    const physics = this.physics;
    const obstacles = this.obstacles;
    if (!renderer || !physics || !obstacles) return;

    const now = performance.now();
    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameDt > PHYSICS.MAX_FRAME_DT) frameDt = PHYSICS.MAX_FRAME_DT;

    if (this.state === 'RUNNING') {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= PHYSICS.FIXED_DT && steps < PHYSICS.MAX_STEPS_PER_FRAME) {
        physics.updatePlayer(PHYSICS.FIXED_DT);
        physics.step();
        this.accumulator -= PHYSICS.FIXED_DT;
        steps += 1;
      }

      this.runSpeed = Math.min(RUN.MAX_SPEED, this.runSpeed + RUN.ACCEL * frameDt);
      this.runDistance += this.runSpeed * frameDt;

      obstacles.update(frameDt, this.runSpeed, this.runDistance);
      this.coins?.update(frameDt, this.runSpeed);
      renderer.scrollTrack(this.runSpeed * frameDt);
      this.runBob += frameDt * 10;

      this.resolvePendingHits(now);
      this.updateStamina(frameDt);
      this.updatePoseGates();
    } else if (this.state === 'CATCHING') {
      physics.updatePlayer(PHYSICS.FIXED_DT);
      physics.step();
      obstacles.update(frameDt, this.runSpeed, this.runDistance);
      renderer.scrollTrack(this.runSpeed * frameDt);
      this.updateCatch(frameDt);
    } else if (this.state === 'GAME_OVER' || this.state === 'START_MENU') {
      physics.updatePlayer(PHYSICS.FIXED_DT);
      physics.step();
    }

    if (this.starPose) {
      const held = now - this.starPoseSince;
      if ((held > 250 && physics.isGrounded()) || held > 1500) this.setStarPose(false);
    }

    // Duck visual follows the physics duck, and in motion mode your crouch depth.
    const poseDepth = this.motionMode && this.state === 'RUNNING' ? this.poseCrouchDepth : 0;
    const duckTarget = Math.max(physics.isDucking() ? 1 : 0, poseDepth);
    const duckLerp = 1 - Math.exp(-PLAYER.DUCK_VISUAL_LERP_SPEED * frameDt);
    this.duckVisual += (duckTarget - this.duckVisual) * duckLerp;

    this.syncPlayerMesh();
    renderer.render();
  }

  private syncPlayerMesh(): void {
    if (!this.playerMesh || !this.physics) return;
    const p = this.physics.playerPosition();
    const bob =
      this.state === 'RUNNING' &&
      this.duckVisual < 0.2 &&
      !this.starPose &&
      p.y < PLAYER.START_Y + 0.15
        ? Math.sin(this.runBob) * 0.04
        : 0;
    this.playerMesh.position.set(p.x, p.y + bob, p.z);

    const scaleY = 1 - this.duckVisual * (1 - PLAYER.DUCK_VISUAL_SCALE_Y);
    this.playerMesh.scale.set(1, scaleY, 1);
  }

  private handlePoseLane(lane: Lane): void {
    // Pose gestures during calibration must not drive gameplay.
    if (this.state !== 'RUNNING' || !this.physics) return;
    if (lane !== this.currentLane) {
      this.sound?.playLane();
    }
    this.currentLane = lane;
    this.physics.setTargetLane(lane);
  }

  private handleGesture(event: GestureEvent): void {
    if (this.state === 'GAME_OVER') {
      if (event.gesture === 'JUMP') this.restart();
      return;
    }

    if (this.state !== 'RUNNING' || !this.physics) return;

    switch (event.gesture) {
      case 'MOVE_LEFT': {
        const next = Math.max(-1, this.currentLane - 1) as Lane;
        if (next !== this.currentLane) this.sound?.playLane();
        this.currentLane = next;
        this.physics.setTargetLane(this.currentLane);
        break;
      }
      case 'MOVE_RIGHT': {
        const next = Math.min(1, this.currentLane + 1) as Lane;
        if (next !== this.currentLane) this.sound?.playLane();
        this.currentLane = next;
        this.physics.setTargetLane(this.currentLane);
        break;
      }
      case 'JUMP':
        if (this.physics.jump()) this.sound?.playJump();
        break;
      case 'DUCK':
        if (!this.physics.isDucking()) this.sound?.playDuck();
        this.physics.startDuck();
        this.lastCrouchAt = performance.now();
        break;
      case 'STAR_JUMP':
        this.handleStarJump();
        break;
    }
  }

  private setState(next: GameState): void {
    const from = this.state;
    this.state = next;
    this.hud?.setState(next);
    if (from !== next) {
      this.bus.emit('state', { from, to: next });
    }
  }
}
