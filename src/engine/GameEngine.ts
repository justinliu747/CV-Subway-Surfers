import { PHYSICS, RUN } from '../config/GameConfig';
import { EventBus } from '../core/EventBus';
import type { GameEvents, GameState, GestureEvent, Lane } from '../core/types';
import { ObstacleManager } from './ObstacleManager';
import { GameRenderer } from '../graphics/GameRenderer';
import { KeyboardSource } from '../input/KeyboardSource';
import { PhysicsEngine } from '../physics/PhysicsEngine';
import { CalibrationScreen } from '../ui/CalibrationScreen';
import { HUD } from '../ui/HUD';
import { StartScreen } from '../ui/StartScreen';
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
  private hud: HUD | null = null;
  private startScreen: StartScreen | null = null;
  private calibrationScreen: CalibrationScreen | null = null;
  private keyboard: KeyboardSource | null = null;
  private pose: PoseTracker | null = null;
  private calibrator: PoseCalibrator | null = null;
  private skeleton: SkeletonOverlay | null = null;
  private playerMesh: THREE.Mesh | null = null;
  private profile: PoseProfile | null = null;

  private state: GameState = 'BOOTING';
  private score = 0;
  private runSpeed: number = RUN.START_SPEED;
  private currentLane: Lane = 0;
  private accumulator = 0;
  private lastTime = 0;
  private loopRunning = false;
  private hitGraceUntil = 0;
  private unsubscribers: Array<() => void> = [];
  private poseStarting: Promise<void> | null = null;
  private validationHooked = false;

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

    this.hud = new HUD(this.hudRoot);
    this.hud.onRestart(() => this.restart());
    this.hud.onMainMenu(() => this.returnToMenu());

    this.startScreen = new StartScreen(this.uiRoot);
    this.calibrationScreen = new CalibrationScreen(this.uiRoot);
    this.calibrator = new PoseCalibrator(this.bus);

    this.startScreen.onPlayKeyboard(() => this.beginRun('keyboard'));
    this.startScreen.onPlayMotion(() => void this.beginMotionPlay());
    this.startScreen.onOpenCalibrate(() => void this.beginCalibration());

    this.calibrationScreen.onRetryStep(() => this.calibrator?.retryCurrentStep());
    this.calibrationScreen.onSkipStep(() => this.calibrator?.skip());
    this.calibrationScreen.onCancelCalib(() => this.calibrator?.cancel());

    this.setCameraStage('hidden');
    this.setState('BOOTING');

    const renderer = new GameRenderer(this.container, this.forceWebGL);
    await renderer.init();
    this.renderer = renderer;

    const physics = new PhysicsEngine();
    await physics.init();
    this.physics = physics;

    physics.onPlayerHit(() => {
      if (this.state !== 'RUNNING') return;
      if (performance.now() < this.hitGraceUntil) return;
      this.setState('GAME_OVER');
    });

    const playerMesh = renderer.createPlayerMesh();
    renderer.add(playerMesh);
    this.playerMesh = playerMesh;

    this.obstacles = new ObstacleManager(physics, renderer);

    this.keyboard = new KeyboardSource(this.bus);
    await this.keyboard.start();

    this.unsubscribers.push(
      this.bus.on('gesture', (event) => this.handleGesture(event)),
      this.bus.on('status', ({ text }) => this.hud?.setStatus(text)),
      this.bus.on('calibration', (update) => {
        this.calibrationScreen?.update(update);
        if (update.phase === 'validate' && !this.validationHooked) {
          this.validationHooked = true;
          this.calibrator?.beginValidation(() => {
            this.pose?.setDetectionEnabled(true);
          });
        }
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
    this.physics.reset();
    this.score = 0;
    this.runSpeed = RUN.START_SPEED;
    this.currentLane = 0;
    this.accumulator = 0;
    this.hitGraceUntil = performance.now() + 750;
    this.hud.setScore(0);
    this.setState('RUNNING');
    this.physics.setHitsEnabled(true);
    this.setCameraStage(this.pose ? 'corner' : 'hidden');
    this.updateStatusLine('Running');
  }

  returnToMenu(): void {
    this.physics?.setHitsEnabled(false);
    this.obstacles?.reset();
    this.physics?.reset();
    this.score = 0;
    this.runSpeed = RUN.START_SPEED;
    this.currentLane = 0;
    this.accumulator = 0;
    this.hud?.setScore(0);
    this.pose?.setDetectionEnabled(false);
    this.showStartMenu();
  }

  dispose(): void {
    this.loopRunning = false;
    this.renderer?.setAnimationLoop(null);
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.calibrator?.cancel();
    this.keyboard?.stop();
    this.pose?.stop();
    this.obstacles?.reset();
    this.physics?.dispose();
    this.renderer?.dispose();
    this.bus.clear();
  }

  private showStartMenu(): void {
    this.calibrationScreen?.hide();
    this.setCameraStage(this.pose ? 'corner' : 'hidden');
    this.skeleton?.setVisible(false);
    this.setState('START_MENU');
    this.startScreen?.show({
      backend: this.renderer?.backendName ?? '?',
      hasProfile: !!this.profile || hasSavedProfile(),
    });
    this.hud?.setStatus(`Backend: ${this.renderer?.backendName ?? '?'} · Choose a play mode`);
  }

  private beginRun(mode: 'keyboard' | 'motion'): void {
    this.startScreen?.hide();
    this.calibrationScreen?.hide();
    this.obstacles?.reset();
    this.physics?.reset();
    this.score = 0;
    this.runSpeed = RUN.START_SPEED;
    this.currentLane = 0;
    this.accumulator = 0;
    this.hitGraceUntil = performance.now() + 500;
    this.hud?.setScore(0);

    if (mode === 'motion' && this.pose && this.profile) {
      this.pose.setProfile(this.profile);
      this.pose.setDetectionEnabled(true);
      this.setCameraStage('corner');
      this.skeleton?.setVisible(false);
    } else {
      this.pose?.setDetectionEnabled(false);
      this.setCameraStage(this.pose ? 'corner' : 'hidden');
    }

    this.setState('RUNNING');
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
    this.pose.setDetectionEnabled(false);
    this.validationHooked = false;
    this.setCameraStage('center');
    this.skeleton?.setVisible(true);
    this.setState('CALIBRATING');
    this.calibrationScreen.show();

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

  private async ensurePoseStarted(): Promise<void> {
    if (this.pose) return;
    if (this.poseStarting) {
      await this.poseStarting;
      return;
    }

    this.poseStarting = (async () => {
      const tracker = new PoseTracker(this.video, this.bus);
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
      this.score += this.runSpeed * frameDt;
      this.hud?.setScore(this.score);
      this.bus.emit('score', { value: this.score });

      obstacles.update(frameDt, this.runSpeed);
      renderer.scrollTrack(this.runSpeed * frameDt);
    } else if (this.state === 'GAME_OVER' || this.state === 'START_MENU') {
      physics.updatePlayer(PHYSICS.FIXED_DT);
      physics.step();
    }

    this.syncPlayerMesh();
    renderer.render();
  }

  private syncPlayerMesh(): void {
    if (!this.playerMesh || !this.physics) return;
    const p = this.physics.playerPosition();
    this.playerMesh.position.set(p.x, p.y, p.z);
  }

  private handleGesture(event: GestureEvent): void {
    if (this.state === 'GAME_OVER') {
      if (event.gesture === 'JUMP' && event.source === 'keyboard') {
        this.restart();
      }
      return;
    }

    // Pose gestures during calibration validation must not drive gameplay.
    if (this.state !== 'RUNNING' || !this.physics) return;

    switch (event.gesture) {
      case 'MOVE_LEFT':
        this.currentLane = Math.max(-1, this.currentLane - 1) as Lane;
        this.physics.setTargetLane(this.currentLane);
        break;
      case 'MOVE_RIGHT':
        this.currentLane = Math.min(1, this.currentLane + 1) as Lane;
        this.physics.setTargetLane(this.currentLane);
        break;
      case 'JUMP':
        this.physics.jump();
        break;
      case 'DUCK':
        this.physics.startDuck();
        break;
      case 'NEUTRAL':
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
