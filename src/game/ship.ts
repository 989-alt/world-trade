import { PORT_BY_ID } from '../content/ports';

/** 월드 = 세부 지도 3072×2048(마스크와 같은 크기라 월드 1px = 마스크 1px). 비율 좌표 x·y 는 이 크기에 곱한다 */
export const WORLD_W = 3072;
export const WORLD_H = 2048;

export type Pos = { x: number; y: number };
export type Keys = { up: boolean; down: boolean; left: boolean; right: boolean };
export type Heading = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export const HEADINGS: Heading[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];

/** 비율 좌표 두 점의 월드 픽셀 거리(가로·세로 배율이 달라서 픽셀로 잰다) */
export const pxDist = (a: Pos, b: Pos) => Math.hypot((a.x - b.x) * WORLD_W, (a.y - b.y) * WORLD_H);

/**
 * PRD §3: 부산→LA 직선 약 25초(최고 속도 기준).
 * 부산(.48,.33)→LA(.75,.36) = hypot(.27×3072, .03×2048) = 831.7px → 831.7/25 = 33.27 px/s
 */
export const SAIL_SECONDS = 25;
export const SPEED_PX = pxDist(PORT_BY_ID.busan.mapPos, PORT_BY_ID.la.mapPos) / SAIL_SECONDS;

/** 선회 초당 180°, 정지→최고 0.5초, 키를 놓으면 최고→정지 0.4초(M5) */
export const TURN_RAD_PER_S = Math.PI;
export const ACCEL_S = 0.5;
export const DECEL_S = 0.4;

/** 키 집합 → 단위 방향(대각선 정규화). 반대 키는 상쇄, 입력 없으면 0 벡터 */
export function dirFromKeys(k: Keys): Pos {
  const x = (k.right ? 1 : 0) - (k.left ? 1 : 0);
  const y = (k.down ? 1 : 0) - (k.up ? 1 : 0);
  const len = Math.hypot(x, y);
  return len === 0 ? { x: 0, y: 0 } : { x: x / len, y: y / len };
}

/** 방향(월드 픽셀 공간) → 헤딩 각(라디안, 0 = 동, 화면 y 아래가 +). 0 벡터면 null */
export const angleOf = (dir: Pos): number | null => (dir.x === 0 && dir.y === 0 ? null : Math.atan2(dir.y, dir.x));

/** 키 입력이 아니라 조타 상태: 지금 헤딩(라디안)·속도(월드 px/s) */
export type Helm = { angle: number; speed: number };

/** a → b 의 가장 짧은 회전(−π..π] */
export const angleDiff = (a: number, b: number) => {
  const d = (b - a) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d <= -Math.PI ? d + 2 * Math.PI : d;
};

/**
 * 한 프레임 조타(순수 함수). target = 목표 헤딩(키·자동 조타), null = 입력 없음(감속하며 지금 헤딩으로 미끄러짐).
 * 헤딩은 목표 쪽으로 초당 180° 이하로 돌고, 배는 지금 헤딩으로 나아간다. 목표와 90° 넘게 어긋나 있으면 전진 없이 제자리에서 돈다
 * (전진 = 속도 × max(0, cos 어긋난 각) — 반대로 돌 때 큰 원을 그리며 해안에 걸리지 않게, 선미 피벗 허용과 같은 뜻).
 * move = 비율 좌표 변화량
 */
export function helmStep(h: Helm, target: number | null, dtMs: number): { helm: Helm; move: Pos } {
  const dt = dtMs / 1000;
  let { angle, speed } = h;
  let along = 1;
  if (target === null) speed = Math.max(0, speed - (SPEED_PX * dt) / DECEL_S);
  else {
    const d = angleDiff(angle, target);
    const turn = TURN_RAD_PER_S * dt;
    angle = Math.abs(d) <= turn ? target : angle + Math.sign(d) * turn;
    speed = Math.min(SPEED_PX, speed + (SPEED_PX * dt) / ACCEL_S);
    along = Math.max(0, Math.cos(angleDiff(angle, target)));
  }
  const px = speed * dt * along;
  return { helm: { angle, speed }, move: { x: (Math.cos(angle) * px) / WORLD_W, y: (Math.sin(angle) * px) / WORLD_H } };
}

/** 자동 조타 웨이포인트 도달 판정(월드 px). 선회 반경이 있어 0.5px 에 딱 맞춰 서지 않는다 */
export const ARRIVE_PX = 4;

/** 자동 조타 한 프레임의 목표 헤딩: 4px 안에 든 웨이포인트는 넘긴다. i = 다음 웨이포인트, 끝나면 target null */
export function steer(pos: Pos, path: Pos[], i: number): { i: number; target: number | null } {
  while (i < path.length && pxDist(pos, path[i]) < ARRIVE_PX) i++;
  if (i >= path.length) return { i, target: null };
  return { i, target: Math.atan2((path[i].y - pos.y) * WORLD_H, (path[i].x - pos.x) * WORLD_W) };
}

/** 헤딩 각 → 가장 가까운 8방위 그림 + 남는 회전(도, |잔여| ≤ 22.5) */
export function spriteFor(angle: number): { heading: Heading; residualDeg: number } {
  const sector = Math.round(angle / (Math.PI / 4));
  return { heading: HEADINGS[((sector % 8) + 8) % 8], residualDeg: ((angle - (sector * Math.PI) / 4) * 180) / Math.PI };
}

export const spriteKey = (h: Heading) => `ship-${h}`;
