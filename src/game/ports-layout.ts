import { PORTS } from '../content/ports';
import type { Port } from '../content/types';
import { isOcean, type Mask } from './collision';
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

/** 출항 위치: 반경 1.5배 원 위에서 큰 바다(갇힌 호수 제외)이고 어떤 항구 반경에도 들지 않는 첫 점(동쪽부터 15°씩). 없으면 핀 자리 */
export function exitPoint(port: Port, m: Mask): Pos {
  for (let a = 0; a < 360; a += 15) {
    const t = (a * Math.PI) / 180;
    const p = { x: port.mapPos.x + Math.cos(t) * DOCK_RADIUS * 1.5, y: port.mapPos.y + Math.sin(t) * DOCK_RADIUS * 1.5 };
    if (isOcean(m, p.x, p.y) && !nearestPortWithin(p)) return p;
  }
  return { ...port.mapPos };
}
