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

  it('V1 월드 = 지도 원본 1536×1024, 비율 좌표는 그대로(부산 .48,.33 → 월드 737.28,337.92)', () => {
    expect([WORLD_W, WORLD_H]).toEqual([1536, 1024]);
    expect(PORT_BY_ID.busan.mapPos).toEqual({ x: 0.48, y: 0.33 });
    expect(PORT_BY_ID.busan.mapPos.x * WORLD_W).toBeCloseTo(737.28, 9);
    expect(PORT_BY_ID.busan.mapPos.y * WORLD_H).toBeCloseTo(337.92, 9);
  });

  it('V4 Busan → LA straight takes ≈25 s at 60 fps (PRD §3) — 월드가 커져 px/s 는 커지고 초는 같다', () => {
    const a = PORT_BY_ID.busan.mapPos;
    const b = PORT_BY_ID.la.mapPos;
    expect(pxDist(a, b)).toBeCloseTo(415.86, 1);
    expect(SPEED_PX).toBeCloseTo(16.63, 2);
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

describe('V2·V5·V8 항해 씬 설정(소스)', () => {
  it('카메라 줌 1.6 · roundPixels 끔 · lerp 0.08/0.08 · 경계 0..월드 · 화면 고정 UI 는 UI 카메라에만', async () => {
    const src = (await import('./SailingScene.ts?raw')).default;
    expect(src).toContain('const ZOOM = 1.6;');
    expect(src).toContain('setBounds(0, 0, WORLD_W, WORLD_H).setZoom(ZOOM).startFollow(this.ship, false, 0.08, 0.08)');
    expect(src).toContain('.ignore([map, pins, this.ship])');
    expect(src).toContain('this.cameras.main.ignore(this.pad.images)');
    expect(src).toContain('const SHIP_PX = 36;');
  });
  it('흔들림 ±1.5° · 한 주기 2초(1000ms 왕복) · prefers-reduced-motion 이면 트윈 없음', async () => {
    const src = (await import('./SailingScene.ts?raw')).default;
    expect(src).toMatch(
      /if \(!window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) \{[^}]*\n\s*this\.tweens\.add\(\{ targets: this\.ship, angle: \{ from: -1\.5, to: 1\.5 \}, duration: 1000, yoyo: true, repeat: -1/,
    );
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
