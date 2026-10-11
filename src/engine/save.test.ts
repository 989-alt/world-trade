import { describe, expect, it } from 'vitest';
import { newGame, reduce } from './state';
import { clearSave, createAutosave, loadGame, saveGame, SAVE_KEY, type KV } from './save';
import { withLog } from './economy';

const mem = (init: Record<string, string> = {}): KV & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
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

  it('R6 autosave: every state change that appends a log saves; no new log → no save; new game resets', () => {
    const kv = mem();
    const autosave = createAutosave((s) => saveGame(s, kv));
    let s = game();
    expect(autosave(s)).toEqual({ ok: true });
    expect(autosave(s)).toBeNull(); // 로그 그대로(MOVE_SHIP 같은 프레임 변화)
    s = withLog(s, { type: 'screen', name: 'ledger' });
    expect(autosave(s)).toEqual({ ok: true });
    expect(loadGame(kv)).toEqual({ ok: true, state: s });
    expect(autosave(null)).toBeNull();
    expect(autosave(newGame(1, { nickname: 'a', seat: '1' }))).toBeNull(); // 새 판(로그 0): 시작 시 app 이 직접 저장
    expect(autosave(game())).toEqual({ ok: true });
  });

  it('R5 done is saved (not cleared) and restores as done; clearSave removes it', () => {
    const kv = mem();
    const autosave = createAutosave((s) => saveGame(s, kv));
    let s = game();
    s = reduce({ ...s, stage: 'epilogue' }, { type: 'FINISH' }).state;
    expect(s.stage).toBe('done');
    expect(autosave(s)).toEqual({ ok: true });
    const r = loadGame(kv);
    expect(r.ok && r.state.stage).toBe('done');
    clearSave(kv);
    expect(loadGame(kv)).toEqual({ ok: false, notice: 'none' });
    expect(() => clearSave(null)).not.toThrow();
  });

  it('R16 junk stage / location / shipPos / eventQueue → save_corrupted', () => {
    const bad = (patch: Record<string, unknown>) => loadGame(mem({ [SAVE_KEY]: JSON.stringify({ ...game(), ...patch }) }));
    for (const patch of [
      { stage: 'boss' }, { stage: undefined },
      { location: 'atlantis' }, { location: 'toString' }, { location: 3 },
      { shipPos: { x: 2, y: 0.5 } }, { shipPos: { x: 0.5, y: -0.1 } }, { shipPos: { x: '0.5', y: 0.5 } }, { shipPos: null },
      { eventQueue: 'steel-dumping' }, { eventQueue: undefined },
    ]) expect(bad(patch)).toEqual({ ok: false, notice: 'save_corrupted' });
    expect(bad({ location: 'sea', shipPos: { x: 0, y: 1 } }).ok).toBe(true);
    expect(bad({ location: 'chile' }).ok).toBe(true);
  });

  it('Q4 junk depot / eventsDrawn / fuel / portCalls / departures → save_corrupted', () => {
    const bad = (patch: Record<string, unknown>) => loadGame(mem({ [SAVE_KEY]: JSON.stringify({ ...game(), ...patch }) }));
    for (const patch of [
      { depot: undefined }, { depot: null }, { depot: {} },
      { eventsDrawn: undefined }, { eventsDrawn: 'x' },
      { fuel: undefined }, { fuel: '300' },
      { portCalls: undefined }, { portCalls: null },
      { departures: undefined }, { departures: '0' },
    ]) expect(bad(patch)).toEqual({ ok: false, notice: 'save_corrupted' });
  });

  it('Y2 malformed array elements → save_corrupted', () => {
    const bad = (patch: Record<string, unknown>) => loadGame(mem({ [SAVE_KEY]: JSON.stringify({ ...game(), ...patch }) }));
    for (const patch of [
      { cargo: [null] }, { depot: [{ good: 'x', qty: 1 }] }, { cargo: [{ good: 'sugar', qty: 0 }] },
      { log: [1] }, { log: [null] }, { eventQueue: [1] }, { eventsDrawn: [null] },
    ]) expect(bad(patch)).toEqual({ ok: false, notice: 'save_corrupted' });
  });

  it('Z1 log shape per type + reference IDs → save_corrupted; full valid log round-trips', () => {
    const base = game();
    const bad = (patch: Record<string, unknown>) => loadGame(mem({ [SAVE_KEY]: JSON.stringify({ ...base, ...patch }) }));
    for (const patch of [
      { log: [{ type: 'port_call', t: 1, port: 'japan', turn: 1 }, { type: 'trade', t: 2 }] },
      { log: [{ type: 'trade', t: 1, from: 'busan', to: 'mars', good: 'car', qty: 1, price: 1, dir: 'export' }] },
      { log: [{ type: 'judge_cause', t: 1, port: 'saudi', good: 'crude-oil', answer: 'luck', correct: true, attempt: 1 }] },
      { log: [{ type: 'mindmap', t: 1, slot: 'nope', answer: '무역', correct: true }] },
      { log: [{ type: 'event_choice', t: 1, event: 'missing-event', choice: 'x' }] },
      { log: [{ type: 'load', t: 1, good: 'car', qty: '1' }] },
      { log: [{ type: 'mystery', t: 1 }] },
      { eventQueue: base.eventQueue.map((e, i) => (i === 5 ? 'missing-event' : e)) },
      { eventsDrawn: ['missing-event'] },
    ]) expect(bad(patch)).toEqual({ ok: false, notice: 'save_corrupted' });
    const log = [
      { type: 'port_call', port: 'japan', turn: 1 },
      { type: 'judge_dir', port: 'japan', good: 'robot', answer: 'import', correct: true, attempt: 1 },
      { type: 'judge_cause', port: 'japan', good: 'robot', answer: 'tech', correct: true, attempt: 2, dir: 'import' },
      { type: 'trade', from: 'japan', to: 'busan', good: 'robot', qty: 1, price: 10, dir: 'import', fee: 1 },
      { type: 'process', recipe: 'battery', inputsOrigin: ['shanghai'] },
      { type: 'event_choice', event: base.eventQueue[0], choice: 'x' },
      { type: 'sentence', text: '자원이 달라서', axes: ['resource'], ending: 'differ' },
      { type: 'mindmap', slot: 'meaning', answer: '무역', correct: true },
      { type: 'ledger_manual', exporter: '대한민국', good: '배터리', importer: '일본', correct: true },
      { type: 'refuel', port: 'busan', fuel: 10, cost: 5 },
      { type: 'buy_home', good: 'steel', qty: 1, price: 3 },
    ].map((e, i) => ({ ...e, t: i + 1 }));
    const ok = { ...base, log };
    expect(loadGame(mem({ [SAVE_KEY]: JSON.stringify(ok) }))).toEqual({ ok: true, state: ok });
  });
});
