import { PORT_BY_ID } from '../content/ports';

/** 지도 1536×1024(3:2)를 가로 1280 에 맞춘 월드. 비율 좌표 x·y 는 이 크기에 곱한다 */
export const WORLD_W = 1280;
export const WORLD_H = (1280 * 1024) / 1536; // 853.33

export type Pos = { x: number; y: number };
export type Keys = { up: boolean; down: boolean; left: boolean; right: boolean };
export type Heading = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export const HEADINGS: Heading[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];

/** 비율 좌표 두 점의 월드 픽셀 거리(가로·세로 배율이 달라서 픽셀로 잰다) */
export const pxDist = (a: Pos, b: Pos) => Math.hypot((a.x - b.x) * WORLD_W, (a.y - b.y) * WORLD_H);

/**
 * PRD §3: 부산→LA 직선 약 25초.
 * 부산(.48,.33)→LA(.75,.36) = hypot(.27×1280, .03×853.3) = 346.5px → 346.5/25 = 13.86 px/s (60fps 에서 0.231 px/프레임)
 */
export const SAIL_SECONDS = 25;
export const SPEED_PX = pxDist(PORT_BY_ID.busan.mapPos, PORT_BY_ID.la.mapPos) / SAIL_SECONDS;

/** 키 집합 → 단위 방향(대각선 정규화). 반대 키는 상쇄, 입력 없으면 0 벡터 */
export function dirFromKeys(k: Keys): Pos {
  const x = (k.right ? 1 : 0) - (k.left ? 1 : 0);
  const y = (k.down ? 1 : 0) - (k.up ? 1 : 0);
  const len = Math.hypot(x, y);
  return len === 0 ? { x: 0, y: 0 } : { x: x / len, y: y / len };
}

/** 단위 방향(월드 픽셀 공간) × 속도 × dt → 비율 좌표 변화량 */
export function stepDelta(dir: Pos, dtMs: number): Pos {
  const px = (SPEED_PX * dtMs) / 1000;
  return { x: (dir.x * px) / WORLD_W, y: (dir.y * px) / WORLD_H };
}

/** 방향 → 8방위(화면 y 는 아래가 +). 0 벡터면 null */
export function headingOf(dir: Pos): Heading | null {
  if (dir.x === 0 && dir.y === 0) return null;
  const sector = Math.round(Math.atan2(dir.y, dir.x) / (Math.PI / 4));
  return HEADINGS[(sector + 8) % 8];
}

export const spriteKey = (h: Heading) => `ship-${h}`;
