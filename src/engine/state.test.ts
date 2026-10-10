import { describe, expect, it } from 'vitest';
import { EVENTS } from '../content/events';
import { GOOD_IDS } from '../content/types';
import { PORT_BY_ID, PORTS } from '../content/ports';
import { priceAt } from './economy';
import { REQUIRED_EVENT_DIST, distanceEventFor, drawEvents, newGame, nextEventFor, reduce, type Action } from './state';
import type { GameState } from './types';

const last = <T>(a: T[], n = 1) => a[a.length - n];

const REQUIRED = EVENTS.filter((e) => e.required).map((e) => e.id);
const OPTIONAL = EVENTS.filter((e) => !e.required).map((e) => e.id);

function run(state: GameState | null, actions: Action[]) {
  let s = state;
  const reasons: (string | undefined)[] = [];
  for (const a of actions) {
    const r = reduce(s, a);
    reasons.push(r.reason);
    s = r.state;
  }
  return { state: s!, reasons };
}

const start = (seed = 42) => run(null, [{ type: 'NEW_GAME', seed, profile: { nickname: '바다', seat: '7' } }, { type: 'START_MAIN' }]).state;

/** 한 판 대본: 부산 선적 → 사우디 → 부산 가공 … 시세 기록 */
function script(seed: number) {
  const { state, reasons } = run(null, [
    { type: 'NEW_GAME', seed, profile: { nickname: '바다', seat: '7' } },
    { type: 'START_MAIN' },
    { type: 'BUY', good: 'phone', qty: 2 },
    { type: 'LEAVE_PORT' },
    { type: 'MOVE_SHIP', dx: -0.22, dy: 0.13 },
    { type: 'ENTER_PORT', port: 'saudi' },
    { type: 'SELL', good: 'phone', qty: 2, fee: 0.1 },
    { type: 'BUY', good: 'crude-oil', qty: 3 },
    { type: 'REFUEL' },
    { type: 'LEAVE_PORT' },
    { type: 'ENTER_PORT', port: 'busan' },
    { type: 'PROCESS', recipe: 'refine' },
    { type: 'STAY_HOME' },
  ]);
  const prices = PORTS.map((p) => GOOD_IDS.map((g) => priceAt(p, g, state.flags.priceFactor)));
  return { state, reasons, prices };
}

describe('결정성', () => {
  it('seed 42 두 번 → 이벤트 순서·시세·상태 deep-equal', () => {
    const a = script(42);
    const b = script(42);
    expect(a).toEqual(b);
    expect(a.state.eventQueue).toHaveLength(6);
    expect(a.reasons.every((r) => r === undefined)).toBe(true);
  });

  it('seed 가 다르면 이벤트 순서가 달라질 수 있다', () => {
    const queues = new Set(Array.from({ length: 20 }, (_, i) => drawEvents(i).join(',')));
    expect(queues.size).toBeGreaterThan(1);
  });
});

describe('이벤트 드로우', () => {
  it('seed 100개: 6장 중 필수 5장 포함률 100%, 선택 1장, 중복 없음', () => {
    const optionalSeen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const q = drawEvents(seed);
      expect(q).toHaveLength(6);
      expect(new Set(q).size).toBe(6);
      expect([...q.slice(0, 5)].sort()).toEqual([...REQUIRED].sort());
      expect(OPTIONAL).toContain(q[5]);
      optionalSeen.add(q[5]);
    }
    expect(optionalSeen.size).toBeGreaterThan(1);
  });

  it('n번째 출항 뒤 첫 해역 진입에 필수 n번째 카드, 뽑힌 카드는 재발동 없음', () => {
    let s = start();
    expect(nextEventFor(s, 'yellow-sea')).toBeNull(); // 부산 정박 중
    s = reduce(s, { type: 'LEAVE_PORT' }).state;
    const first = nextEventFor(s, 'some-zone');
    expect(first?.id).toBe(s.eventQueue[0]);
    s = reduce(s, { type: 'EVENT_CHOICE', eventId: first!.id, choiceId: first!.choices[0].id }).state;
    expect(s.eventsDrawn).toEqual([first!.id]);
    expect(nextEventFor(s, 'some-zone')).toBeNull();
    expect(reduce(s, { type: 'EVENT_CHOICE', eventId: first!.id, choiceId: first!.choices[0].id }).reason).toBe('already_drawn');
    s = run(s, [{ type: 'ENTER_PORT', port: 'japan' }, { type: 'LEAVE_PORT' }]).state;
    expect(nextEventFor(s, 'some-zone')?.id).toBe(s.eventQueue[1]);
  });

  it('R1 해역을 하나도 안 지나도(부산↔일본 왕복) 출항점에서 0.04 멀어지면 필수 카드 — 한 판에 5장 전부', () => {
    let s = start();
    for (let leg = 0; leg < 6; leg++) {
      s = reduce(s, { type: 'LEAVE_PORT' }).state;
      if (s.stage !== 'main') break;
      const exit = { ...s.shipPos };
      expect(distanceEventFor(s, exit)).toBeNull(); // 출항점 그대로
      s = reduce(s, { type: 'MOVE_SHIP', dx: REQUIRED_EVENT_DIST * 0.9, dy: 0 }).state;
      expect(distanceEventFor(s, exit)).toBeNull(); // 0.036 — 아직
      s = reduce(s, { type: 'MOVE_SHIP', dx: REQUIRED_EVENT_DIST * 0.2, dy: 0 }).state;
      const ev = distanceEventFor(s, exit);
      if (leg < 5) {
        expect(ev?.id).toBe(s.eventQueue[leg]); // n번째 출항 = n번째 필수 카드
        expect(ev?.required).toBe(true);
        s = reduce(s, { type: 'EVENT_CHOICE', eventId: ev!.id, choiceId: ev!.choices[0].id }).state;
      } else {
        expect(ev).toBeNull(); // 선택 카드는 거리로 뜨지 않는다(해역 트리거만)
      }
      expect(distanceEventFor(s, exit)).toBeNull(); // 한 출항에 한 장
      s = reduce(s, { type: 'ENTER_PORT', port: leg % 2 ? 'busan' : 'japan' }).state;
    }
    const chosen = s.log.flatMap((e) => (e.type === 'event_choice' ? [e.event] : []));
    expect([...chosen].sort()).toEqual([...REQUIRED].sort());
  });

  it('선택 카드는 자기 해역에서 뜬다', () => {
    const s = reduce(start(), { type: 'LEAVE_PORT' }).state;
    const opt = EVENTS.find((e) => e.id === s.eventQueue[5])!;
    expect(nextEventFor(s, opt.zone)?.id).toBe(opt.id);
  });

  it('자동화 항만 투자 → 급유 20% 할인, 가격 효과·평판·공장 효과 적용', () => {
    let s = reduce(start(), { type: 'LEAVE_PORT' }).state;
    s = { ...s, eventQueue: [...s.eventQueue.slice(0, 5), 'port-automation'] };
    s = reduce(s, { type: 'EVENT_CHOICE', eventId: 'port-automation', choiceId: 'invest' }).state;
    expect(s.flags.refuelFactor).toBe(0.8);
    s = run(s, [{ type: 'ENTER_PORT', port: 'saudi' }]).state;
    s = { ...s, fuel: 200 };
    const r = reduce(s, { type: 'REFUEL' }); // 사우디 mid 100 × 0.8
    expect(s.cash - r.state.cash).toBe(80);

    let t = reduce(start(), { type: 'LEAVE_PORT' }).state;
    t = reduce(t, { type: 'EVENT_CHOICE', eventId: 'steel-dumping', choiceId: 'tariff' }).state;
    expect(priceAt(PORT_BY_ID.shanghai, 'steel', t.flags.priceFactor)).toBe(Math.round(100 * 0.6 * 1.2));
    t = reduce(t, { type: 'EVENT_CHOICE', eventId: 'fair-trade', choiceId: 'fair' }).state;
    expect(t.reputation).toBe(1);
    t = reduce(t, { type: 'EVENT_CHOICE', eventId: 'factory-relocation', choiceId: 'move' }).state;
    expect([t.factoryLevel, t.employment]).toEqual([2, 240]);
  });
});

describe('턴 진행', () => {
  it('자급자족 턴 — 턴 +1, 이익 0, 이벤트 미발생, 로그 autarky', () => {
    const s = start();
    const r = reduce(s, { type: 'STAY_HOME' });
    expect(r.reason).toBeUndefined();
    expect(r.state.portCalls).toBe(s.portCalls + 1);
    expect(r.state.cash).toBe(s.cash);
    expect(r.state.departures).toBe(0);
    expect(r.state.eventsDrawn).toEqual([]);
    expect(nextEventFor(r.state, 'korea-strait')).toBeNull();
    expect(last(r.state.log)).toMatchObject({ type: 'autarky', turn: 1 });
    expect(reduce({ ...s, location: 'saudi' }, { type: 'STAY_HOME' }).reason).toBe('not_at_busan');
  });

  it('6번째 입항 뒤 출항 → stage epilogue, 추가 항해·입항 거부', () => {
    let s = start();
    for (let i = 0; i < 6; i++) {
      s = run(s, [{ type: 'LEAVE_PORT' }, { type: 'ENTER_PORT', port: i % 2 ? 'busan' : 'japan' }]).state;
    }
    expect(s.portCalls).toBe(6);
    expect(s.stage).toBe('main'); // 6번째 항구에서는 아직 거래 가능
    s = reduce(s, { type: 'LEAVE_PORT' }).state;
    expect(s.stage).toBe('epilogue');
    expect(last(s.log)).toMatchObject({ type: 'stage', stage: 'epilogue' });
    for (const a of [
      { type: 'LEAVE_PORT' }, { type: 'ENTER_PORT', port: 'saudi' }, { type: 'MOVE_SHIP', dx: 0.1, dy: 0 }, { type: 'STAY_HOME' },
    ] as Action[]) {
      const r = reduce(s, a);
      expect(r.reason).toBe('game_over');
      expect(r.state).toBe(s);
    }
    expect(reduce(s, { type: 'FINISH' }).state.stage).toBe('done');
  });

  it('머물기만 6번 해도 epilogue', () => {
    const s = run(start(), Array.from({ length: 6 }, () => ({ type: 'STAY_HOME' }) as Action)).state;
    expect(s.stage).toBe('epilogue');
    expect(s.log.filter((e) => e.type === 'autarky')).toHaveLength(6);
  });

  it('예인 입항도 1회로 센다(자급자족과 같은 수익 0)', () => {
    let s = reduce(start(), { type: 'LEAVE_PORT' }).state;
    s = { ...s, fuel: 0 };
    const r = reduce(s, { type: 'TOW' });
    expect(r.state.portCalls).toBe(1);
    expect(r.state.location).toBe('busan');
    expect(r.state.cash).toBe(s.cash);
  });

  it('거부는 state 불변 + reason, 모든 상태 변화는 t 단조 증가 로그', () => {
    const s = start();
    const r = reduce(s, { type: 'BUY', good: 'robot', qty: 1 });
    expect(r.reason).toBe('not_sold_here');
    expect(r.state).toBe(s);
    const { state } = script(42);
    const ts = state.log.map((e) => e.t);
    expect(ts).toEqual(ts.map((_, i) => i + 1));
    expect(state.log.map((e) => e.type)).toEqual([
      'stage', 'buy_home', 'depart', 'port_call', 'trade', 'trade', 'refuel', 'depart', 'port_call', 'process', 'autarky',
    ]);
  });

  it('프롤로그 중 거래·항해 거부', () => {
    const s = newGame(1, { nickname: 'a', seat: '1' });
    expect(reduce(s, { type: 'LEAVE_PORT' }).reason).toBe('wrong_stage');
    expect(reduce(s, { type: 'BUY', good: 'semiconductor', qty: 1 }).reason).toBe('wrong_stage');
  });
});
