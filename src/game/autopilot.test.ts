import { describe, expect, it } from 'vitest';
import { PORTS } from '../content/ports';
import { LONGEST_ROUTE, TANK, dist, fuelCostFor } from '../engine/economy';
import { routeBetween } from './autopilot';
import type { Mask } from './collision';
import { DOCK_RADIUS, nearestPortWithin, posAfterDialog } from './ports-layout';

/** 부산 출항점(경로 첫 점)부터 도착점까지 꺾은선 길이(비율 거리 = 엔진 연료 잣대) */
const routeLength = (to: (typeof PORTS)[number]['id']) => {
  const r = routeBetween('busan', to);
  return r.slice(1).reduce((L, p, i) => L + dist(r[i], p), 0);
};

describe('연료 보정(바닷길 기준)', () => {
  it('12항구 전부 부산 출발 뱃길 연료 ≤ TANK×0.9(270), 최장 = 독일 = LONGEST_ROUTE', () => {
    for (const p of PORTS) expect(fuelCostFor(routeLength(p.id)), p.id).toBeLessThanOrEqual(TANK * 0.9);
    const longest = PORTS.reduce((a, b) => (routeLength(b.id) > routeLength(a.id) ? b : a));
    expect(longest.id).toBe('germany');
    expect(routeLength('germany')).toBeCloseTo(LONGEST_ROUTE, 4);
  });
});

describe('대화창 닫은 뒤 배 위치', () => {
  const sea: Mask = { width: 1536, height: 1024, data: new Uint8Array(1536 * 1024) };
  // T11 재현점(seed 42): 남중국해 무전 카드가 베트남 반경 안에서 떴다
  const inVietnam = { x: 0.4205, y: 0.4851 };

  it('무전 카드·일지 닫기는 항구 반경 안이어도 제자리', () => {
    expect(nearestPortWithin(inVietnam)?.id).toBe('vietnam');
    expect(posAfterDialog(inVietnam, sea, false)).toBe(inVietnam);
  });

  it('출항만 반경 밖 출항점으로 옮긴다', () => {
    const out = posAfterDialog(inVietnam, sea, true);
    expect(out).not.toEqual(inVietnam);
    expect(nearestPortWithin(out)).toBeNull();
    expect(dist(out, PORTS.find((p) => p.id === 'vietnam')!.mapPos)).toBeCloseTo(DOCK_RADIUS * 1.5, 9);
  });
});
