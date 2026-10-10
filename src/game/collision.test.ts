import { describe, expect, it } from 'vitest';
import { STEP_PX, isLand, maskFromRGBA, tryMove, type Mask } from './collision';

/** 64×64 합성 마스크: x ≥ 40 육지(동쪽 해안), y = 20 한 줄 1px 벽(x 0~19), 섬 10..13×40..43 */
function synthetic(): Mask {
  const W = 64;
  const rgba = new Uint8ClampedArray(W * W * 4);
  const land = (x: number, y: number) => x >= 40 || (y === 20 && x < 20) || (x >= 10 && x <= 13 && y >= 40 && y <= 43);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) rgba[(y * W + x) * 4] = land(x, y) ? 255 : 0;
  return maskFromRGBA(W, W, rgba);
}
const m = synthetic();
const f = (px: number) => px / 64; // 마스크 픽셀 → 비율

describe('isLand on 10 boundary coordinates', () => {
  const cases: [number, number, boolean][] = [
    [39.5, 5, false], // 해안 바로 앞 바다
    [40.0, 5, true], // 해안 첫 픽셀 경계
    [39.99, 5, false],
    [10, 19.99, false], // 벽 위
    [10, 20.0, true], // 1px 벽
    [10, 20.99, true],
    [10, 21.0, false], // 벽 아래
    [9.99, 41, false], // 섬 서쪽 끝 바로 옆
    [13.99, 43.99, true], // 섬 남동 모서리
    [-0.01, 5, true], // 지도 밖 = 벽
  ];
  it.each(cases)('(%f, %f) → land=%s', (x, y, land) => expect(isLand(m, f(x), f(y))).toBe(land));
});

describe('tryMove', () => {
  it('sea → sea moves exactly by delta', () => {
    const p = { x: f(30.5), y: f(5.5) };
    const n = tryMove(m, p, { x: f(5), y: f(3) });
    expect(n.x).toBeCloseTo(f(35.5), 12);
    expect(n.y).toBeCloseTo(f(8.5), 12);
  });

  it('into the coast → stops in place (same object: no slide, no push-out)', () => {
    const p = { x: f(39.5), y: f(5.5) };
    expect(tryMove(m, p, { x: f(1), y: 0 })).toBe(p);
    expect(tryMove(m, p, { x: f(1), y: f(1) })).toBe(p); // 대각선도 미끄러지지 않음
    expect(tryMove(m, p, { x: f(-1), y: 0 })).not.toBe(p); // 바다 쪽으론 빠져나감 → 끼임 없음
  });

  it('no tunneling through a 1px wall even with a long jump', () => {
    const p = { x: f(5.5), y: f(10.5) };
    expect(tryMove(m, p, { x: 0, y: f(30) })).toBe(p); // y=20 벽을 건너뛰지 못함
    expect(tryMove(m, p, { x: f(8), y: f(30) })).toBe(p); // 섬 아니라 벽에 먼저 걸림
  });

  it('steps are ≤2px (STEP_PX), so a 1px wall between two sea points 2px apart still blocks', () => {
    expect(STEP_PX).toBeLessThanOrEqual(2);
    const p = { x: f(5.5), y: f(19.5) };
    expect(tryMove(m, p, { x: 0, y: f(2) })).toBe(p);
  });

  it('a per-frame step (0.23px) next to the coast is allowed until the coast pixel', () => {
    const p = { x: f(39.6), y: f(5.5) };
    expect(tryMove(m, p, { x: f(0.23), y: 0 }).x).toBeCloseTo(f(39.83), 12);
    expect(tryMove(m, { x: f(39.8), y: f(5.5) }, { x: f(0.23), y: 0 }).x).toBe(f(39.8));
  });
});
