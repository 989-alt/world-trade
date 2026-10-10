import { describe, expect, it } from 'vitest';
import { MINI_SIM } from '../content/prologue';
import { miniSimResult } from './MiniSim';
import { PROLOGUE_FLOW } from './PrologueScreen';
import { PROLOGUE_STEPS } from '../content/prologue';

describe('MiniSim', () => {
  it('trade total is always larger than each-makes total (4 vs 6)', () => {
    const each = miniSimResult('each');
    const trade = miniSimResult('trade');
    expect(each.total).toBe(MINI_SIM.eachMakes.a + MINI_SIM.eachMakes.b);
    expect(trade.total).toBe(MINI_SIM.specializeAndTrade.a + MINI_SIM.specializeAndTrade.b);
    expect(trade.total).toBeGreaterThan(each.total);
    expect(trade.a).toBeGreaterThan(each.a);
    expect(trade.b).toBeGreaterThan(each.b);
  });
  it('prologue has at most 4 screens and covers 무역·수입·수출 terms', () => {
    expect(PROLOGUE_FLOW.length).toBeLessThanOrEqual(4);
    const words = PROLOGUE_STEPS.flatMap((s) => (s.term ? [s.term.wordKo] : []));
    expect(words).toEqual(expect.arrayContaining(['무역', '수입', '수출']));
  });
});
