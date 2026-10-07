/**
 * Synthetic detector checks. Run with:
 *   npx tsx src/vision/synthCheck.ts
 * Not part of the game bundle.
 */
import { CALIBRATION, HAND_UI } from '../config/GameConfig';
import { EventBus } from '../core/EventBus';
import type { GameEvents, HandFrameEvent, PoseSample } from '../core/types';
import { BodyState } from './BodyState';
import { HandCalibrator } from './HandCalibrator';
import { defaultProfile } from './PoseProfile';

const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
}

function pose(over: Partial<PoseSample> = {}): PoseSample {
  return {
    shoulderMidY: 0.3,
    shoulderMidX: 0.5,
    noseX: 0.5,
    noseY: 0.2,
    hipMidY: 0.5,
    hipsVisible: true,
    ankleLY: 0.9,
    ankleRY: 0.9,
    ankleMidY: 0.9,
    kneeMidY: 0.72,
    anklesVisible: true,
    footLY: 0.92,
    footRY: 0.92,
    feetConfident: true,
    star: null,
    ...over,
  };
}

const NO_FEET = {
  footLY: null,
  footRY: null,
  feetConfident: false,
  ankleLY: null,
  ankleRY: null,
  ankleMidY: null,
  anklesVisible: false,
} as const;

function runClip(samples: PoseSample[], dt: number): { jumps: number; cues: string[] } {
  const body = new BodyState(defaultProfile());
  let t = 0;
  let jumps = 0;
  const cues: string[] = [];
  for (const sample of samples) {
    const frame = body.update(sample, t);
    if (frame.jumped) {
      jumps += 1;
      cues.push(frame.jumpCue ?? '?');
    }
    t += dt;
  }
  return { jumps, cues };
}

/** Takeoff frames have no feet. Hips rise. Then the feet reappear and land. */
function ankleDropout(): { jumps: number; cues: string[] } {
  const frames: PoseSample[] = [];
  for (let i = 0; i < 20; i++) frames.push(pose());
  const rising = [0.46, 0.4, 0.36, 0.34];
  for (const hip of rising) frames.push(pose({ hipMidY: hip, ...NO_FEET }));
  frames.push(pose({ hipMidY: 0.36, footLY: 0.8, footRY: 0.8, feetConfident: true }));
  frames.push(pose({ hipMidY: 0.4, footLY: 0.84, footRY: 0.84, feetConfident: true }));
  for (let i = 0; i < 8; i++) frames.push(pose({ hipMidY: 0.5 }));
  return runClip(frames, 30);
}

/** Hips rise, but both feet stay confidently on the floor. */
function tiptoe(): { jumps: number; cues: string[] } {
  const frames: PoseSample[] = [];
  for (let i = 0; i < 20; i++) frames.push(pose());
  for (const hip of [0.46, 0.4, 0.36, 0.34, 0.36, 0.42, 0.5]) {
    frames.push(pose({ hipMidY: hip, footLY: 0.915, footRY: 0.915, feetConfident: true }));
  }
  for (let i = 0; i < 8; i++) frames.push(pose());
  return runClip(frames, 30);
}

/** One foot stays down. Hip bounce stays under hipJump. */
function running(): { jumps: number; cues: string[] } {
  const frames: PoseSample[] = [];
  for (let i = 0; i < 48; i++) {
    const up = i % 2 === 0;
    frames.push(
      pose({
        hipMidY: 0.5 + Math.sin(i / 3) * 0.008,
        footLY: up ? 0.92 : 0.86,
        footRY: up ? 0.86 : 0.92,
        feetConfident: true,
      }),
    );
  }
  return runClip(frames, 50);
}

function feetJump(): { jumps: number; cues: string[] } {
  const frames: PoseSample[] = [];
  for (let i = 0; i < 15; i++) frames.push(pose());
  for (const hip of [0.48, 0.46, 0.46]) {
    frames.push(pose({ hipMidY: hip, footLY: 0.82, footRY: 0.82, feetConfident: true }));
  }
  for (let i = 0; i < 8; i++) frames.push(pose());
  return runClip(frames, 40);
}

function handFrame(over: Partial<HandFrameEvent>): HandFrameEvent {
  return {
    cursor: { x: 0.5, y: 0.4 },
    side: 'Left',
    raised: { Left: true, Right: false },
    pinchRatio: 1,
    pinching: false,
    pinchHeld: false,
    pinchCommit: false,
    pinchProgress: 0,
    ...over,
  };
}

function pinchReps(): void {
  const bus = new EventBus<GameEvents>();
  const dots: number[] = [];
  let profileHand: string | null = null;
  bus.on('handCalibration', (update) => {
    if (update.feedback.kind === 'reps') dots.push(update.feedback.value);
  });
  const cal = new HandCalibrator(bus);
  let clock = 1000;
  const original = performance.now.bind(performance);
  performance.now = () => clock;
  try {
    cal.start((profile) => {
      profileHand = profile ? profile.handedness : 'cancelled';
    });
    const emit = (frame: HandFrameEvent, at: number) => {
      clock = at;
      bus.emit('handFrame', frame);
    };
    emit(handFrame({ pinchRatio: null }), 1000);
    emit(handFrame({ pinchRatio: null }), 1000 + HAND_UI.RAISE_HOLD_MS);
    emit(handFrame({ pinchRatio: null }), 1000 + HAND_UI.RAISE_HOLD_MS + CALIBRATION.SUCCESS_BEAT_MS);

    let t = 1000 + HAND_UI.RAISE_HOLD_MS + CALIBRATION.SUCCESS_BEAT_MS + 50;
    const ratios = [1, 0.4, 0.25, 0.95, 1, 0.35, 0.2, 0.95];
    for (const ratio of ratios) {
      emit(handFrame({ pinchRatio: ratio }), t);
      t += 80;
    }
    emit(handFrame({ pinchRatio: 1 }), t + CALIBRATION.SUCCESS_BEAT_MS);
  } finally {
    performance.now = original;
  }

  check('pinch dots reach 1', dots.includes(1), `dots ${dots.join(',')}`);
  check('pinch dots reach 2', dots.includes(2), `dots ${dots.join(',')}`);
  check('pinch step finishes', profileHand === 'Left', `profile ${profileHand}`);
}

function main(): void {
  const dropout = ankleDropout();
  check('ankle dropout is one jump', dropout.jumps === 1, `jumps ${dropout.jumps} cues ${dropout.cues.join(',')}`);
  check(
    'ankle dropout uses the hip cue',
    dropout.cues[0] === 'hips' || dropout.cues[0] === 'both',
    `cue ${dropout.cues[0] ?? 'none'}`,
  );

  const toes = tiptoe();
  check('tiptoe is not a jump', toes.jumps === 0, `jumps ${toes.jumps} cues ${toes.cues.join(',')}`);

  const run = running();
  check('running is not a jump', run.jumps === 0, `jumps ${run.jumps} cues ${run.cues.join(',')}`);

  const feet = feetJump();
  check('feet leaving the floor is one jump', feet.jumps === 1, `jumps ${feet.jumps} cues ${feet.cues.join(',')}`);

  pinchReps();

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    throw new Error(`${failures.length} synth check(s) failed`);
  }
  console.log('synth checks passed');
}

main();
