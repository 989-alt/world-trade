import { EVENTS } from '../content/events';
import { MINDMAP_SLOTS } from '../content/mindmap';
import { RECIPES } from '../content/recipes';
import { AXES, GOOD_IDS, PORT_IDS } from '../content/types';
import type { GameState, LogEvent } from './types';

export const SAVE_KEY = 'ktrade.save.v1';

export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void };
export type LoadResult = { ok: true; state: GameState } | { ok: false; notice: 'save_corrupted' | 'version_mismatch' | 'none' };

const isItem = (x: unknown) => !!x && typeof x === 'object' && (GOOD_IDS as readonly string[]).includes((x as { good: string }).good) && Number.isInteger((x as { qty: number }).qty) && (x as { qty: number }).qty > 0;
const isStr = (x: unknown) => typeof x === 'string';
const STAGES = ['prologue', 'main', 'epilogue', 'done'];

type V = (x: unknown) => boolean;
const oneOf = (xs: readonly unknown[]): V => (x) => xs.includes(x);
const num: V = (x) => typeof x === 'number' && Number.isFinite(x);
const bool: V = (x) => typeof x === 'boolean';
const opt = (v: V): V => (x) => x === undefined || v(x);
const port = oneOf(PORT_IDS);
const good = oneOf(GOOD_IDS);
const ie = oneOf(['import', 'export']);
const attempt = oneOf([1, 2]);
const isEventId = oneOf(EVENTS.map((e) => e.id));

/** 로그 type별 필수 필드·참조 ID 검사. 검증 깊이 상한: flags 내부·수치 일관성은 보지 않는다 */
const LOG_SHAPE: Record<LogEvent['type'], Record<string, V>> = {
  judge_dir: { port, good, answer: ie, correct: bool, attempt },
  judge_cause: { port, good, answer: oneOf(AXES), correct: bool, attempt, dir: opt(ie) },
  trade: { from: port, to: port, good, qty: num, price: num, dir: oneOf(['import', 'export', 'transit']), fee: opt(num), flag: opt(oneOf(['buying_own_specialty'])) },
  process: { recipe: oneOf(RECIPES.map((r) => r.id)), inputsOrigin: (x) => Array.isArray(x) && x.every(port) },
  event_choice: { event: isEventId, choice: isStr },
  autarky: { turn: num },
  export_attempt_blocked: { good },
  sentence: { text: isStr, axes: opt((x) => Array.isArray(x) && x.every(oneOf(AXES))), ending: opt(isStr) },
  mindmap: { slot: oneOf(MINDMAP_SLOTS.map((m) => m.id)), answer: isStr, correct: bool },
  screen: { name: isStr },
  ledger_manual: { exporter: isStr, good: isStr, importer: isStr, correct: bool },
  towed: { to: port },
  refuel: { port, fuel: num, cost: num },
  port_call: { port, turn: num },
  depart: { port, departure: num },
  stage: { stage: oneOf(STAGES) },
  load: { good, qty: num },
  buy_home: { good, qty: num, price: num },
};

const isEvent = (x: unknown) => {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  const shape = Object.prototype.hasOwnProperty.call(LOG_SHAPE, e.type as string) ? LOG_SHAPE[e.type as LogEvent['type']] : null;
  return !!shape && num(e.t) && Object.entries(shape).every(([k, v]) => v(e[k]));
};

function defaultStorage(): KV | null {
  try {
    return (globalThis as { localStorage?: KV }).localStorage ?? null;
  } catch {
    return null; // 사파리 개인 모드 등에서 접근 자체가 throw
  }
}

/** 실패해도 throw 하지 않는다. ok:false 면 UI 가 토스트만 띄우고 게임은 계속 */
export function saveGame(state: GameState, storage: KV | null = defaultStorage()): { ok: true } | { ok: false; notice: 'quota' } {
  try {
    if (!storage) return { ok: false, notice: 'quota' };
    storage.setItem(SAVE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch {
    return { ok: false, notice: 'quota' };
  }
}

/** 「처음으로」에서만 지운다(완주 결과 화면은 새로 고침해도 결과 화면으로 돌아온다) */
export function clearSave(storage: KV | null = defaultStorage()): void {
  try {
    storage?.removeItem?.(SAVE_KEY);
  } catch {
    /* 저장소 접근 불가 */
  }
}

/** 자동 저장: 상태에 로그가 하나라도 새로 붙으면 저장(완주 done 포함). 로그가 줄면 새 판. 저장 결과(없으면 null) */
export function createAutosave(save: (s: GameState) => ReturnType<typeof saveGame> = (s) => saveGame(s)) {
  let seen = 0;
  return (s: GameState | null) => {
    if (!s) return null;
    if (s.log.length < seen) seen = 0;
    const fresh = s.log.length > seen;
    seen = s.log.length;
    return fresh ? save(s) : null;
  };
}

const unit = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;

/** ok:false 면 UI 가 새 게임을 시작하고 notice 를 알린다 */
export function loadGame(storage: KV | null = defaultStorage()): LoadResult {
  let raw: string | null;
  try {
    raw = storage ? storage.getItem(SAVE_KEY) : null;
  } catch {
    return { ok: false, notice: 'none' };
  }
  if (raw === null) return { ok: false, notice: 'none' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, notice: 'save_corrupted' };
  }
  if (!data || typeof data !== 'object') return { ok: false, notice: 'save_corrupted' };
  const s = data as Partial<GameState>;
  if (s.version !== 1) return { ok: false, notice: 'version_mismatch' };
  if (
    !Array.isArray(s.log) || !s.profile || typeof s.cash !== 'number' || !s.flags || !Array.isArray(s.cargo) ||
    !STAGES.includes(s.stage as string) ||
    !(s.location === 'sea' || (PORT_IDS as readonly string[]).includes(s.location as string)) ||
    !s.shipPos || !unit(s.shipPos.x) || !unit(s.shipPos.y) ||
    !Array.isArray(s.eventQueue) || !Array.isArray(s.eventsDrawn) || !Array.isArray(s.depot) ||
    !s.cargo.every(isItem) || !s.depot.every(isItem) || !s.log.every(isEvent) || !s.eventQueue.every(isEventId) || !s.eventsDrawn.every(isEventId) ||
    typeof s.fuel !== 'number' || typeof s.portCalls !== 'number' || typeof s.departures !== 'number'
  ) {
    return { ok: false, notice: 'save_corrupted' };
  }
  return { ok: true, state: s as GameState };
}
