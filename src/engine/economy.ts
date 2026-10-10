import type { GoodId, Port, PortId, Recipe } from '../content/types';
import { GOOD_BY_ID, EVENT_ONLY_GOODS } from '../content/goods';
import { PORTS, PORT_BY_ID, REFUEL_PRICE, SHORTAGE_MULT, SPECIALTY_MULT, START_CASH, START_FUEL } from '../content/ports';
import type { GameState, Item, LogInput, Reason, Result } from './types';

export const CARGO_CAP = 4;
export const PORT_CALLS = 6;
export const FUEL_CAP = START_FUEL;
export const EMPLOYMENT_PER_LEVEL = 120;
/** 누적 수출액 임계값: 1→2, 2→3 */
export const FACTORY_THRESHOLDS = [1500, 3500] as const;
export const MAX_FACTORY_LEVEL = 3;

/* ── 연료 ──────────────────────────────────────────────
 * 연료 1 = 급유 1코인(COIN_PER_FUEL = 1, content START_FUEL 주석 "연료 단위 = 코인 급유가와 같은 눈금").
 * FUEL_PER_UNIT = 지도 비율 거리 1 당 연료.
 *   부산에서 가장 먼 항구(칠레, 직선 0.6040)의 편도 = REFUEL_PRICE.far(150) 이 되게 floor(150 / 0.6040) = 248.
 *   → 부산→상하이 0.0566 ≈ 14, 부산→사우디 0.2555 ≈ 63, 부산→LA 0.2717 ≈ 67, 칠레 ≈ 150.
 * 지도 핀 좌표가 50/100/150 비율이 아니라서(사우디·LA 거리가 거의 같다) 거리 비례로는 세 값을 동시에 맞출 수 없다.
 * 파산 불가 불변식(아래 assert)을 지키는 쪽으로 맞췄다. 사우디 ≈ 100 이 필요하면 START_FUEL·START_CASH 판정이 먼저다.
 */
export const COIN_PER_FUEL = 1;
export const FUEL_PER_UNIT = 248;

export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
export const fuelCostFor = (distance: number) => distance * FUEL_PER_UNIT;

const HOME = PORT_BY_ID.busan;
/** 부산에서 가장 먼 항구까지 편도 연료 */
export const MAX_LEG_FUEL = Math.max(...PORTS.map((p) => fuelCostFor(dist(HOME.mapPos, p.mapPos))));
/** 한 번 입항에 필요한 최대 급유비 */
export const MAX_REFUEL = REFUEL_PRICE.far;

/* 파산 불가 불변식(PRD §4.7, S9): 시작 연료로 최장 왕복, 한 푼도 못 벌어도 6회 급유 */
if (!(START_FUEL >= 2 * MAX_LEG_FUEL)) throw new Error(`invariant: START_FUEL ${START_FUEL} < round trip ${2 * MAX_LEG_FUEL}`);
if (!(MAX_LEG_FUEL * COIN_PER_FUEL <= MAX_REFUEL)) throw new Error(`invariant: max leg ${MAX_LEG_FUEL} > MAX_REFUEL ${MAX_REFUEL}`);
if (!(START_CASH >= MAX_REFUEL * PORT_CALLS)) throw new Error(`invariant: START_CASH ${START_CASH} < ${MAX_REFUEL} x ${PORT_CALLS}`);

/* ── 가격 ── */
const ALL_SPECIALTIES = new Set(PORTS.flatMap((p) => p.specialties));

/** 기준가 × 특산 0.6 / 결핍 1.6 / 보통 1.0 × 이벤트 배수. 싱가포르는 특산·결핍이 없어 전부 1.0 */
export function priceAt(port: Port, good: GoodId, factor: Partial<Record<GoodId, number>> = {}): number {
  const mult = port.specialties.includes(good) ? SPECIALTY_MULT : port.shortages.some((s) => s.good === good) ? SHORTAGE_MULT : 1;
  return Math.round(GOOD_BY_ID[good].basePrice * mult * (factor[good] ?? 1));
}

/** 한국 특산품을 외국에서 사기(M7) */
export const isOwnSpecialtyAbroad = (port: Port, good: GoodId) => port.id !== 'busan' && HOME.specialties.includes(good);

/** 항구가 파는 상품: 특산. 싱가포르는 모든 나라 특산을 중계. 외국 어디서나 한국 특산은 살 수 있지만 1.6배(M7) */
export function sellsHere(port: Port, good: GoodId): boolean {
  if (EVENT_ONLY_GOODS.includes(good)) return false;
  if (port.specialties.includes(good)) return true;
  if (port.id === 'singapore') return ALL_SPECIALTIES.has(good);
  return isOwnSpecialtyAbroad(port, good);
}

/** 실제 구매 단가 */
export function buyPrice(state: GameState, port: Port, good: GoodId): number {
  const p = priceAt(port, good, state.flags.priceFactor);
  return isOwnSpecialtyAbroad(port, good) ? Math.round(p * SHORTAGE_MULT) : p;
}

/* ── 화물 ── */
export const qtyOf = (items: Item[], good?: GoodId) => items.reduce((n, i) => n + (good === undefined || i.good === good ? i.qty : 0), 0);

function addItem(items: Item[], item: Item): Item[] {
  const i = items.findIndex((x) => x.good === item.good && x.origin === item.origin);
  if (i < 0) return [...items, { ...item }];
  return items.map((x, j) => (j === i ? { ...x, qty: x.qty + item.qty } : x));
}

/** 앞에서부터 qty 만큼 꺼낸다. 호출 전에 qtyOf 로 충분한지 확인할 것 */
function takeItem(items: Item[], good: GoodId, qty: number): { rest: Item[]; taken: Item[] } {
  let need = qty;
  const taken: Item[] = [];
  const rest: Item[] = [];
  for (const x of items) {
    if (x.good !== good || need === 0) { rest.push(x); continue; }
    const n = Math.min(x.qty, need);
    need -= n;
    taken.push({ ...x, qty: n });
    if (x.qty > n) rest.push({ ...x, qty: x.qty - n });
  }
  return { rest, taken };
}

/* ── 로그 ── */
export function withLog(state: GameState, ...events: LogInput[]): GameState {
  let t = state.log.length ? state.log[state.log.length - 1].t : 0;
  return { ...state, log: [...state.log, ...events.map((e) => ({ ...e, t: ++t }) as GameState['log'][number])] };
}

const reject = (state: GameState, reason: Reason): Result => ({ state, reason });

/* ── 공장 레벨 ── */
export function factoryLevelFor(exportValue: number, delta: number): number {
  const lv = 1 + FACTORY_THRESHOLDS.filter((v) => exportValue >= v).length + delta;
  return Math.max(1, Math.min(MAX_FACTORY_LEVEL, lv));
}

export function withFactory(state: GameState): GameState {
  const factoryLevel = factoryLevelFor(state.flags.exportValue, state.flags.factoryDelta);
  return { ...state, factoryLevel, employment: EMPLOYMENT_PER_LEVEL * factoryLevel };
}

/* ── 거래 ── */
function tradePort(state: GameState): Port | Reason {
  if (state.stage !== 'main') return 'wrong_stage';
  if (state.location === 'sea') return 'not_in_port';
  if (state.flags.towedCall) return 'towed_no_trade';
  return PORT_BY_ID[state.location];
}

const badQty = (qty: number) => !Number.isInteger(qty) || qty < 1;

/** fee = 판정 모듈이 준 통관 수수료 비율(0 / 0.1). slots = 통관 지연 시 이번 입항 적재 칸(기본 4) */
export function buy(state: GameState, good: GoodId, qty: number, fee = 0, slots = CARGO_CAP): Result {
  const port = tradePort(state);
  if (typeof port === 'string') return reject(state, port);
  if (badQty(qty)) return reject(state, 'bad_qty');
  if (!sellsHere(port, good)) return reject(state, 'not_sold_here');
  if (qtyOf(state.cargo) + qty > Math.min(CARGO_CAP, slots)) return reject(state, 'cargo_full');
  const price = buyPrice(state, port, good);
  const total = price * qty;
  const feeAmt = Math.round(total * fee);
  if (state.cash < total + feeAmt) return reject(state, 'no_cash');
  const own = isOwnSpecialtyAbroad(port, good);
  const next = { ...state, cash: state.cash - total - feeAmt, cargo: addItem(state.cargo, { good, qty, origin: port.id }) };
  if (port.id === 'busan') return { state: withLog(next, { type: 'buy_home', good, qty, price }) };
  return {
    state: withLog(next, {
      type: 'trade', from: port.id, to: 'busan', good, qty, price, dir: 'import',
      ...(feeAmt ? { fee: feeAmt } : {}), ...(own ? { flag: 'buying_own_specialty' as const } : {}),
    }),
    ...(own ? { flag: 'buying_own_specialty' as const } : {}),
  };
}

export function sell(state: GameState, good: GoodId, qty: number, fee = 0): Result {
  const port = tradePort(state);
  if (typeof port === 'string') return reject(state, port);
  if (badQty(qty)) return reject(state, 'bad_qty');
  if (qtyOf(state.cargo, good) < qty) return reject(state, 'not_in_cargo');
  const price = priceAt(port, good, state.flags.priceFactor);
  const { rest, taken } = takeItem(state.cargo, good, qty);
  const total = price * qty;
  const feeAmt = Math.round(total * fee);
  let exported = 0;
  const logs: LogInput[] = taken.map((x) => {
    const origin = x.origin ?? 'busan';
    const share = Math.round(feeAmt * (x.qty / qty));
    if (port.id === 'busan') return { type: 'trade', from: origin, to: 'busan', good, qty: x.qty, price, dir: 'import', ...(share ? { fee: share } : {}) };
    const dir = origin !== 'busan' && origin !== port.id ? 'transit' : 'export';
    if (dir === 'export') exported += price * x.qty;
    return { type: 'trade', from: origin, to: port.id, good, qty: x.qty, price, dir, ...(share ? { fee: share } : {}) };
  });
  const next: GameState = {
    ...state,
    cash: state.cash + total - feeAmt,
    cargo: rest,
    flags: { ...state.flags, exportValue: state.flags.exportValue + exported },
  };
  return { state: withFactory(withLog(next, ...logs)) };
}

/** 부산 창고 → 배(수출 선적). 한국 결핍 자원(원유·천연가스·흑연·니켈)은 창고에 없어서 막히고 M2 로그 */
export function load(state: GameState, good: GoodId, qty: number): Result {
  const port = tradePort(state);
  if (typeof port === 'string') return reject(state, port);
  if (port.id !== 'busan') return reject(state, 'not_at_busan');
  if (badQty(qty)) return reject(state, 'bad_qty');
  if (qtyOf(state.depot, good) < qty) {
    const m2 = HOME.shortages.some((s) => s.good === good);
    return { state: m2 ? withLog(state, { type: 'export_attempt_blocked', good }) : state, reason: 'not_in_depot' };
  }
  if (qtyOf(state.cargo) + qty > CARGO_CAP) return reject(state, 'cargo_full');
  const { rest, taken } = takeItem(state.depot, good, qty);
  const cargo = taken.reduce(addItem, state.cargo);
  return { state: withLog({ ...state, depot: rest, cargo }, { type: 'load', good, qty }) };
}

/** 부산 공장 가공. 입력은 창고 먼저, 모자라면 배에서. 출력은 창고로 */
export function process(state: GameState, recipe: Recipe): Result {
  const port = tradePort(state);
  if (typeof port === 'string') return reject(state, port);
  if (port.id !== 'busan') return reject(state, 'not_at_busan');
  if (recipe.inputs.some((i) => qtyOf(state.depot, i.good) + qtyOf(state.cargo, i.good) < i.qty)) return reject(state, 'missing_inputs');
  let { depot, cargo } = state;
  const inputsOrigin: PortId[] = [];
  for (const i of recipe.inputs) {
    const fromDepot = Math.min(i.qty, qtyOf(depot, i.good));
    const d = takeItem(depot, i.good, fromDepot);
    const c = takeItem(cargo, i.good, i.qty - fromDepot);
    depot = d.rest;
    cargo = c.rest;
    for (const x of [...d.taken, ...c.taken]) {
      const o = x.origin ?? 'busan';
      if (!inputsOrigin.includes(o)) inputsOrigin.push(o);
    }
  }
  depot = addItem(depot, { good: recipe.output, qty: 1, origin: 'busan' });
  return { state: withLog({ ...state, depot, cargo }, { type: 'process', recipe: recipe.id, inputsOrigin }) };
}

/* ── 연료 ── */
/** 항구에서 급유. amount 생략 = 가득. 현금이 허락하는 만큼만 산다 */
export function refuel(state: GameState, amount = FUEL_CAP): Result {
  if (state.stage !== 'main') return reject(state, 'wrong_stage');
  if (state.location === 'sea') return reject(state, 'not_in_port');
  const space = FUEL_CAP - state.fuel;
  const want = Math.min(amount, space);
  if (want <= 0) return reject(state, 'tank_full');
  const unit = COIN_PER_FUEL * state.flags.refuelFactor;
  const fuel = Math.min(want, Math.floor(state.cash / unit));
  if (fuel <= 0) return reject(state, 'no_cash');
  const cost = Math.round(fuel * unit);
  return {
    state: withLog({ ...state, fuel: state.fuel + fuel, cash: state.cash - cost }, { type: 'refuel', port: state.location, fuel, cost }),
  };
}

/** 항해. 거리만큼 연료 소비, 연료가 모자라면 남은 연료만큼만 가고 0 이 된다(→ tow). 매 프레임 액션이라 로그 없음 */
export function moveShip(state: GameState, dx: number, dy: number): Result {
  if (state.stage !== 'main') return reject(state, state.stage === 'epilogue' || state.stage === 'done' ? 'game_over' : 'wrong_stage');
  if (state.location !== 'sea') return reject(state, 'not_at_sea');
  if (state.fuel <= 0) return reject(state, 'no_fuel');
  const d = Math.hypot(dx, dy);
  if (d === 0) return { state };
  const cost = fuelCostFor(d);
  const k = cost > state.fuel ? state.fuel / cost : 1;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    state: {
      ...state,
      fuel: k < 1 ? 0 : state.fuel - cost,
      shipPos: { x: clamp(state.shipPos.x + dx * k), y: clamp(state.shipPos.y + dy * k) },
    },
  };
}

export function nearestPort(pos: { x: number; y: number }): Port {
  return PORTS.reduce((a, b) => (dist(pos, b.mapPos) < dist(pos, a.mapPos) ? b : a));
}

/** 연료 0 → 예인선이 가장 가까운 항구로. 입항 1회로 세고, 그 입항은 거래 불가·급유만(수익 0) */
export function tow(state: GameState): Result {
  if (state.stage !== 'main') return reject(state, 'wrong_stage');
  if (state.location !== 'sea') return reject(state, 'not_at_sea');
  if (state.fuel > 0) return reject(state, 'has_fuel');
  if (state.portCalls >= PORT_CALLS) return reject(state, 'game_over');
  const port = nearestPort(state.shipPos);
  const next: GameState = {
    ...state,
    location: port.id,
    shipPos: { ...port.mapPos },
    portCalls: state.portCalls + 1,
    flags: { ...state.flags, towedCall: true },
  };
  return { state: withLog(next, { type: 'towed', to: port.id }, { type: 'port_call', port: port.id, turn: next.portCalls }) };
}
