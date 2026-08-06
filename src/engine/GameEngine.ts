import { PHYSICS, PLAYER, RUN } from '../config/GameConfig';
import { EventBus } from '../core/EventBus';
import type { GameEvents, GameState, GestureEvent, Lane, LaneGuides } from '../core/types';
import { ObstacleManager } from './ObstacleManager';
import { GameRenderer } from '../graphics/GameRenderer';
import { KeyboardSource } from '../input/KeyboardSource';
import { PhysicsEngine } from '../physics/PhysicsEngine';
import { CalibrationScreen } from '../ui/CalibrationScreen';
import { HandCalibrationScreen } from '../ui/HandCalibrationScreen';
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
  private hud: HUD | null = null;
  private startScreen: StartScreen | null = null;
  private calibrationScreen: CalibrationScreen | null = null;
  private handCalibrationScreen: HandCalibrationScreen | null = null;
  private handCursor: HandCursorOverlay | null = null;
  private handUi: HandUiController | null = null;
  private keyboard: KeyboardSource | null = null;
  private pose: PoseTracker | null = null;
  private hands: HandTracker | null = null;
  private calibrator: PoseCalibrator | null = null;
  private handCalibrator: HandCalibrator | null = null;
  private skeleton: SkeletonOverlay | null = null;
  private playerMesh: THREE.Mesh | null = null;
  private profile: PoseProfile | null = null;
  private handProfile: HandProfile | null = null;
  private cameraStream: MediaStream | null = null;

  private state: GameState = 'BOOTING';
  private score = 0;
  private runSpeed: number = RUN.START_SPEED;
  private currentLane: Lane = 0;
  private accumulator = 0;
  private lastTime = 0;
  private loopRunning = false;
  private hitGraceUntil = 0;
  private unsubscribers: Array<() => void> = [];
  private cameraStarting: Promise<void> | null = null;
  private poseStarting: Promise<void> | null = null;
  private handsStarting: Promise<void> | null = null;
  private validationHooked = false;
  private duckVisual = 0;
  private latestLaneGuides: LaneGuides | null = null;
  private latestHighlightLane: Lane | null = null;

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

    this.hud = new HUD(this.hudRoot);
    this.hud.onRestart(() => this.restart());
    this.hud.onMainMenu(() => this.returnToMenu());

    this.startScreen = new StartScreen(this.uiRoot);
    this.calibrationScreen = new CalibrationScreen(this.uiRoot);
    this.handCalibrationScreen = new HandCalibrationScreen(this.uiRoot);
    this.handCursor = new HandCursorOverlay(this.uiRoot);
    this.handUi = new HandUiController(this.bus, this.handCursor);
    this.calibrator = new PoseCalibrator(this.bus);
    this.handCalibrator = new HandCalibrator(this.bus);

    this.startScreen.onPlayKeyboard(() => this.beginRun('keyboard'));
    this.startScreen.onPlayMotion(() => void this.beginMotionPlay());
    this.startScreen.onOpenCalibrate(() => void this.beginCalibration());
    this.startScreen.onOpenHandUi(() => void this.beginHandCalibration());

    this.calibrationScreen.onRetryStep(() => this.calibrator?.retryCurrentStep());
    this.calibrationScreen.onSkipStep(() => this.calibrator?.skip());
    this.calibrationScreen.onCancelCalib(() => this.calibrator?.cancel());

    this.handCalibrationScreen.onRedoStep(() => this.handCalibrator?.redoLastCorner());
    this.handCalibrationScreen.onCancelCalib(() => this.handCalibrator?.cancel());

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
      this.syncHandTracking();
    });

    const playerMesh = renderer.createPlayerMesh();
    renderer.add(playerMesh);
    this.playerMesh = playerMesh;

    this.obstacles = new ObstacleManager(physics, renderer);

    this.keyboard = new KeyboardSource(this.bus);
    await this.keyboard.start();

    this.unsubscribers.push(
      this.bus.on('gesture', (event) => this.handleGesture(event)),
      this.bus.on('poseLane', ({ lane }) => this.handlePoseLane(lane)),
      this.bus.on('status', ({ text }) => this.hud?.setStatus(text)),
      this.bus.on('calibration', (update) => {
        this.calibrationScreen?.update(update);
        this.latestLaneGuides = update.laneGuides ?? null;
        this.latestHighlightLane = update.highlightLane ?? null;
        this.skeleton?.setLaneGuides(this.latestLaneGuides, this.latestHighlightLane);

        if (update.phase === 'validate' && !this.validationHooked) {
          this.validationHooked = true;
          this.calibrator?.beginValidation((enabled) => {
            if (enabled) {
              const draft = this.calibrator?.draftProfile();
              if (draft) this.pose?.setProfile(draft);
            }
            this.pose?.setDetectionEnabled(enabled);
          });
        }
      }),
      this.bus.on('handCalibration', (update) => {
        this.handCalibrationScreen?.update(update);
      }),
      this.bus.on('poseFrame', ({ landmarks }) => {
        this.skeleton?.setLaneGuides(this.latestLaneGuides, this.latestHighlightLane);
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
    this.duckVisual = 0;
    this.hitGraceUntil = performance.now() + 750;
    this.hud.setScore(0);
    if (this.playerMesh) this.playerMesh.scale.set(1, 1, 1);
    this.setState('RUNNING');
    this.syncHandTracking();
    this.physics.setHitsEnabled(true);
    this.setCameraStage(this.cameraStream ? 'corner' : 'hidden');
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
    this.duckVisual = 0;
    if (this.playerMesh) this.playerMesh.scale.set(1, 1, 1);
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
    this.handCalibrator?.cancel();
    this.handUi?.dispose();
    this.keyboard?.stop();
    this.pose?.stop();
    this.hands?.stop();
    this.stopCamera();
    this.obstacles?.reset();
    this.physics?.dispose();
    this.renderer?.dispose();
    this.bus.clear();
  }

  private showStartMenu(): void {
    this.calibrationScreen?.hide();
    this.handCalibrationScreen?.hide();
    this.setCameraStage(this.cameraStream ? 'corner' : 'hidden');
    this.skeleton?.setVisible(false);
    this.skeleton?.setLaneGuides(null, null);
    this.latestLaneGuides = null;
    this.latestHighlightLane = null;
    this.setState('START_MENU');
    this.startScreen?.show({
      backend: this.renderer?.backendName ?? '?',
      hasProfile: !!this.profile || hasSavedProfile(),
      hasHandProfile: !!this.handProfile || hasHandProfile(),
      handControlsActive: !!this.hands?.isEnabled(),
    });
    this.hud?.setStatus(`Backend: ${this.renderer?.backendName ?? '?'} · Choose a play mode`);
    this.syncHandTracking();
  }

  private beginRun(mode: 'keyboard' | 'motion'): void {
    this.startScreen?.hide();
    this.calibrationScreen?.hide();
    this.handCalibrationScreen?.hide();
    this.obstacles?.reset();
    this.physics?.reset();
    this.score = 0;
    this.runSpeed = RUN.START_SPEED;
    this.currentLane = 0;
    this.accumulator = 0;
    this.duckVisual = 0;
    if (this.playerMesh) this.playerMesh.scale.set(1, 1, 1);
    this.hitGraceUntil = performance.now() + 500;
    this.hud?.setScore(0);

    if (mode === 'motion' && this.pose && this.profile) {
      this.pose.setProfile(this.profile);
      this.pose.setDetectionEnabled(true);
      this.setCameraStage('corner');
      this.skeleton?.setVisible(false);
      this.skeleton?.setLaneGuides(null, null);
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
    this.validationHooked = false;
    this.latestLaneGuides = null;
    this.latestHighlightLane = null;
    this.setCameraStage('center');
    this.skeleton?.setVisible(true);
    this.skeleton?.setLaneGuides(null, null);
    this.setState('CALIBRATING');
    this.calibrationScreen.show();
    this.syncHandTracking();

    this.calibrator.start((profile) => {
      this.pose?.setDetectionEnabled(false);
      this.skeleton?.setVisible(false);
      this.skeleton?.setLaneGuides(null, null);
      this.latestLaneGuides = null;
      this.latestHighlightLane = null;
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
    this.skeleton?.setVisible(false);
    // Fresh recalibration: drop previous hand/pinch/corner mapping entirely.
    this.hands.setProfile(null);
    this.hands.clearSessionHandedness();
    this.setCameraStage('center');
    this.setState('HAND_CALIBRATING');
    this.handCalibrationScreen.show();
    this.syncHandTracking();

    this.handCalibrator.start(
      (profile) => {
        this.handCalibrationScreen?.hide();

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

  private async ensureHandsStarted(): Promise<void> {
    await this.ensureCameraStarted();
    if (this.hands) return;
    if (this.handsStarting) {
      await this.handsStarting;
      return;
    }

    this.handsStarting = (async () => {
      const tracker = new HandTracker(this.video, this.bus);
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

    // Smooth duck visual toward physics duck state.
    const duckTarget = physics.isDucking() ? 1 : 0;
    const duckLerp = 1 - Math.exp(-PLAYER.DUCK_VISUAL_LERP_SPEED * frameDt);
    this.duckVisual += (duckTarget - this.duckVisual) * duckLerp;

    this.syncPlayerMesh();
    renderer.render();
  }

  private syncPlayerMesh(): void {
    if (!this.playerMesh || !this.physics) return;
    const p = this.physics.playerPosition();
    this.playerMesh.position.set(p.x, p.y, p.z);

    const scaleY = 1 - this.duckVisual * (1 - PLAYER.DUCK_VISUAL_SCALE_Y);
    this.playerMesh.scale.set(1, scaleY, 1);
  }

  private handlePoseLane(lane: Lane): void {
    // Pose gestures during calibration must not drive gameplay.
    if (this.state !== 'RUNNING' || !this.physics) return;
    this.currentLane = lane;
    this.physics.setTargetLane(lane);
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
