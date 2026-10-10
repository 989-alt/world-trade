import type { Pos } from './ship';

/** 1 = 육지. mask-worldmap.png 흰색 = 육지. ocean = 큰 바다와 이어진 바다 칸(1), 없으면 검사 안 함 */
export type Mask = { width: number; height: number; data: Uint8Array; ocean?: Uint8Array };

/** 인도양 한가운데(열린 바다). 이 점과 4방향으로 이어진 바다만 ocean */
export const OCEAN_SEED = { x: 0.3, y: 0.75 };

/** 갇힌 호수(독일 동쪽 등)를 가려내려고 큰 바다를 한 번 채운다 */
export function withOcean(m: Mask, seed: Pos = OCEAN_SEED): Mask {
  const { width: w, height: h, data } = m;
  const ocean = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const visit = (j: number) => {
    if (j < 0 || j >= w * h || data[j] === 1 || ocean[j] === 1) return;
    ocean[j] = 1;
    q[tail++] = j;
  };
  visit(Math.floor(seed.y * h) * w + Math.floor(seed.x * w));
  while (head < tail) {
    const i = q[head++];
    if (i % w > 0) visit(i - 1);
    if (i % w < w - 1) visit(i + 1);
    visit(i - w);
    visit(i + w);
  }
  return { ...m, ocean };
}

/** 비율 좌표가 큰 바다인가(ocean 이 없으면 육지만 아니면 된다) */
export function isOcean(m: Mask, x: number, y: number): boolean {
  if (isLand(m, x, y)) return false;
  return !m.ocean || m.ocean[Math.floor(y * m.height) * m.width + Math.floor(x * m.width)] === 1;
}

/** 한 번에 검사하는 최대 이동(마스크 픽셀). 1px 두께 해안도 건너뛰지 않는다 */
export const STEP_PX = 1;

export function maskFromRGBA(width: number, height: number, rgba: Uint8ClampedArray): Mask {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4] > 127 ? 1 : 0;
  return { width, height, data };
}

/** 비율 좌표가 육지인가. 지도 밖도 육지(벽) */
export function isLand(m: Mask, x: number, y: number): boolean {
  const px = Math.floor(x * m.width);
  const py = Math.floor(y * m.height);
  if (px < 0 || py < 0 || px >= m.width || py >= m.height) return true;
  return m.data[py * m.width + px] === 1;
}

/** 선수·선미 = 중심에서 헤딩 방향 ±14 마스크px(월드 = 마스크 크기라 월드px 와 같다). 배 그림 36px 의 끝보다 조금 안쪽 */
export const HULL_PX = 14;

/** p 에 헤딩 dir(마스크 픽셀 공간 단위벡터, 0 벡터면 중심만)로 놓인 배의 선수·중심·선미 중 하나라도 육지인가 */
export function hullOnLand(m: Mask, p: Pos, dir: Pos, half = HULL_PX): boolean {
  const hx = (dir.x * half) / m.width;
  const hy = (dir.y * half) / m.height;
  return isLand(m, p.x, p.y) || isLand(m, p.x + hx, p.y + hy) || isLand(m, p.x - hx, p.y - hy);
}

/** 경로 위 어느 점에서라도 선체 3점(선수·중심·선미) 중 하나가 육지면 제자리(같은 객체) 반환 — 미끄러짐·밀어내기·관통 없음 */
export function tryMove(m: Mask, pos: Pos, delta: Pos): Pos {
  const dist = Math.hypot(delta.x * m.width, delta.y * m.height);
  const steps = Math.max(1, Math.ceil(dist / STEP_PX));
  const dir = dist === 0 ? { x: 0, y: 0 } : { x: (delta.x * m.width) / dist, y: (delta.y * m.height) / dist };
  for (let i = 1; i <= steps; i++) {
    if (hullOnLand(m, { x: pos.x + (delta.x * i) / steps, y: pos.y + (delta.y * i) / steps }, dir)) return pos;
  }
  return { x: pos.x + delta.x, y: pos.y + delta.y };
}
