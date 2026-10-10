import { describe, expect, it } from 'vitest';
import type { PortId } from '../content/types';
import { PORT_BY_ID, PORTS, REFUEL_PRICE, START_CASH, START_FUEL } from '../content/ports';
import { RECIPES } from '../content/recipes';
import {
  CARGO_CAP, FUEL_PER_UNIT, LONGEST_ROUTE, MAX_LEG_FUEL, MAX_REFUEL, PORT_CALLS, TANK,
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
    const cargo: Item[] = [{ good: 'semiconductor', qty: 1, origin: 'busan' }, { good: 'car', qty: 1, origin: 'singapore' }];
    let s = at('la', { cargo });
    s = sell(s, 'semiconductor', 1).state;
    expect(last(s.log)).toMatchObject({ type: 'trade', from: 'busan', to: 'la', dir: 'export' });
    s = sell(s, 'car', 1).state;
    expect(last(s.log)).toMatchObject({ type: 'trade', from: 'singapore', to: 'la', dir: 'transit' });
  });

  it('R9 결핍 목록 밖 상품은 사 주지 않는다(not_sold_here, state 불변). 싱가포르만 전부', () => {
    const cargo: Item[] = [{ good: 'rice', qty: 1, origin: 'thai' }, { good: 'phone', qty: 1, origin: 'busan' }];
    const la = at('la', { cargo });
    const r = sell(la, 'rice', 1);
    expect(r.reason).toBe('not_sold_here');
    expect(r.state).toBe(la);
    expect(sell(at('germany', { cargo }), 'phone', 1).reason).toBe('not_sold_here'); // 독일은 결핍 목록 없음
    expect(sell(at('saudi', { cargo }), 'phone', 1).reason).toBeUndefined();
    expect(sell(at('singapore', { cargo }), 'rice', 1).reason).toBeUndefined();
  });

  it('R10 산 항구에 되팔기(origin === port) = 중계, 수출액 미반영', () => {
    const s = sell(at('singapore', { cargo: [{ good: 'robot', qty: 2, origin: 'singapore' }] }), 'robot', 2).state;
    expect(last(s.log)).toMatchObject({ type: 'trade', from: 'singapore', to: 'singapore', dir: 'transit' });
    expect(s.flags.exportValue).toBe(0);
    const k = sell(at('singapore', { cargo: [{ good: 'robot', qty: 2, origin: 'busan' }] }), 'robot', 2).state;
    expect(last(k.log)).toMatchObject({ dir: 'export' });
    expect(k.flags.exportValue).toBeGreaterThan(0);
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
  it('소비: 부산 출발 최장 바닷길(독일, LONGEST_ROUTE) ≈ 270 ≤ TANK×0.9, 직선 편도는 전부 그 안', () => {
    expect(FUEL_PER_UNIT).toBe(Math.floor((TANK * 0.9) / LONGEST_ROUTE));
    expect(MAX_LEG_FUEL).toBe(fuelCostFor(LONGEST_ROUTE));
    expect(MAX_LEG_FUEL).toBeLessThanOrEqual(270);
    expect(MAX_LEG_FUEL).toBeGreaterThan(265);
    for (const p of PORTS) expect(legFuel('busan', p.id)).toBeLessThan(MAX_LEG_FUEL);
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

  it('급유 요금제 — 가득 채우고 정액: 부산 0 / 상하이 50 / 사우디 100 / LA 150', () => {
    for (const [port, fare] of [['busan', 0], ['shanghai', 50], ['saudi', 100], ['la', 150]] as const) {
      const r = refuel(at(port, { fuel: 10 }));
      expect(r.reason).toBeUndefined();
      expect([r.state.fuel, START_CASH - r.state.cash]).toEqual([TANK, fare]);
      expect(last(r.state.log)).toMatchObject({ type: 'refuel', port, fuel: TANK - 10, cost: fare });
    }
  });

  it('자동화 항만 선택 후 급유 20% 할인 — 사우디 100 → 80', () => {
    const s = at('saudi', { fuel: 200 });
    const r = refuel({ ...s, flags: { ...s.flags, refuelFactor: 0.8 } });
    expect(START_CASH - r.state.cash).toBe(80);
  });

  it('급유 거부 — 가득이면 tank_full, 요금보다 현금이 적으면 no_cash(부분 급유 없음)', () => {
    const full = at('saudi');
    expect(refuel(full).reason).toBe('tank_full');
    expect(refuel(full).state).toBe(full);
    const poor = at('saudi', { fuel: 0, cash: 99 });
    const r = refuel(poor);
    expect(r.reason).toBe('no_cash');
    expect(r.state).toBe(poor);
    expect(refuel(at('busan', { fuel: 0, cash: 0 })).state.fuel).toBe(TANK); // 부산은 0코인
  });

  it('파산 불가 불변식 — START_FUEL = TANK = 300 ≥ 최장 편도, START_CASH ≥ 150 × 6', () => {
    expect(TANK).toBe(300);
    expect(START_FUEL).toBe(TANK);
    expect(TANK).toBeGreaterThanOrEqual(MAX_LEG_FUEL);
    for (const p of PORTS) expect(legFuel('busan', p.id)).toBeLessThanOrEqual(TANK);
    expect(MAX_REFUEL).toBe(REFUEL_PRICE.far);
    expect(MAX_REFUEL).toBe(150);
    expect(START_CASH).toBeGreaterThanOrEqual(MAX_REFUEL * PORT_CALLS);
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
    const f = refuel(r.state);
    expect(f.reason).toBeUndefined();
    expect(f.state.fuel).toBe(TANK);
  });

  it('R4 예인 입항 급유 = min(요금, 현금): 현금 0·요금 미만이어도 만탱크로 출항 가능, 다음 입항은 정상 요금', () => {
    const towed = (cash: number): GameState => {
      const s = { ...at('busan'), location: 'sea' as const, fuel: 0, cash, shipPos: { ...PORT_BY_ID.chile.mapPos } };
      return tow(s).state;
    };
    for (const [cash, cost] of [[0, 0], [40, 40], [1000, 150]] as const) {
      const r = refuel(towed(cash));
      expect(r.reason).toBeUndefined();
      expect(r.state.fuel).toBe(TANK);
      expect(r.state.cash).toBe(cash - cost);
      expect(last(r.state.log)).toMatchObject({ type: 'refuel', port: 'chile', cost });
      expect(reduce(r.state, { type: 'LEAVE_PORT' }).reason).toBeUndefined();
    }
    expect(refuel(at('chile', { fuel: 0, cash: 40 })).reason).toBe('no_cash'); // 예인 아니면 그대로
  });
});
