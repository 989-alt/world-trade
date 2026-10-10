import { PORTS } from '../content/ports';
import type { Port } from '../content/types';
import { hullOnLand, isOcean, type Mask } from './collision';
import type { Pos } from './ship';

/** 입항 가능 반경(비율 좌표, 엔진 dist 와 같은 잣대) */
export const DOCK_RADIUS = 0.03;

export function nearestPortWithin(pos: Pos, r = DOCK_RADIUS): Port | null {
  let best: Port | null = null;
  let bd = r;
  for (const p of PORTS) {
    const d = Math.hypot(pos.x - p.mapPos.x, pos.y - p.mapPos.y);
    if (d <= bd) [best, bd] = [p, d];
  }
  return best;
}

/** 대화창을 닫은 뒤 배 위치: 출항(depart)일 때만 항구 반경 밖 출항점으로. 무전·일지 닫기는 제자리(같은 객체) */
export function posAfterDialog(pos: Pos, m: Mask, depart: boolean): Pos {
  const near = depart ? nearestPortWithin(pos) : null;
  return near ? exitPoint(near, m) : pos;
}

/**
 * 출항 위치: 반경 1.5배 원 위(동쪽부터 15°씩)에서 큰 바다(갇힌 호수 제외)이고 어떤 항구 반경에도 들지 않는 점 중,
 * 선체 3점(±22)이 바다인 방향(16방위)이 가장 많은 점 — 같으면 배 그림 끝(±28)까지 바다인 방향이 많은 점, 그래도 같으면 먼저 본 점.
 * 출항하자마자 어느 쪽 키를 눌러도 막히지 않게(V11). 바다 점이 없으면 핀 자리
 */
export function exitPoint(port: Port, m: Mask): Pos {
  let best: Pos = { ...port.mapPos };
  let bestScore = -1;
  for (let a = 0; a < 360; a += 15) {
    const t = (a * Math.PI) / 180;
    const p = { x: port.mapPos.x + Math.cos(t) * DOCK_RADIUS * 1.5, y: port.mapPos.y + Math.sin(t) * DOCK_RADIUS * 1.5 };
    if (!isOcean(m, p.x, p.y) || nearestPortWithin(p)) continue;
    let score = 0;
    for (let k = 0; k < 16; k++) {
      const dir = { x: Math.cos((k * Math.PI) / 8), y: Math.sin((k * Math.PI) / 8) };
      if (!hullOnLand(m, p, dir)) score += 17;
      if (!hullOnLand(m, p, dir, 28)) score += 1;
    }
    if (score > bestScore) [best, bestScore] = [p, score];
  }
  return best;
}
