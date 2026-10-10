import { describe, expect, it } from 'vitest';
import type { PortId } from '../content/types';
import { PORT_BY_ID, PORTS, REFUEL_PRICE, START_CASH, START_FUEL } from '../content/ports';
import { RECIPES } from '../content/recipes';
import {
  CARGO_CAP, COIN_PER_FUEL, FUEL_PER_UNIT, MAX_LEG_FUEL, MAX_REFUEL, PORT_CALLS,
  buy, dist, factoryLevelFor, fuelCostFor, load, moveShip, priceAt, process, refuel, sell, tow,
} from './economy';
import { newGame, reduce } from './state';
import type { GameState, Item } from './types';

const last = <T>(a: T[], n = 1) => a[a.length - n];

const main = () => reduce(newGame(42, { nickname: '테스트', seat: '1' }), { type: 'START_MAIN' }).state;
const at = (port: PortId, patch: Partial<GameState> = {}): GameState => ({
  ...main(), location: port, shipPos: { ...PORT_BY_ID[port].mapPos }, ...patch,
});
const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;
const legFuel = (a: PortId, b: PortId) => fuelCostFor(dist(PORT_BY_ID[a].mapPos, PORT_BY_ID[b].mapPos));

describe('가격 공식', () => {
  it('기준가 × 특산 0.6 / 결핍 1.6 / 보통 1.0, 싱가포르 전부 1.0', () => {
    expect(priceAt(PORT_BY_ID.saudi, 'crude-oil')).toBe(36); // 60 × 0.6
    expect(priceAt(PORT_BY_ID.busan, 'crude-oil')).toBe(96); // 60 × 1.6
    expect(priceAt(PORT_BY_ID.la, 'rice')).toBe(40); // 보통
    for (const g of ['crude-oil', 'semiconductor', 'nickel', 'car'] as const) {
      expect(priceAt(PORT_BY_ID.singapore, g)).toBe(priceAt({ ...PORT_BY_ID.singapore, specialties: [], shortages: [] }, g));
    }
    expect(priceAt(PORT_BY_ID.singapore, 'semiconductor')).toBe(350);
  });
});

describe('사고팔기', () => {
  it('적재 4칸 초과 — 5번째 구매 거부 cargo_full, state 불변', () => {
    let s = at('saudi');
    for (let i = 0; i < CARGO_CAP; i++) {
      const r = buy(s, 'crude-oil', 1);
      expect(r.reason).toBeUndefined();
      s = r.state;
    }
    const r5 = buy(s, 'crude-oil', 1);
    expect(r5.reason).toBe('cargo_full');
    expect(r5.state).toBe(s);
    expect(r5.state).toEqual(s);
  });

  it('현금 부족 — no_cash, 부분 구매 없음', () => {
    const s = at('saudi', { cash: 100 }); // 원유 36 × 3 = 108
    const r = buy(s, 'crude-oil', 3);
    expect(r.reason).toBe('no_cash');
    expect(r.state).toBe(s);
    expect(r.state.cargo).toEqual([]);
    expect(r.state.cash).toBe(100);
  });

  it('한국 특산품을 외국에서 구매 — 가격 1.6배 + flag buying_own_specialty (M7)', () => {
    const s = at('singapore');
    const r = buy(s, 'semiconductor', 1);
    expect(r.flag).toBe('buying_own_specialty');
    expect(START_CASH - r.state.cash).toBe(Math.round(350 * 1.6));
    const tr = last(r.state.log);
    expect(tr).toMatchObject({ type: 'trade', dir: 'import', flag: 'buying_own_specialty', price: 560 });
    // 베트남 무선 통신 기기: 특산 0.6 × M7 1.6
    const v = buy(at('vietnam'), 'phone', 1);
    expect(v.flag).toBe('buying_own_specialty');
    expect(START_CASH - v.state.cash).toBe(Math.round(Math.round(300 * 0.6) * 1.6));
    // 외국 특산은 flag 없음
    expect(buy(at('saudi'), 'crude-oil', 1).flag).toBeUndefined();
  });

  it('원유·천연가스·흑연·니켈을 부산에서 수출(선적) — not_in_depot + export_attempt_blocked (M2)', () => {
    for (const g of ['crude-oil', 'natural-gas', 'graphite', 'nickel'] as const) {
      const s = at('busan');
      const r = load(s, g, 1);
      expect(r.reason).toBe('not_in_depot');
      expect(last(r.state.log)).toMatchObject({ type: 'export_attempt_blocked', good: g });
      expect(r.state.depot).toEqual(s.depot);
      expect(r.state.cargo).toEqual(s.cargo);
      expect(r.state.cash).toBe(s.cash);
    }
    // 부산 시장도 결핍 자원은 팔지 않는다
    expect(buy(at('busan'), 'crude-oil', 1).reason).toBe('not_sold_here');
    // 창고에 있는 한국 상품은 선적된다
    const ok = load(at('busan'), 'semiconductor', 2);
    expect(ok.reason).toBeUndefined();
    expect(ok.state.cargo).toEqual([{ good: 'semiconductor', qty: 2, origin: 'busan' }]);
  });

  it('통관 수수료 — fee 0.1 이면 거래액 10% 차감(사고팔기 모두)', () => {
    const b = buy(at('saudi'), 'crude-oil', 2, 0.1); // 72 + 7
    expect(START_CASH - b.state.cash).toBe(72 + Math.round(72 * 0.1));
    expect(last(b.state.log)).toMatchObject({ type: 'trade', fee: 7 });
    const cargo: Item[] = [{ good: 'crude-oil', qty: 2, origin: 'saudi' }];
    const s = sell(at('busan', { cargo }), 'crude-oil', 2, 0.1); // 96 × 2 = 192, 수수료 19
    expect(s.state.cash - START_CASH).toBe(192 - 19);
    const s0 = sell(at('busan', { cargo }), 'crude-oil', 2, 0);
    expect(s0.state.cash - START_CASH).toBe(192);
  });

  it('통관 지연 — slots 3 이면 4번째 적재 거부', () => {
    let s = at('saudi');
    for (let i = 0; i < 3; i++) s = buy(s, 'crude-oil', 1, 0.1, 3).state;
    expect(buy(s, 'crude-oil', 1, 0.1, 3).reason).toBe('cargo_full');
  });

  it('거래 방향 로그: 외국에서 사면 import, 한국 상품을 외국에 팔면 export, 외국 상품을 다른 외국에 팔면 transit', () => {
    const cargo: Item[] = [{ good: 'semiconductor', qty: 1, origin: 'busan' }, { good: 'crude-oil', qty: 1, origin: 'singapore' }];
    let s = at('la', { cargo });
    s = sell(s, 'semiconductor', 1).state;
    expect(last(s.log)).toMatchObject({ type: 'trade', from: 'busan', to: 'la', dir: 'export' });
    s = sell(s, 'crude-oil', 1).state;
    expect(last(s.log)).toMatchObject({ type: 'trade', from: 'singapore', to: 'la', dir: 'transit' });
  });
});

describe('공장', () => {
  it('레시피 입력 부족 — 흑연만 있으면 배터리 가공 거부, 입력 소모 없음', () => {
    const s = at('busan', { cargo: [{ good: 'graphite', qty: 1, origin: 'shanghai' }] });
    const r = process(s, recipe('battery'));
    expect(r.reason).toBe('missing_inputs');
    expect(r.state).toBe(s);
    expect(r.state.cargo).toEqual([{ good: 'graphite', qty: 1, origin: 'shanghai' }]);
  });

  it('inputsOrigin = 입력 원산지(중복 제거): 흑연(상하이)+니켈(인도네시아) → [shanghai, indonesia]', () => {
    const s = at('busan', {
      cargo: [{ good: 'graphite', qty: 1, origin: 'shanghai' }, { good: 'nickel', qty: 1, origin: 'indonesia' }],
    });
    const r = process(s, recipe('battery'));
    expect(r.reason).toBeUndefined();
    expect(last(r.state.log)).toMatchObject({ type: 'process', recipe: 'battery', inputsOrigin: ['shanghai', 'indonesia'] });
    expect(r.state.cargo).toEqual([]);
    expect(r.state.depot).toContainEqual({ good: 'battery', qty: 1, origin: 'busan' });
    // 같은 원산지 둘이면 한 번만
    const dup = process(at('busan', { cargo: [{ good: 'crude-oil', qty: 1, origin: 'saudi' }], depot: [{ good: 'crude-oil', qty: 1, origin: 'saudi' }] }), recipe('refine'));
    expect(last(dup.state.log)).toMatchObject({ inputsOrigin: ['saudi'] });
  });

  it('가공은 부산에서만', () => {
    const s = at('shanghai', { cargo: [{ good: 'graphite', qty: 1 }, { good: 'nickel', qty: 1 }] });
    expect(process(s, recipe('battery')).reason).toBe('not_at_busan');
  });

  it('공장 레벨 — 누적 수출액 1500·3500 을 넘으면 1→2→3, 고용 수치 증가', () => {
    expect([0, 1499, 1500, 3499, 3500, 99999].map((v) => factoryLevelFor(v, 0))).toEqual([1, 1, 2, 2, 3, 3]);
    // 자동차(한국산)를 LA(결핍 1.6)에 판다: 560 × 1.6 = 896
    let s = at('la', { cargo: [{ good: 'car', qty: 4, origin: 'busan' }] });
    expect([s.factoryLevel, s.employment]).toEqual([1, 120]);
    s = sell(s, 'car', 2).state; // 1792
    expect([s.factoryLevel, s.employment]).toEqual([2, 240]);
    s = sell(s, 'car', 2).state; // 3584
    expect([s.factoryLevel, s.employment]).toEqual([3, 360]);
    expect(s.flags.exportValue).toBe(3584);
  });

  it('중계(transit)·부산 판매는 수출액에 안 들어간다', () => {
    const s = sell(at('la', { cargo: [{ good: 'car', qty: 2, origin: 'singapore' }] }), 'car', 2).state;
    expect(s.flags.exportValue).toBe(0);
  });
});

describe('연료', () => {
  it('보정: 부산에서 가장 먼 항구(칠레) 편도 = REFUEL_PRICE.far(150), 연료 1 = 1코인', () => {
    expect(COIN_PER_FUEL).toBe(1);
    expect(FUEL_PER_UNIT).toBe(Math.floor(REFUEL_PRICE.far / dist(PORT_BY_ID.busan.mapPos, PORT_BY_ID.chile.mapPos)));
    expect(legFuel('busan', 'chile')).toBeGreaterThan(REFUEL_PRICE.far * 0.99);
    expect(legFuel('busan', 'chile')).toBeLessThanOrEqual(REFUEL_PRICE.far);
    // 거리 비례 실측값(보고용 기록). PRD 목표 50/100/150 과의 차이는 지도 좌표 비율 문제
    expect(Math.round(legFuel('busan', 'shanghai'))).toBe(14);
    expect(Math.round(legFuel('busan', 'saudi'))).toBe(63);
    expect(Math.round(legFuel('busan', 'la'))).toBe(67);
    expect(legFuel('busan', 'shanghai')).toBeLessThan(legFuel('busan', 'saudi'));
    expect(legFuel('busan', 'saudi')).toBeLessThan(legFuel('busan', 'la'));
  });

  it('항해 — 이동 거리만큼 연료 소비, 모자라면 남은 만큼만 가고 0', () => {
    const sea = { ...at('busan'), location: 'sea' as const };
    const r = moveShip(sea, 0.1, 0);
    expect(r.state.fuel).toBeCloseTo(START_FUEL - 0.1 * FUEL_PER_UNIT, 6);
    expect(r.state.shipPos.x).toBeCloseTo(sea.shipPos.x + 0.1, 9);
    const low = moveShip({ ...sea, fuel: 0.05 * FUEL_PER_UNIT }, 0.1, 0);
    expect(low.state.fuel).toBe(0);
    expect(low.state.shipPos.x).toBeCloseTo(sea.shipPos.x + 0.05, 9);
    expect(moveShip(low.state, 0.1, 0).reason).toBe('no_fuel');
    expect(moveShip(at('busan'), 0.1, 0).reason).toBe('not_at_sea');
  });

  it('급유 — 코인→연료, 현금만큼만, 0 이면 no_cash, 가득이면 tank_full', () => {
    const r = refuel(at('saudi', { fuel: 200 }), 100);
    expect([r.state.fuel, START_CASH - r.state.cash]).toEqual([300, 100]);
    expect(last(r.state.log)).toMatchObject({ type: 'refuel', port: 'saudi', fuel: 100, cost: 100 });
    const part = refuel(at('saudi', { fuel: 0, cash: 40 }));
    expect([part.state.fuel, part.state.cash]).toEqual([40, 0]);
    const none = refuel(at('saudi', { fuel: 0, cash: 0 }));
    expect(none.reason).toBe('no_cash');
    expect(refuel(at('saudi')).reason).toBe('tank_full');
  });

  it('자동화 항만 선택 후 급유 20% 할인', () => {
    const s = at('saudi', { fuel: 200 });
    const r = refuel({ ...s, flags: { ...s.flags, refuelFactor: 0.8 } }, 100);
    expect(START_CASH - r.state.cash).toBe(80);
  });

  it('파산 불가 불변식 — START_FUEL ≥ 최장 왕복, START_CASH ≥ MAX_REFUEL × 6, 모든 부산 편도 ≤ MAX_REFUEL', () => {
    expect(MAX_REFUEL).toBe(150);
    expect(START_FUEL).toBeGreaterThanOrEqual(2 * MAX_LEG_FUEL);
    expect(START_CASH).toBeGreaterThanOrEqual(MAX_REFUEL * PORT_CALLS);
    for (const p of PORTS) expect(legFuel('busan', p.id) * COIN_PER_FUEL).toBeLessThanOrEqual(MAX_REFUEL);
  });

  it('연료 0 — 예인: 가장 가까운 항구, 입항 +1, 거래 불가·급유만, 로그 towed', () => {
    const s: GameState = { ...at('busan'), location: 'sea', fuel: 0, shipPos: { x: 0.45, y: 0.36 } }; // 상하이 근처
    expect(tow({ ...s, fuel: 1 }).reason).toBe('has_fuel');
    const r = tow(s);
    expect(r.state.location).toBe('shanghai');
    expect(r.state.portCalls).toBe(s.portCalls + 1);
    expect(r.state.flags.towedCall).toBe(true);
    expect(r.state.log.map((e) => e.type)).toEqual(['stage', 'towed', 'port_call']);
    expect(last(r.state.log, 2)).toMatchObject({ type: 'towed', to: 'shanghai' });
    expect(r.state.cash).toBe(s.cash); // 무료, 수익 0
    expect(buy(r.state, 'graphite', 1).reason).toBe('towed_no_trade');
    expect(sell({ ...r.state, cargo: [{ good: 'rice', qty: 1 }] }, 'rice', 1).reason).toBe('towed_no_trade');
    const f = refuel(r.state, 50);
    expect(f.reason).toBeUndefined();
    expect(f.state.fuel).toBe(50);
  });
});
