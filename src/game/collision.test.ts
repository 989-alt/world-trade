import { describe, expect, it } from 'vitest';
import maskPng from '../../assets/img/mask-worldmap.png?inline';
import { PORTS, PORT_BY_ID } from '../content/ports';
import { nearestPort } from '../engine/economy';
import { createRng } from '../engine/rng';
import { TOW_CELL_PX, routeBetween, towPath } from './autopilot';
import { HULL_PX, STEP_PX, hullOnLand, isLand, isOcean, maskFromRGBA, segmentOnLand, tryMove, withOcean, type Mask } from './collision';
import { exitPoint, nearestPortWithin } from './ports-layout';
import { SPEED_PX, WORLD_H, WORLD_W, type Pos } from './ship';

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

/** 200×200 합성 마스크(1 마스크px = 1 월드px, 런타임과 같은 비율) */
function mask200(land: (x: number, y: number) => boolean): Mask {
  const rgba = new Uint8ClampedArray(200 * 200 * 4);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) rgba[(y * 200 + x) * 4] = land(x, y) ? 255 : 0;
  return maskFromRGBA(200, 200, rgba);
}
const g = (px: number) => px / 200;
/** 동쪽 해안 x ≥ 140, y = 20 한 줄 1px 벽(x 0~19) */
const c200 = mask200((x, y) => x >= 140 || (y === 20 && x < 20));
/** 프레임 이동량(부산→LA 25초 속도, 60fps) */
const FRAME_PX = SPEED_PX / 60;

describe('M4 tryMove (선수 +22·중심 2점, 1px 표본, 선미는 보지 않음)', () => {
  it('sea → sea moves exactly by delta', () => {
    const p = { x: g(60.5), y: g(80.5) };
    const n = tryMove(c200, p, { x: g(1), y: g(5) });
    expect(n.x).toBeCloseTo(g(61.5), 12);
    expect(n.y).toBeCloseTo(g(85.5), 12);
  });

  it('bow into the coast → stops in place (same object: no slide, no push-out)', () => {
    expect(HULL_PX).toBe(22);
    const p = { x: g(117.5), y: g(80.5) }; // 해안(x=140)까지 22.5px: 한 칸 가면 선수가 해안 픽셀
    expect(tryMove(c200, p, { x: g(1), y: 0 })).toBe(p);
    const q = { x: g(125.5), y: g(80.5) };
    expect(tryMove(c200, q, { x: g(1), y: g(1) })).toBe(q); // 대각선 선수도 걸리고 미끄러지지 않음
    expect(tryMove(c200, p, { x: 0, y: g(1) })).not.toBe(p); // 해안과 나란히는 간다
  });

  it('stern on land does not block — the ship pivots and the stern follows the bow', () => {
    const p = { x: g(125.5), y: g(80.5) }; // 해안까지 14.5px
    expect(tryMove(c200, p, { x: g(-1), y: 0 })).not.toBe(p); // 서쪽으로 돌면 선미(+22)는 육지지만 간다
    expect(hullOnLand(c200, { x: g(124.5), y: g(80.5) }, { x: -1, y: 0 })).toBe(true); // 3점으로 보면 걸렸을 자리
  });

  it('parallel to a coast at 20px: turning 90° away moves, turning toward the coast is blocked', () => {
    const coast = { x: g(120), y: g(80.5) };
    expect(tryMove(c200, coast, { x: 0, y: g(-FRAME_PX) })).not.toBe(coast);
    expect(tryMove(c200, coast, { x: g(-FRAME_PX), y: 0 })).not.toBe(coast);
    expect(tryMove(c200, coast, { x: g(FRAME_PX), y: 0 })).toBe(coast);
  });

  it('no tunneling through a 1px wall even with a long jump; steps ≤ 2px', () => {
    const p = { x: g(5.5), y: g(14.5) };
    expect(tryMove(c200, p, { x: 0, y: g(30) })).toBe(p);
    expect(STEP_PX).toBeLessThanOrEqual(2);
    const q = { x: g(5.5), y: g(19.5) };
    expect(tryMove(c200, q, { x: 0, y: g(2) })).toBe(q);
  });

  it('a per-frame step toward the coast is allowed until the bow reaches the coast pixel', () => {
    const p = { x: g(117.2), y: g(80.5) };
    expect(tryMove(c200, p, { x: g(FRAME_PX), y: 0 }).x).toBeCloseTo(g(117.2 + FRAME_PX), 12); // 선수 139.75 = 바다
    const q = { x: g(117.6), y: g(80.5) };
    expect(tryMove(c200, q, { x: g(FRAME_PX), y: 0 })).toBe(q); // 선수 140.15 = 해안
  });
});

/** 프레임마다 FRAME_PX 씩 dir 로 민다. 막히면 그 자리 */
function sailFrames(mk: Mask, from: Pos, dir: Pos, frames: number): Pos {
  let p = from;
  for (let i = 0; i < frames; i++) {
    const n = tryMove(mk, p, { x: g(dir.x * FRAME_PX), y: g(dir.y * FRAME_PX) });
    if (n === p) return p;
    p = n;
  }
  return p;
}

describe('M4 선체 56px · 2점 충돌 — 해협과 해안', () => {
  it('폭 40px 해협(마스크가 이미 6px 부풀림)은 가운데로 끝까지 지난다', () => {
    const strait = mask200((x, y) => y >= 60 && y < 140 && (x < 80 || x >= 120));
    const end = sailFrames(strait, { x: g(100.5), y: g(185.5) }, { x: 0, y: -1 }, 600); // 333px 북상 시도
    expect(end.y * 200).toBeLessThan(30); // 해협(y 60~140)을 다 지나 지도 위 끝(선수 22)까지
  });

  it('해안 60px 앞에서 해안 쪽으로 몰면 해안 22~23px 앞에서 선체가 걸려 선다', () => {
    const start = { x: g(80), y: g(100.5) };
    const end = sailFrames(c200, start, { x: 1, y: 0 }, 1000);
    const gap = 140 - end.x * 200;
    console.log(JSON.stringify({ startGap: 60, stopGap: +gap.toFixed(3) }));
    expect(gap).toBeGreaterThanOrEqual(HULL_PX);
    expect(gap).toBeLessThan(HULL_PX + 1);
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

/** 자동 조타는 입항 반경에 드는 순간 선다 → 경로를 1px 선체 3점으로 훑되 to 반경에 든 첫 표본(그 자리 선체도 바다)에서 멈춘다(validate-routes 와 같은 규칙) */
function landUntilDock(path: Pos[], to: string): Pos | null {
  for (let k = 1; k < path.length; k++) {
    const [a, b] = [path[k - 1], path[k]];
    const n = Math.max(1, Math.ceil(Math.hypot((b.x - a.x) * MASK_W, (b.y - a.y) * MASK_H)));
    const d = { x: (b.x - a.x) * MASK_W, y: (b.y - a.y) * MASK_H };
    const L = Math.hypot(d.x, d.y) || 1;
    for (let i = 0; i <= n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
      if (hullOnLand(mask, p, { x: d.x / L, y: d.y / L })) return p;
      if (nearestPortWithin(p)?.id === to) return null;
    }
  }
  return null;
}
const pathLand = (path: Pos[]) => path.slice(1).map((p, i) => segmentOnLand(mask, path[i], p)).find((l) => l) ?? null;

describe('M1·M7·M8 뱃길 (mask-worldmap.png)', () => {
  it('M1 PNG 를 제대로 풀었다: 3072×2048 = 월드 크기, 육지 2,179,183 픽셀(fix2 마스크)', () => {
    expect([MASK_W, MASK_H]).toEqual([WORLD_W, WORLD_H]);
    expect(mask.data.reduce((n, v) => n + v, 0)).toBe(2179183);
    // 검사기가 육지를 실제로 잡는지: 부산 → 독일 직선은 유라시아를 지난다
    expect(segmentOnLand(mask, PORT_BY_ID.busan.mapPos, PORT_BY_ID.germany.mapPos)).not.toBeNull();
  });

  it('M8 출항점은 핀 반경 0.045 원 위의 큰 바다(갇힌 호수 아님), 선체 3점이 바다인 방향(16방위) 독일 6 · 나머지 16', () => {
    const clearDirs = (e: Pos) =>
      Array.from({ length: 16 }, (_, k) => ({ x: Math.cos((k * Math.PI) / 8), y: Math.sin((k * Math.PI) / 8) })).filter((d) => !hullOnLand(mask, e, d)).length;
    for (const p of PORTS) {
      const e = exitPoint(p, mask);
      expect(isOcean(mask, e.x, e.y), p.id).toBe(true);
      expect(nearestPortWithin(e), p.id).toBeNull();
      expect(Math.hypot(e.x - p.mapPos.x, e.y - p.mapPos.y), p.id).toBeCloseTo(0.045, 9);
      expect(clearDirs(e), p.id).toBe(p.id === 'germany' ? 6 : 16); // 독일 항구는 좁은 물길(T15 새 마스크)
    }
  });

  it('M7 모든 항구 → 모든 항구 경로: 1px 간격 선체 3점이 반경에 들 때까지 전부 바다이고 목적 항구 반경에서 끝난다', () => {
    for (const from of PORTS) {
      for (const to of PORTS) {
        if (from === to) continue;
        const path = [exitPoint(from, mask), ...routeBetween(from.id, to.id)];
        expect(landUntilDock(path, to.id), `${from.id}→${to.id}`).toBeNull();
        expect(nearestPortWithin(path[path.length - 1])?.id, `${from.id}→${to.id}`).toBe(to.id);
      }
    }
  });

  it('부산에서 12항구 전부 닿는다(새 판 시작 = 부산 출항점)', () => {
    const reached = PORTS.filter((to) => {
      const path = [exitPoint(PORTS[0], mask), ...routeBetween('busan', to.id)];
      return !landUntilDock(path, to.id) && nearestPortWithin(path[path.length - 1])?.id === to.id;
    });
    expect(reached.map((p) => p.id)).toEqual(PORTS.map((p) => p.id));
  });
});

/** 뱃길 밖 자유 항해 위치(seed 15): 큰 바다·항구 반경 밖이고 8방향 중 서로 다른 두 축 이상으로 선체 3점이 놓이는 점. validate-routes.mjs 와 같은 규칙 */
function freeSailPositions(n: number): Pos[] {
  const r = createRng(15);
  const out: Pos[] = [];
  while (out.length < n) {
    const p = { x: r.next(), y: r.next() };
    if (!isOcean(mask, p.x, p.y) || nearestPortWithin(p)) continue;
    const ok = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => !hullOnLand(mask, p, { x: Math.cos((k * Math.PI) / 4), y: Math.sin((k * Math.PI) / 4) }));
    if (!ok.some((a) => ok.some((b) => (a - b) % 4 !== 0))) continue; // 한 축(예: 지도 맨 위 가장자리에서 동·서)으로만 놓이는 자리는 배가 돌 수도, 갈 수도 없다
    out.push(p);
  }
  return out;
}

describe('M9 예인 뱃길 — 직선 폴백 없음, 전 구간 1px 선체 3점 바다', () => {
  /** towPath 가 있고, pos 에서 시작해 전 구간 바다, 엔진이 고른 항구 반경에서 끝난다 */
  const expectTow = (pos: Pos, label: string) => {
    const port = nearestPort(pos); // 엔진 TOW 가 고르는 항구
    const path = towPath(pos, port.id, mask);
    expect(path, `${label} → ${port.id}`).not.toBeNull();
    expect(path![0]).toBe(pos);
    expect(pathLand(path!), `${label} → ${port.id}`).toBeNull();
    expect(nearestPortWithin(path![path!.length - 1])?.id, label).toBe(port.id);
    return path!;
  };

  it('부산↔각 항구 뱃길 위 어디서 연료가 떨어져도(25px 마다), 가장 가까운 항구까지 바닷길로 끝까지 간다', () => {
    let samples = 0;
    let bent = 0;
    for (const to of PORTS) {
      if (to.id === 'busan') continue;
      for (const [a, b] of [['busan', to.id], [to.id, 'busan']] as const) {
        const route = [exitPoint(PORT_BY_ID[a], mask), ...routeBetween(a, b)];
        for (let i = 1; i < route.length; i++) {
          const n = Math.ceil(Math.hypot((route[i].x - route[i - 1].x) * MASK_W, (route[i].y - route[i - 1].y) * MASK_H) / 25);
          for (let k = 0; k < n; k++) {
            const pos = { x: route[i - 1].x + ((route[i].x - route[i - 1].x) * k) / n, y: route[i - 1].y + ((route[i].y - route[i - 1].y) * k) / n };
            if (nearestPortWithin(pos)?.id === b) break; // 이미 도착
            const path = expectTow(pos, `${a}→${b} #${i}.${k}`);
            if (segmentOnLand(mask, pos, path[path.length - 1])) bent++; // 직선이었다면 육지를 지났을 경우
            samples++;
          }
        }
      }
    }
    console.log(JSON.stringify({ towSamples: samples, straightWouldHitLand: bent }));
    expect(bent).toBeGreaterThan(0);
  });

  it(`뱃길 밖 자유 항해 위치 seed 고정 50점 + QA 회귀 좌표 (0.5305, 0.5441) → 인도네시아(직결 뱃길 점 없음 → ${TOW_CELL_PX}px 격자 BFS)`, () => {
    const free = freeSailPositions(50);
    expect(free).toHaveLength(50);
    free.forEach((p, i) => expectTow(p, `free#${i}`));
    const qa = { x: 0.5305, y: 0.5441 };
    expect(nearestPort(qa).id).toBe('indonesia');
    const path = expectTow(qa, 'QA');
    console.log(JSON.stringify({ qaTow: path.slice(0, 6).map((p) => [+(p.x * MASK_W).toFixed(1), +(p.y * MASK_H).toFixed(1)]), points: path.length }));
  });

  it('길이 없으면 null(직선 폴백 금지): 사방이 막힌 웅덩이', () => {
    const pond = withOcean(mask200((x, y) => !(x >= 90 && x < 110 && y >= 90 && y < 110)), { x: 0.5, y: 0.5 });
    expect(towPath({ x: 0.5, y: 0.5 }, 'busan', pond)).toBeNull();
  });
});
