import { describe, expect, it } from 'vitest';
import { EVENTS } from '../content/events';
import { PORTS } from '../content/ports';
import { REQUIRED_EVENT_DIST, newGame, reduce, requiredEventNow } from '../engine/state';
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
  it('12항구 전부 부산 출발 뱃길 연료 ≤ TANK×0.9(270), 최장 = 독일(북극해 금지, 아프리카를 돈다) = LONGEST_ROUTE', () => {
    for (const p of PORTS) expect(fuelCostFor(routeLength(p.id)), p.id).toBeLessThanOrEqual(TANK * 0.9);
    const longest = PORTS.reduce((a, b) => (routeLength(b.id) > routeLength(a.id) ? b : a));
    expect(longest.id).toBe('germany');
    expect(routeLength('germany')).toBeCloseTo(LONGEST_ROUTE, 4);
  });
});

describe('대화창 닫은 뒤 배 위치', () => {
  const sea: Mask = { width: 3072, height: 2048, data: new Uint8Array(3072 * 2048) };
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

describe('F1·F4 밀린 필수 카드 — 짧은 뱃길·입항 직전(requiredEventNow 동작)', () => {
  const start = () => reduce(newGame(42, { nickname: 't', seat: '1' }), { type: 'START_MAIN' }).state;
  it('부산→일본: 실제 출항점에서 일본 반경까지 0.04 미만 — 항해 중엔 안 뜨고, 입항 직전엔 뜬다. 고른 뒤엔 입항', () => {
    const exit = routeBetween('busan', 'japan')[0]; // 부산 출항점(exitPoint, 마스크 위 첫 바다 점 — collision.test 'autopilot waypoints' 검증)
    const japan = PORTS.find((p) => p.id === 'japan')!.mapPos;
    expect(nearestPortWithin(exit)).toBeNull();
    expect(dist(exit, PORTS.find((p) => p.id === 'busan')!.mapPos)).toBeCloseTo(DOCK_RADIUS * 1.5, 3);
    // 출항점에서 일본 쪽으로 곧장: 일본 반경 경계에 닿는 점
    const d = dist(exit, japan);
    const k = (d - DOCK_RADIUS + 1e-6) / d;
    const edge = { x: exit.x + (japan.x - exit.x) * k, y: exit.y + (japan.y - exit.y) * k };
    expect(dist(edge, exit)).toBeLessThan(REQUIRED_EVENT_DIST);
    expect(nearestPortWithin(edge)?.id).toBe('japan');

    let s = reduce(start(), { type: 'LEAVE_PORT' }).state;
    s = { ...s, shipPos: exit };
    s = reduce(s, { type: 'MOVE_SHIP', dx: edge.x - exit.x, dy: edge.y - exit.y }).state;
    expect(requiredEventNow(s, exit, false)).toBeNull(); // 거리 트리거만으론 놓친다
    const card = requiredEventNow(s, exit, true);
    expect(card?.id).toBe(s.eventQueue[0]);
    s = reduce(s, { type: 'EVENT_CHOICE', eventId: card!.id, choiceId: card!.choices[0].id }).state;
    expect(requiredEventNow(s, exit, true)).toBeNull(); // 두 번 뜨지 않는다
    expect(reduce(s, { type: 'ENTER_PORT', port: 'japan' }).reason).toBeUndefined();
  });
  it('부산↔일본만 왕복해도 6구간에 필수 5장 전부, 결정적', () => {
    const play = () => {
      let s = start();
      for (let leg = 0; leg < 6; leg++) {
        s = reduce(s, { type: 'LEAVE_PORT' }).state;
        const card = requiredEventNow(s, s.shipPos, true);
        if (card) s = reduce(s, { type: 'EVENT_CHOICE', eventId: card.id, choiceId: card.choices[0].id }).state;
        s = reduce(s, { type: 'ENTER_PORT', port: leg % 2 ? 'busan' : 'japan' }).state;
      }
      return s;
    };
    const a = play();
    expect([...a.eventsDrawn].sort()).toEqual(EVENTS.filter((e) => e.required).map((e) => e.id).sort());
    expect(play()).toEqual(a);
  });
  it('예인 직전에도 밀린 필수 카드(연료 0, 출항점 근처)', () => {
    let s = reduce(start(), { type: 'LEAVE_PORT' }).state;
    s = { ...s, fuel: 0 };
    expect(requiredEventNow(s, s.shipPos, true)?.required).toBe(true);
  });
});

describe('결정성 금지 토큰', () => {
  it('항해 씬에 Math.random·Date 없음(시드 난수만)', async () => {
    expect((await import('./SailingScene.ts?raw')).default).not.toMatch(/Math\.random|Date\.now|new Date/);
  });
});

describe('R17 boot 배경색', () => {
  it('tokens.css --color-sea 를 읽는다(hex 하드코딩 없음)', async () => {
    const src = (await import('./boot.ts?raw')).default;
    expect(src).toContain("getPropertyValue('--color-sea')");
    expect(src).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
