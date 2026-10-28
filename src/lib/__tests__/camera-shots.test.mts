/**
 * The camera previews' moves: every option the studio and the movie editor
 * offer has one, each does what its name says, and none puts the camera inside
 * the figure, a tree or the ground.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/camera-shots.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_MOVE_IDS, LENS_ANGLE_IDS, SHOT_SIZE_IDS, isCameraMoveId, isShotSizeId, loopSeconds, parseShotKey,
  shotAt, shotHint, shotKey, type ShotFrame, type ShotSpec,
} from '@/lib/camera-shots';
import { CAMERA_MOVES, SHOT_SIZES } from '@/lib/story/cinematic';

const PHASES = Array.from({ length: 41 }, (_, i) => i / 40 - (i === 40 ? 1e-6 : 0));

function every(): ShotSpec[] {
  const specs: ShotSpec[] = [];
  for (const move of CAMERA_MOVE_IDS) specs.push({ move });
  for (const size of SHOT_SIZE_IDS) specs.push({ size });
  for (const angle of LENS_ANGLE_IDS) specs.push({ angle });
  // The movie editor pairs any size with any of its moves.
  for (const size of SHOT_SIZE_IDS) for (const move of Object.keys(CAMERA_MOVES)) if (isCameraMoveId(move)) specs.push({ move, size });
  return specs;
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Mirrors the tree-free zones `engine.ts` leaves, with a tree's width taken off. */
function clearOfTrees([x, y, z]: number[]): boolean {
  if (y > 3.6) return true;
  if (Math.hypot(x, z) < 5.5) return true;
  if (z > 0 && Math.abs(x) < 1.5 + 0.35 * z) return true;
  return z < 0 && Math.abs(x) < 1.4;
}

test('every movie camera move and shot size has a preview', () => {
  for (const k of Object.keys(CAMERA_MOVES)) assert.ok(isCameraMoveId(k), `CAMERA_MOVES.${k}`);
  for (const k of Object.keys(SHOT_SIZES)) assert.ok(isShotSizeId(k), `SHOT_SIZES.${k}`);
});

test('every preview stays in the scene: numbers finite, camera out of the figure, trees, ground and hills', () => {
  for (const spec of every()) {
    for (const t of PHASES) {
      const f: ShotFrame = shotAt(spec, t);
      const label = `${shotKey(spec)} @ ${t.toFixed(3)}`;
      for (const n of [...f.eye, ...f.target, f.fov, f.roll, f.blur, f.fade, f.hero.x, f.hero.z, f.hero.heading]) {
        assert.ok(Number.isFinite(n), `${label}: ${n}`);
      }
      assert.ok(f.fov > 1 && f.fov < 120, `${label}: fov ${f.fov}`);
      assert.ok(f.fade >= 0 && f.fade <= 1, `${label}: fade ${f.fade}`);
      assert.ok(f.eye[1] > 0.15, `${label}: under the ground ${f.eye[1]}`);
      assert.ok(dist(f.eye, f.target) > 0.05, `${label}: no direction`);
      assert.ok(dist(f.eye, [f.hero.x, 1.55, f.hero.z]) > 0.2, `${label}: inside the head`);
      if (f.eye[1] < 1.8) assert.ok(Math.hypot(f.eye[0] - f.hero.x, f.eye[2] - f.hero.z) > 0.25, `${label}: inside the body`);
      assert.ok(clearOfTrees(f.eye), `${label}: in the trees at ${f.eye.map((v) => v.toFixed(2))}`);
      assert.ok(Math.hypot(f.eye[0], f.eye[2]) < 38, `${label}: in the hills`);
    }
  }
});

test('moves do what their names say', () => {
  const at = (spec: ShotSpec, t: number) => shotAt(spec, t);
  // Push in comes closer; pull out goes away — from every framing.
  for (const size of [undefined, ...SHOT_SIZE_IDS]) {
    assert.ok(at({ move: 'push-in', size }, 0.9).eye[2] < at({ move: 'push-in', size }, 0).eye[2], `push-in ${size}`);
    assert.ok(at({ move: 'pull-out', size }, 0.9).eye[2] > at({ move: 'pull-out', size }, 0).eye[2], `pull-out ${size}`);
  }
  // A pan turns the view, the camera stays.
  const right = at({ move: 'pan-right' }, 0.9);
  assert.ok(right.target[0] - right.eye[0] > 0.5);
  const left = at({ move: 'pan-left' }, 0.9);
  assert.ok(left.target[0] - left.eye[0] < -0.5);
  assert.deepEqual(at({ move: 'pan-right' }, 0).eye, right.eye);
  // A zoom narrows the lens and leaves the camera where it was.
  assert.deepEqual(at({ move: 'zoom-face' }, 0).eye, at({ move: 'zoom-face' }, 0.9).eye);
  assert.ok(at({ move: 'zoom-face' }, 0.9).fov < at({ move: 'zoom-face' }, 0).fov / 3);
  // Tilt up ends looking up; crane up ends higher.
  const tilt = at({ move: 'tilt-up' }, 0.9);
  assert.ok(tilt.target[1] > tilt.eye[1]);
  assert.ok(at({ move: 'crane-up' }, 0.9).eye[1] > at({ move: 'crane-up' }, 0).eye[1] + 3);
  // The static shot is static.
  for (const t of PHASES) assert.deepEqual(at({ move: 'static' }, t).eye, at({ move: 'static' }, 0).eye);
  // Walking shots walk.
  for (const move of ['truck-left', 'tracking'] as const) assert.equal(at({ move }, 0.5).hero.walk, 1);
});

test('loops either fade at the seam or join seamlessly', () => {
  for (const spec of every()) {
    const a = shotAt(spec, 0);
    const b = shotAt(spec, 1 - 1e-6);
    if (a.fade === 1) continue;
    assert.ok(dist(a.eye, b.eye) < 0.01 && dist(a.target, b.target) < 0.01, `${shotKey(spec)} jumps at the seam`);
  }
});

test('the photo angles blur only the shots that are about blur', () => {
  assert.ok(shotAt({ angle: 'portrait-85' }, 0.8).blur > 0);
  assert.equal(shotAt({ angle: 'macro' }, 0.8).focus, 'flower');
  for (const angle of ['wide-24', 'aerial', 'low-angle', 'top-down'] as const) assert.equal(shotAt({ angle }, 0.8).blur, 0);
});

test('keys round-trip, hints are Thai, loops have a length', () => {
  for (const spec of every()) {
    assert.deepEqual(parseShotKey(shotKey(spec)), spec);
    assert.match(shotHint(spec), /[฀-๿]/);
    assert.ok(loopSeconds(spec) >= 2);
  }
  assert.deepEqual(parseShotKey('nonsense|x|y'), {});
});
