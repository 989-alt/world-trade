import type { GameState } from './types';

export const SAVE_KEY = 'ktrade.save.v1';
/** UI 가 이 시점 직후에 saveGame 을 부른다: 입항(턴 경계)·판정 완료·이벤트 선택 */
export const AUTOSAVE_POINTS = ['port_call', 'judgment_done', 'event_choice'] as const;

export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export type LoadResult = { ok: true; state: GameState } | { ok: false; notice: 'save_corrupted' | 'version_mismatch' | 'none' };

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
  if (!Array.isArray(s.log) || !s.profile || typeof s.cash !== 'number' || !s.flags || !Array.isArray(s.cargo)) {
    return { ok: false, notice: 'save_corrupted' };
  }
  return { ok: true, state: s as GameState };
}
