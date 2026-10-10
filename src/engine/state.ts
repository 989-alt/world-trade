import type { GameEvent, GoodId, PortId, Recipe } from '../content/types';
import { EVENTS } from '../content/events';
import { PORT_BY_ID, START_CASH, START_DEPOT, START_FUEL } from '../content/ports';
import { RECIPES } from '../content/recipes';
import { createRng } from './rng';
import {
  EMPLOYMENT_PER_LEVEL, PORT_CALLS, buy, load, moveShip, process, refuel, sell, tow, withFactory, withLog,
} from './economy';
import type { EventId, GameState, Reason, Result } from './types';

export type Action =
  | { type: 'NEW_GAME'; seed: number; profile: GameState['profile'] }
  | { type: 'START_MAIN' }
  | { type: 'MOVE_SHIP'; dx: number; dy: number }
  | { type: 'ENTER_PORT'; port: PortId }
  | { type: 'LEAVE_PORT' }
  | { type: 'STAY_HOME' }
  | { type: 'BUY'; good: GoodId; qty: number; fee?: number; slots?: number }
  | { type: 'SELL'; good: GoodId; qty: number; fee?: number }
  | { type: 'LOAD'; good: GoodId; qty: number }
  | { type: 'PROCESS'; recipe: Recipe['id'] }
  | { type: 'REFUEL' }
  | { type: 'TOW' }
  | { type: 'EVENT_CHOICE'; eventId: EventId; choiceId: string }
  | { type: 'FINISH' };

const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e])) as Record<EventId, GameEvent>;
const REQUIRED = EVENTS.filter((e) => e.required).map((e) => e.id);
const OPTIONAL = EVENTS.filter((e) => !e.required).map((e) => e.id);

/** 이번 판 6장: 필수 5장(seed 순서) + 선택 풀에서 seed 로 1장(마지막 자리) */
export function drawEvents(seed: number): EventId[] {
  const rng = createRng(seed);
  return [...rng.shuffle(REQUIRED), rng.pick(OPTIONAL)];
}

export function newGame(seed: number, profile: GameState['profile']): GameState {
  const home = PORT_BY_ID.busan;
  return {
    version: 1,
    seed,
    profile: { ...profile },
    cash: START_CASH,
    fuel: START_FUEL,
    cargo: [],
    depot: START_DEPOT.map((i) => ({ ...i, origin: 'busan' as const })),
    factoryLevel: 1,
    employment: EMPLOYMENT_PER_LEVEL,
    reputation: 0,
    location: 'busan',
    shipPos: { ...home.mapPos },
    portCalls: 0,
    departures: 0,
    stage: 'prologue',
    eventQueue: drawEvents(seed),
    eventsDrawn: [],
    log: [],
    flags: { refuelFactor: 1, exportValue: 0, factoryDelta: 0, priceFactor: {}, towedCall: false },
  };
}

/**
 * 해역 진입 시 뜰 이벤트(없으면 null).
 * 선택 1장은 자기 해역에서. 필수 카드 n번째는 n번째 출항 뒤 첫 해역 진입에(놓친 카드는 다음 해역에서 이어서).
 * 뽑힌 카드는 다시 뜨지 않는다.
 */
export function nextEventFor(state: GameState, zone: string): GameEvent | null {
  if (state.stage !== 'main' || state.location !== 'sea') return null;
  const open = (id: EventId | undefined) => id !== undefined && !state.eventsDrawn.includes(id);
  const optional = state.eventQueue[REQUIRED.length];
  if (open(optional) && EVENT_BY_ID[optional].zone === zone) return EVENT_BY_ID[optional];
  const due = state.eventQueue.slice(0, Math.min(state.departures, REQUIRED.length)).find(open);
  return due ? EVENT_BY_ID[due] : null;
}

const reject = (state: GameState, reason: Reason): Result => ({ state, reason });
const over = (s: GameState) => s.stage === 'epilogue' || s.stage === 'done';
const notMain = (s: GameState): Reason | null => (s.stage === 'main' ? null : over(s) ? 'game_over' : 'wrong_stage');
const toEpilogue = (s: GameState) => withLog({ ...s, stage: 'epilogue' }, { type: 'stage', stage: 'epilogue' });

function chooseEvent(state: GameState, eventId: EventId, choiceId: string): Result {
  const bad = notMain(state);
  if (bad) return reject(state, bad);
  if (!state.eventQueue.includes(eventId)) return reject(state, 'unknown_event');
  if (state.eventsDrawn.includes(eventId)) return reject(state, 'already_drawn');
  const choice = EVENT_BY_ID[eventId].choices.find((c) => c.id === choiceId);
  if (!choice) return reject(state, 'unknown_choice');
  const e = choice.effect;
  let flags = state.flags;
  let reputation = state.reputation;
  if (e.type === 'price') flags = { ...flags, priceFactor: { ...flags.priceFactor, [e.good]: (flags.priceFactor[e.good] ?? 1) * e.factor } };
  if (e.type === 'refuelDiscount') flags = { ...flags, refuelFactor: flags.refuelFactor * e.factor };
  if (e.type === 'factoryLevel') flags = { ...flags, factoryDelta: flags.factoryDelta + e.delta };
  if (e.type === 'reputation') reputation += e.delta;
  const next = withFactory({ ...state, flags, reputation, eventsDrawn: [...state.eventsDrawn, eventId] });
  return { state: withLog(next, { type: 'event_choice', event: eventId, choice: choiceId }) };
}

/** 순수 리듀서. 거부는 { state: 그대로, reason } */
export function reduce(state: GameState | null, action: Action): Result {
  if (action.type === 'NEW_GAME') return { state: newGame(action.seed, action.profile) };
  if (!state) throw new Error('reduce: no game — NEW_GAME first');
  switch (action.type) {
    case 'START_MAIN':
      if (state.stage !== 'prologue') return reject(state, 'wrong_stage');
      return { state: withLog({ ...state, stage: 'main' }, { type: 'stage', stage: 'main' }) };
    case 'FINISH':
      if (state.stage !== 'epilogue') return reject(state, 'wrong_stage');
      return { state: withLog({ ...state, stage: 'done' }, { type: 'stage', stage: 'done' }) };
    case 'MOVE_SHIP':
      return moveShip(state, action.dx, action.dy);
    case 'ENTER_PORT': {
      const bad = notMain(state);
      if (bad) return reject(state, bad);
      if (state.location !== 'sea') return reject(state, 'not_at_sea');
      if (state.portCalls >= PORT_CALLS) return reject(state, 'game_over');
      const port = PORT_BY_ID[action.port];
      const next: GameState = {
        ...state,
        location: port.id,
        shipPos: { ...port.mapPos },
        portCalls: state.portCalls + 1,
        flags: { ...state.flags, towedCall: false },
      };
      return { state: withLog(next, { type: 'port_call', port: port.id, turn: next.portCalls }) };
    }
    case 'LEAVE_PORT': {
      const bad = notMain(state);
      if (bad) return reject(state, bad);
      if (state.location === 'sea') return reject(state, 'not_in_port');
      if (state.portCalls >= PORT_CALLS) return { state: toEpilogue(state) };
      const next: GameState = { ...state, location: 'sea', departures: state.departures + 1, flags: { ...state.flags, towedCall: false } };
      return { state: withLog(next, { type: 'depart', port: state.location, departure: next.departures }) };
    }
    case 'STAY_HOME': {
      const bad = notMain(state);
      if (bad) return reject(state, bad);
      if (state.location !== 'busan') return reject(state, 'not_at_busan');
      if (state.portCalls >= PORT_CALLS) return reject(state, 'game_over');
      const next = withLog(
        { ...state, portCalls: state.portCalls + 1, flags: { ...state.flags, towedCall: false } },
        { type: 'autarky', turn: state.portCalls + 1 },
      );
      return { state: next.portCalls >= PORT_CALLS ? toEpilogue(next) : next };
    }
    case 'BUY':
      return buy(state, action.good, action.qty, action.fee, action.slots);
    case 'SELL':
      return sell(state, action.good, action.qty, action.fee);
    case 'LOAD':
      return load(state, action.good, action.qty);
    case 'PROCESS':
      return process(state, RECIPES.find((r) => r.id === action.recipe)!);
    case 'REFUEL':
      return refuel(state);
    case 'TOW':
      return tow(state);
    case 'EVENT_CHOICE':
      return chooseEvent(state, action.eventId, action.choiceId);
  }
}
