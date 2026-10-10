import { describe, expect, it } from 'vitest';
import maskPng from '../../assets/img/mask-worldmap.png?inline';
import { PORTS } from '../content/ports';
import { routeBetween } from './autopilot';
import { STEP_PX, isLand, isOcean, maskFromRGBA, tryMove, withOcean, type Mask } from './collision';
import { exitPoint, nearestPortWithin } from './ports-layout';
import type { Pos } from './ship';

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

/** 런타임과 같은 mask-worldmap.png(1비트 회색, 비인터레이스)를 Node 에서 직접 푼다: IDAT inflate + 행 필터 복원. 1 = 흰색 = 육지 */
async function decodeMask(): Promise<Mask> {
  const bin = Uint8Array.from(atob(maskPng.split(',')[1]), (ch) => ch.charCodeAt(0));
  const dv = new DataView(bin.buffer);
  let [w, h, depth, color, interlace] = [0, 0, 0, 0, 0];
  const idat: Uint8Array[] = [];
  for (let p = 8; p < bin.length; ) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...bin.subarray(p + 4, p + 8));
    if (type === 'IHDR') [w, h, depth, color, interlace] = [dv.getUint32(p + 8), dv.getUint32(p + 12), bin[p + 16], bin[p + 17], bin[p + 20]];
    if (type === 'IDAT') idat.push(bin.slice(p + 8, p + 8 + len));
    p += 12 + len;
  }
  expect([depth, color, interlace]).toEqual([1, 0, 0]);
  const zipped = new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(zipped).arrayBuffer());
  const stride = Math.ceil(w / 8);
  const rows = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x > 0 ? rows[y * stride + x - 1] : 0;
      const b = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const c = x > 0 && y > 0 ? rows[(y - 1) * stride + x - 1] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      rows[y * stride + x] = (v + pred) & 255;
    }
  }
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = (rows[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
  return { width: w, height: h, data };
}

const mask = withOcean(await decodeMask());
const [MASK_W, MASK_H] = [mask.width, mask.height];

/** 선분을 1% 와 0.25 마스크픽셀 중 더 촘촘한 간격으로 훑어 육지 점을 돌려준다 */
function landOn(a: Pos, b: Pos): Pos | null {
  const px = Math.hypot((b.x - a.x) * MASK_W, (b.y - a.y) * MASK_H);
  const n = Math.max(100, Math.ceil(px / 0.25));
  for (let i = 0; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    if (isLand(mask, p.x, p.y)) return p;
  }
  return null;
}

describe('autopilot waypoints (mask-worldmap.png)', () => {
  it('PNG 를 제대로 풀었다: 1536×1024, 육지 439,503 픽셀(PIL 실측)', () => {
    expect([MASK_W, MASK_H]).toEqual([1536, 1024]);
    expect(mask.data.reduce((n, v) => n + v, 0)).toBe(439503);
    // 검사기가 육지를 실제로 잡는지: 부산 → 독일 직선은 유라시아를 지난다
    expect(landOn(PORTS[0].mapPos, PORTS.find((p) => p.id === 'germany')!.mapPos)).not.toBeNull();
  });

  it('출항점은 갇힌 호수가 아니라 큰 바다(독일 포함)', () => {
    for (const p of PORTS) {
      const e = exitPoint(p, mask);
      expect(isOcean(mask, e.x, e.y), p.id).toBe(true);
      expect(nearestPortWithin(e), p.id).toBeNull();
    }
  });

  it('모든 항구 → 모든 항구 경로의 샘플점이 전부 바다이고 목적 항구 반경에서 끝난다', () => {
    for (const from of PORTS) {
      for (const to of PORTS) {
        if (from === to) continue;
        const path = [exitPoint(from, mask), ...routeBetween(from.id, to.id)];
        for (let i = 1; i < path.length; i++) {
          expect(landOn(path[i - 1], path[i]), `${from.id}→${to.id} #${i}`).toBeNull();
        }
        expect(nearestPortWithin(path[path.length - 1])?.id, `${from.id}→${to.id}`).toBe(to.id);
      }
    }
  });

  it('부산에서 12항구 전부 닿는다(새 판 시작 = 부산 출항점)', () => {
    const reached = PORTS.filter((to) => {
      const path = [exitPoint(PORTS[0], mask), ...routeBetween('busan', to.id)];
      return path.every((p, i) => i === 0 || !landOn(path[i - 1], p)) && nearestPortWithin(path[path.length - 1])?.id === to.id;
    });
    expect(reached.map((p) => p.id)).toEqual(PORTS.map((p) => p.id));
  });
});
