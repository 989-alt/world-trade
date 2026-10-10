import { describe, expect, it } from 'vitest';
import { createLog } from './log';

describe('log', () => {
  it('t is monotonic from 1', () => {
    const log = createLog();
    log.push({ type: 'screen', name: 'title' });
    log.push({ type: 'autarky', turn: 2 });
    log.push({ type: 'towed', to: 'japan' });
    expect(log.events.map((e) => e.t)).toEqual([1, 2, 3]);
  });

  it('continues after a loaded log', () => {
    const log = createLog([{ t: 7, type: 'screen', name: 'map' }]);
    expect(log.push({ type: 'refuel', port: 'saudi', fuel: 100, cost: 100 }).t).toBe(8);
    expect(log.events).toHaveLength(2);
  });
});
