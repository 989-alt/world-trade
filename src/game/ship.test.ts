import { describe, expect, it } from 'vitest';
import shipE from '../../assets/img/ship/ship-e.png?inline';
import { PORT_BY_ID } from '../content/ports';
import { shouldExposeAutopilot } from './autopilot';
import { dirAt, DPAD } from './dpad';
import {
  ACCEL_S, ARRIVE_PX, DECEL_S, SAIL_SECONDS, SPEED_PX, TURN_RAD_PER_S, WORLD_H, WORLD_W, angleDiff, angleOf, dirFromKeys, helmStep, pxDist, spriteFor, spriteKey, steer,
  type Helm, type Keys, type Pos,
} from './ship';

const none: Keys = { up: false, down: false, left: false, right: false };
const k = (p: Partial<Keys>): Keys => ({ ...none, ...p });
const pxLen = (d: Pos) => Math.hypot(d.x * WORLD_W, d.y * WORLD_H);
const DT = 1000 / 60;
const deg = (r: number) => (r * 180) / Math.PI;
/** n 프레임 같은 목표로 조타 → 마지막 조타·움직인 거리(px) */
function run(h: Helm, target: number | null, frames: number) {
  let moved = 0;
  for (let i = 0; i < frames; i++) {
    const r = helmStep(h, target, DT);
    h = r.helm;
    moved += pxLen(r.move);
  }
  return { h, moved };
}

describe('M1 월드·배 크기', () => {
  it('월드 = 세부 지도 3072×2048, 비율 좌표는 그대로(부산 .48,.33 → 월드 1474.56,675.84)', () => {
    expect([WORLD_W, WORLD_H]).toEqual([3072, 2048]);
    expect(PORT_BY_ID.busan.mapPos).toEqual({ x: 0.48, y: 0.33 });
    expect(PORT_BY_ID.busan.mapPos.x * WORLD_W).toBeCloseTo(1474.56, 9);
    expect(PORT_BY_ID.busan.mapPos.y * WORLD_H).toBeCloseTo(675.84, 9);
  });
  it('배 그림 배율 = 56 / 옆모습(ship-e) 너비 — 8방위 같은 배율이라 선체 길이가 56 월드px', async () => {
    const bin = Uint8Array.from(atob(shipE.split(',')[1]), (ch) => ch.charCodeAt(0));
    const w = new DataView(bin.buffer).getUint32(16);
    expect(w).toBe(365);
    const src = (await import('./SailingScene.ts?raw')).default;
    expect(src).toContain('const SHIP_PX = 56;');
    expect(src).toContain("this.ship.setScale(SHIP_PX / (this.textures.get(spriteKey('e')).getSourceImage() as HTMLImageElement).width);");
  });
});

describe('M6 속도 규칙', () => {
  it('부산→LA 직선 ≈ 25초(최고 속도 33.27 px/s) — 정지에서 출발하면 가속 0.5초 만큼(0.25초) 늦다', () => {
    const a = PORT_BY_ID.busan.mapPos;
    const b = PORT_BY_ID.la.mapPos;
    expect(pxDist(a, b)).toBeCloseTo(831.72, 1);
    expect(SPEED_PX).toBeCloseTo(33.27, 2);
    const target = angleOf({ x: (b.x - a.x) * WORLD_W, y: (b.y - a.y) * WORLD_H })!;
    let h: Helm = { angle: target, speed: 0 };
    let pos = { ...a };
    let frames = 0;
    while (pxDist(pos, b) > 0.5) {
      const r = helmStep(h, target, DT);
      h = r.helm;
      pos = { x: pos.x + r.move.x, y: pos.y + r.move.y };
      frames++;
    }
    expect(frames / 60).toBeGreaterThan(SAIL_SECONDS);
    expect(frames / 60).toBeLessThanOrEqual(SAIL_SECONDS + ACCEL_S / 2 + 0.05);
  });
});

describe('M5 선회·가감속(helmStep 순수 함수)', () => {
  it('대각선(↑+→)은 정규화: 한 방향과 같은 속도', () => {
    for (const diag of [k({ up: true, right: true }), k({ down: true, left: true }), k({ up: true, left: true }), k({ down: true, right: true })]) {
      const d = dirFromKeys(diag);
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
      const target = angleOf(d)!;
      expect(run({ angle: target, speed: SPEED_PX }, target, 60).moved).toBeCloseTo(SPEED_PX, 6);
    }
    expect(run({ angle: 0, speed: SPEED_PX }, 0, 60).moved).toBeCloseTo(SPEED_PX, 6);
  });

  it('키 없음·반대 키 → 목표 없음(null)', () => {
    expect(angleOf(dirFromKeys(none))).toBeNull();
    expect(angleOf(dirFromKeys(k({ left: true, right: true })))).toBeNull();
  });

  it('회전은 초당 180° 이하: 동→남 90° 는 0.5초, 프레임마다 3° 이하, 목표에 정확히 멈춘다', () => {
    let h: Helm = { angle: 0, speed: 0 };
    let frames = 0;
    while (h.angle !== Math.PI / 2) {
      const before = h.angle;
      h = helmStep(h, Math.PI / 2, DT).helm;
      expect(Math.abs(deg(angleDiff(before, h.angle)))).toBeLessThanOrEqual(3 + 1e-9);
      frames++;
    }
    expect(frames).toBe(30);
    expect(TURN_RAD_PER_S).toBe(Math.PI);
    expect(run(h, Math.PI / 2, 30).h.angle).toBe(Math.PI / 2);
  });

  it('반대로 돌기(180°): 짧은 쪽으로 1초, 어긋남이 90° 를 넘는 동안은 전진 없이 제자리에서 돈다', () => {
    const half = run({ angle: 0, speed: SPEED_PX }, Math.PI, 30); // 0.5초 → 90°
    expect(Math.abs(deg(half.h.angle))).toBeCloseTo(90, 6);
    expect(half.moved).toBeLessThan(0.6); // 첫 프레임 어긋남 177° → 0
    const full = run(half.h, Math.PI, 30);
    expect(Math.abs(deg(angleDiff(full.h.angle, Math.PI)))).toBeLessThan(1e-9);
    expect(full.moved).toBeGreaterThan(5); // 남은 90° 동안 호를 그리며 나아간다
  });

  it('가속: 정지→최고 0.5초(30프레임), 감속: 키를 놓으면 0.4초(24프레임)에 정지 — 그동안 지금 헤딩으로 미끄러진다', () => {
    expect([ACCEL_S, DECEL_S]).toEqual([0.5, 0.4]);
    const up = run({ angle: 0, speed: 0 }, 0, 15);
    expect(up.h.speed).toBeCloseTo(SPEED_PX / 2, 9);
    const top = run(up.h, 0, 15);
    expect(top.h.speed).toBeCloseTo(SPEED_PX, 9);
    const coast = run(top.h, null, 12);
    expect(coast.h.speed).toBeCloseTo(SPEED_PX / 2, 9);
    expect(coast.h.angle).toBe(0);
    const stop = run(coast.h, null, 12);
    expect(stop.h.speed).toBeLessThan(1e-9);
    const total = coast.moved + stop.moved;
    expect(total).toBeCloseTo((SPEED_PX * DECEL_S) / 2, 0); // 삼각형 넓이 ≈ 6.65px
    expect(run(stop.h, null, 10).moved).toBe(0);
  });

  it('스프라이트 = 가장 가까운 8방위 + 잔여 회전(|잔여| ≤ 22.5°)', () => {
    const cases: [Partial<Keys>, string][] = [
      [{ up: true }, 'ship-n'], [{ up: true, right: true }, 'ship-ne'], [{ right: true }, 'ship-e'], [{ down: true, right: true }, 'ship-se'],
      [{ down: true }, 'ship-s'], [{ down: true, left: true }, 'ship-sw'], [{ left: true }, 'ship-w'], [{ up: true, left: true }, 'ship-nw'],
    ];
    for (const [keys, sprite] of cases) {
      const r = spriteFor(angleOf(dirFromKeys(k(keys)))!);
      expect(spriteKey(r.heading)).toBe(sprite);
      expect(Math.abs(r.residualDeg)).toBeLessThan(1e-9);
    }
    for (let a = -360; a <= 360; a += 7.3) {
      const r = spriteFor((a * Math.PI) / 180);
      expect(Math.abs(r.residualDeg)).toBeLessThanOrEqual(22.5 + 1e-9);
    }
    expect(spriteFor((20 * Math.PI) / 180)).toEqual({ heading: 'e', residualDeg: expect.closeTo(20, 9) });
    expect(spriteFor((-30 * Math.PI) / 180)).toEqual({ heading: 'ne', residualDeg: expect.closeTo(15, 9) });
  });

  it('자동 조타 steer: 4px 안 웨이포인트는 넘기고 다음 점을 향한다, 끝나면 null', () => {
    const p = (x: number, y: number): Pos => ({ x: x / WORLD_W, y: y / WORLD_H });
    const path = [p(103, 100), p(200, 100), p(200, 300)];
    expect(ARRIVE_PX).toBe(4);
    const a = steer(p(100, 100), path, 0); // 3px → 넘김
    expect(a.i).toBe(1);
    expect(a.target).toBeCloseTo(0, 9);
    const b = steer(p(197.5, 100), path, 1); // 2.5px → 넘김, 남쪽
    expect(b.i).toBe(2);
    expect(deg(b.target!)).toBeCloseTo(89.28, 1);
    expect(steer(p(200, 298), path, 2)).toEqual({ i: 3, target: null });
  });
});

describe('V2·V5·M2·M3 항해 씬 설정(소스)', () => {
  it('카메라 줌 1.0 × k · roundPixels 끔 · lerp 0.08/0.08 · 경계 0..월드 · 화면 고정 UI 는 UI 카메라(왼쪽 위 기준 줌 k)에만', async () => {
    const src = (await import('./SailingScene.ts?raw')).default;
    expect(src).toContain('const ZOOM = 1.0;');
    expect(src).toContain('setBounds(0, 0, WORLD_W, WORLD_H).setZoom(ZOOM * K).startFollow(this.ship, false, 0.08, 0.08)');
    expect(src).toContain('.setOrigin(0).setZoom(K).ignore([map, pins, this.ship])');
    expect(src).toContain('this.cameras.main.ignore(this.pad.images)');
    expect(src).toContain('new TouchPad(this, () => this.dock(), K)');
    expect(src).not.toContain('roundPixels: true');
  });
  it('캔버스 = 1280k × 720k, k = min(dpr × 스테이지 배율, 3) 부팅 때 1회, CSS 1280×720(NONE + zoom 1/k)', async () => {
    const src = (await import('./boot.ts?raw')).default;
    expect(src).toContain('K = Math.min(window.devicePixelRatio * stage, 3);');
    expect(src).toContain('width: 1280 * K,');
    expect(src).toContain('height: 720 * K,');
    expect(src).toContain('scale: { mode: Phaser.Scale.NONE, zoom: 1 / K },');
  });
  it('흔들림 ±1.5° · 한 주기 2초(1000ms 왕복) · prefers-reduced-motion 이면 트윈 없음 · 잔여 회전에 더한다', async () => {
    const src = (await import('./SailingScene.ts?raw')).default;
    expect(src).toMatch(
      /if \(!window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) \{[^}]*\n\s*this\.tweens\.add\(\{ targets: this\.bob, a: \{ from: -1\.5, to: 1\.5 \}, duration: 1000, yoyo: true, repeat: -1/,
    );
    expect(src).toContain('this.ship.setAngle(residualDeg + this.bob.a);');
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
