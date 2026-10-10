import { describe, expect, it } from 'vitest';
import { newGame, reduce } from './state';
import { AUTOSAVE_POINTS, loadGame, saveGame, SAVE_KEY, type KV } from './save';

const mem = (init: Record<string, string> = {}): KV & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
const game = () => reduce(newGame(42, { nickname: '바다', seat: '7' }), { type: 'START_MAIN' }).state;

describe('save / load', () => {
  it('round-trips under ktrade.save.v1', () => {
    const kv = mem();
    const s = game();
    expect(saveGame(s, kv)).toEqual({ ok: true });
    expect(Object.keys(kv.data)).toEqual([SAVE_KEY]);
    expect(loadGame(kv)).toEqual({ ok: true, state: s });
  });

  it('no save → notice none', () => {
    expect(loadGame(mem())).toEqual({ ok: false, notice: 'none' });
    expect(loadGame(null)).toEqual({ ok: false, notice: 'none' });
  });

  it('corrupted JSON → save_corrupted, never throws', () => {
    for (const bad of ['{"version":1,', 'null', '42', '{"version":1}', 'undefined']) {
      expect(loadGame(mem({ [SAVE_KEY]: bad }))).toEqual({ ok: false, notice: 'save_corrupted' });
    }
    const throwing: KV = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {} };
    expect(() => loadGame(throwing)).not.toThrow();
  });

  it('version mismatch → refused with notice', () => {
    const s = { ...game(), version: 2 };
    expect(loadGame(mem({ [SAVE_KEY]: JSON.stringify(s) }))).toEqual({ ok: false, notice: 'version_mismatch' });
  });

  it('QuotaExceeded → ok:false quota, no throw, game state untouched', () => {
    const full: KV = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    const s = game();
    expect(saveGame(s, full)).toEqual({ ok: false, notice: 'quota' });
    expect(saveGame(s, null)).toEqual({ ok: false, notice: 'quota' });
    expect(reduce(s, { type: 'LEAVE_PORT' }).reason).toBeUndefined(); // 진행은 계속
  });

  it('autosave points for the UI', () => {
    expect(AUTOSAVE_POINTS).toEqual(['port_call', 'judgment_done', 'event_choice']);
  });
});
