import { BODY, LANDMARK, VISION } from '../config/GameConfig';
import type { PoseLandmarkPoint, PoseSample, StarGeometry } from '../core/types';

type V3 = { x: number; y: number; z: number };

function visible(p: PoseLandmarkPoint | undefined): p is PoseLandmarkPoint {
  return !!p && (p.visibility ?? 0) >= VISION.MIN_VISIBILITY;
}

const FOOT_L = [LANDMARK.L_ANKLE, LANDMARK.L_HEEL, LANDMARK.L_FOOT_INDEX] as const;
const FOOT_R = [LANDMARK.R_ANKLE, LANDMARK.R_HEEL, LANDMARK.R_FOOT_INDEX] as const;

/** Lowest image point of one foot. A toe still on the floor keeps the foot down. */
function lowestFoot(
  pose: PoseLandmarkPoint[],
  ids: readonly number[],
): { y: number; visibility: number } | null {
  let best: { y: number; visibility: number } | null = null;
  for (const i of ids) {
    const p = pose[i];
    const vis = p?.visibility ?? 0;
    if (!p || vis < BODY.FOOT_VISIBILITY) continue;
    if (!best || p.y > best.y) best = { y: p.y, visibility: vis };
  }
  return best;
}

function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function mid(a: V3, b: V3): V3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function len(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function angleDeg(a: V3, b: V3): number {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-6 || lb < 1e-6) return 0;
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/**
 * Star shape from world landmarks (meters, hip-centered). Visibility comes from
 * the image landmarks, which share indices with the world landmarks.
 */
export function starGeometry(
  image: PoseLandmarkPoint[],
  world: PoseLandmarkPoint[],
): StarGeometry | null {
  const ids = [
    LANDMARK.L_SHOULDER,
    LANDMARK.R_SHOULDER,
    LANDMARK.L_ELBOW,
    LANDMARK.R_ELBOW,
    LANDMARK.L_WRIST,
    LANDMARK.R_WRIST,
    LANDMARK.L_HIP,
    LANDMARK.R_HIP,
    LANDMARK.L_ANKLE,
    LANDMARK.R_ANKLE,
  ];
  if (ids.some((i) => !visible(image[i]) || !world[i])) return null;

  const w = (i: number) => world[i]!;
  const shoulderMid = mid(w(LANDMARK.L_SHOULDER), w(LANDMARK.R_SHOULDER));
  const hipMid = mid(w(LANDMARK.L_HIP), w(LANDMARK.R_HIP));
  const torsoDown = sub(hipMid, shoulderMid);

  const arm = (s: number, e: number, wr: number) => ({
    elevation: angleDeg(sub(w(wr), w(s)), torsoDown),
    elbow: angleDeg(sub(w(s), w(e)), sub(w(wr), w(e))),
  });
  const l = arm(LANDMARK.L_SHOULDER, LANDMARK.L_ELBOW, LANDMARK.L_WRIST);
  const r = arm(LANDMARK.R_SHOULDER, LANDMARK.R_ELBOW, LANDMARK.R_WRIST);

  const hipWidth = Math.max(0.05, len(sub(w(LANDMARK.L_HIP), w(LANDMARK.R_HIP))));
  const ankleGap = len(sub(w(LANDMARK.L_ANKLE), w(LANDMARK.R_ANKLE)));

  return {
    armL: l.elevation,
    armR: r.elevation,
    elbowL: l.elbow,
    elbowR: r.elbow,
    spread: ankleGap / hipWidth,
  };
}

/** min over the three star margins; ≥ 1 means every part clears its threshold. */
export function starScore(g: StarGeometry, arm: number, spread: number): number {
  const armScore = Math.min(g.armL, g.armR) / Math.max(1, arm);
  const elbowScore = Math.min(g.elbowL, g.elbowR) / BODY.STAR_ELBOW_MIN;
  const spreadScore = g.spread / Math.max(0.1, spread);
  return Math.min(armScore, elbowScore, spreadScore);
}

/** Image-space measurements for one frame, or null if the head and shoulders are not visible. */
export function readSample(
  pose: PoseLandmarkPoint[],
  world: PoseLandmarkPoint[],
): PoseSample | null {
  const lShoulder = pose[LANDMARK.L_SHOULDER];
  const rShoulder = pose[LANDMARK.R_SHOULDER];
  const nose = pose[LANDMARK.NOSE];
  if (!visible(lShoulder) || !visible(rShoulder) || !visible(nose)) return null;

  const lHip = pose[LANDMARK.L_HIP];
  const rHip = pose[LANDMARK.R_HIP];
  const hipsVisible = visible(lHip) && visible(rHip);

  const lAnkle = pose[LANDMARK.L_ANKLE];
  const rAnkle = pose[LANDMARK.R_ANKLE];
  const lAnkleOk = visible(lAnkle);
  const rAnkleOk = visible(rAnkle);
  const anklesVisible = lAnkleOk && rAnkleOk;

  const lKnee = pose[LANDMARK.L_KNEE];
  const rKnee = pose[LANDMARK.R_KNEE];
  const kneesVisible = visible(lKnee) && visible(rKnee);

  const footL = lowestFoot(pose, FOOT_L);
  const footR = lowestFoot(pose, FOOT_R);

  return {
    shoulderMidY: (lShoulder.y + rShoulder.y) * 0.5,
    shoulderMidX: (lShoulder.x + rShoulder.x) * 0.5,
    noseX: nose.x,
    noseY: nose.y,
    hipMidY: hipsVisible ? (lHip!.y + rHip!.y) * 0.5 : null,
    hipsVisible,
    ankleLY: lAnkleOk ? lAnkle!.y : null,
    ankleRY: rAnkleOk ? rAnkle!.y : null,
    ankleMidY: anklesVisible ? (lAnkle!.y + rAnkle!.y) * 0.5 : null,
    kneeMidY: kneesVisible ? (lKnee!.y + rKnee!.y) * 0.5 : null,
    anklesVisible,
    footLY: footL?.y ?? null,
    footRY: footR?.y ?? null,
    feetConfident:
      !!footL &&
      !!footR &&
      footL.visibility >= VISION.MIN_VISIBILITY &&
      footR.visibility >= VISION.MIN_VISIBILITY,
    star: world.length > 0 ? starGeometry(pose, world) : null,
  };
}
