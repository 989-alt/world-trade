import { describe, expect, it } from 'vitest';
import { PORT_BY_ID } from '../content/ports';
import { shouldExposeAutopilot } from './autopilot';
import { dirAt, DPAD } from './dpad';
import { SAIL_SECONDS, SPEED_PX, WORLD_H, WORLD_W, dirFromKeys, headingOf, pxDist, spriteKey, stepDelta, type Keys } from './ship';

const none: Keys = { up: false, down: false, left: false, right: false };
const k = (p: Partial<Keys>): Keys => ({ ...none, ...p });
const pxLen = (d: { x: number; y: number }) => Math.hypot(d.x * WORLD_W, d.y * WORLD_H);

describe('ship movement', () => {
  it('diagonal (↑+→) is normalized: same speed as a single arrow', () => {
    const straight = pxLen(stepDelta(dirFromKeys(k({ right: true })), 1000));
    for (const diag of [k({ up: true, right: true }), k({ down: true, left: true }), k({ up: true, left: true }), k({ down: true, right: true })]) {
      const d = dirFromKeys(diag);
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
      expect(pxLen(stepDelta(d, 1000))).toBeCloseTo(straight, 9);
    }
    expect(straight).toBeCloseTo(SPEED_PX, 9);
  });

  it('no keys or opposite keys → no motion', () => {
    expect(dirFromKeys(none)).toEqual({ x: 0, y: 0 });
    expect(dirFromKeys(k({ left: true, right: true }))).toEqual({ x: 0, y: 0 });
    expect(headingOf({ x: 0, y: 0 })).toBeNull();
  });

  it('Busan → LA straight takes ≈25 s at 60 fps (PRD §3)', () => {
    const a = PORT_BY_ID.busan.mapPos;
    const b = PORT_BY_ID.la.mapPos;
    expect(pxDist(a, b)).toBeCloseTo(346.5, 1);
    expect(SPEED_PX).toBeCloseTo(13.86, 2);
    const w = { x: (b.x - a.x) * WORLD_W, y: (b.y - a.y) * WORLD_H };
    const len = Math.hypot(w.x, w.y);
    const dir = { x: w.x / len, y: w.y / len };
    let pos = { ...a };
    let frames = 0;
    while (pxDist(pos, b) > 0.5) {
      const d = stepDelta(dir, 1000 / 60);
      pos = { x: pos.x + d.x, y: pos.y + d.y };
      frames++;
    }
    expect(frames / 60).toBeGreaterThan(SAIL_SECONDS - 0.1);
    expect(frames / 60).toBeLessThanOrEqual(SAIL_SECONDS);
  });

  it('heading → 8 sprite keys (screen y down)', () => {
    const cases: [Partial<Keys>, string][] = [
      [{ up: true }, 'ship-n'], [{ up: true, right: true }, 'ship-ne'], [{ right: true }, 'ship-e'], [{ down: true, right: true }, 'ship-se'],
      [{ down: true }, 'ship-s'], [{ down: true, left: true }, 'ship-sw'], [{ left: true }, 'ship-w'], [{ up: true, left: true }, 'ship-nw'],
    ];
    for (const [keys, sprite] of cases) expect(spriteKey(headingOf(dirFromKeys(k(keys)))!)).toBe(sprite);
  });
});

describe('touch D-pad', () => {
  it('arms are ≥56px and map to directions; centre and outside are none', () => {
    expect(DPAD.w / 3).toBeGreaterThanOrEqual(56);
    expect(DPAD.h / 3).toBeGreaterThanOrEqual(56);
    const cx = DPAD.x + DPAD.w / 2;
    const cy = DPAD.y + DPAD.h / 2;
    expect(dirAt(cx + 70, cy)).toBe('right');
    expect(dirAt(cx - 70, cy)).toBe('left');
    expect(dirAt(cx, cy - 70)).toBe('up');
    expect(dirAt(cx, cy + 70)).toBe('down');
    expect(dirAt(cx, cy)).toBeNull();
    expect(dirAt(DPAD.x - 5, cy)).toBeNull();
  });
});

describe('autopilot flag', () => {
  it('only ?e2e=1 exposes window.__ktrade', () => {
    expect(shouldExposeAutopilot('')).toBe(false);
    expect(shouldExposeAutopilot('?seed=3')).toBe(false);
    expect(shouldExposeAutopilot('?e2e=0')).toBe(false);
    expect(shouldExposeAutopilot('?e2e=1')).toBe(true);
    expect(shouldExposeAutopilot('?seed=3&e2e=1')).toBe(true);
  });
});
