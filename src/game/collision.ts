import type { Pos } from './ship';

/** 1 = 육지. mask-worldmap.png 흰색 = 육지 */
export type Mask = { width: number; height: number; data: Uint8Array };

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

/** 경로 위 어느 점이라도 육지면 제자리(같은 객체) 반환 — 미끄러짐·밀어내기·관통 없음 */
export function tryMove(m: Mask, pos: Pos, delta: Pos): Pos {
  const dist = Math.hypot(delta.x * m.width, delta.y * m.height);
  const steps = Math.max(1, Math.ceil(dist / STEP_PX));
  for (let i = 1; i <= steps; i++) {
    if (isLand(m, pos.x + (delta.x * i) / steps, pos.y + (delta.y * i) / steps)) return pos;
  }
  return { x: pos.x + delta.x, y: pos.y + delta.y };
}
