import { describe, expect, it } from 'vitest';
import { EVENTS } from '../content/events';
import { viewModel } from './EventCard';
import cardSrc from './EventCard.tsx?raw';

const ev = (id: string) => EVENTS.find((e) => e.id === id)!;

describe('EventCard viewModel', () => {
  it('no continue button and no feedback before a choice', () => {
    for (const e of EVENTS) {
      const vm = viewModel(e, null);
      expect(vm.showContinue).toBe(false);
      expect(vm.feedback).toBeNull();
      expect(vm.choices.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('after a choice: continue shown, feedback is that choice', () => {
    for (const e of EVENTS) for (const c of e.choices) {
      const vm = viewModel(e, c.id);
      expect(vm.showContinue).toBe(true);
      expect(vm.feedback).toEqual({ text: c.feedbackKo, source: c.source });
      expect(vm.choices.filter((x) => x.chosen).map((x) => x.id)).toEqual([c.id]);
    }
  });
  it('every choice of every card renders plus and minus (relocation, fair-trade, FTA included)', () => {
    for (const e of EVENTS) for (const c of viewModel(e, null).choices) {
      expect(c.plus.trim()).not.toBe('');
      expect(c.minus.trim()).not.toBe('');
    }
    for (const id of ['factory-relocation', 'fair-trade', 'low-tariff-promise']) {
      expect(viewModel(ev(id), null).choices.length).toBe(2);
    }
  });
  it('FTA: both choices show import price and domestic farm sides, with steel contrast', () => {
    const [promise, refuse] = viewModel(ev('low-tariff-promise'), null).choices;
    expect(promise.plus).toContain('수입가');
    expect(promise.minus).toContain('농가');
    expect(refuse.plus).toContain('농가');
    expect(refuse.minus).toContain('수입가');
    expect(viewModel(ev('low-tariff-promise'), 'refuse').feedback!.text).toContain('철강');
  });
  it('steel "leave" shows domestic steel production drop', () => {
    const leave = viewModel(ev('steel-dumping'), 'leave');
    expect(leave.choices.find((c) => c.id === 'leave')!.minus).toContain('국내 철강');
    expect(leave.feedback!.text.length).toBeGreaterThan(0);
  });
  it('domestic-vs-import: feedback only, nothing marked wrong', () => {
    for (const id of ['domestic', 'import']) {
      const vm = viewModel(ev('domestic-vs-import'), id);
      expect(vm.feedback!.text.trim()).not.toBe('');
      expect(JSON.stringify(vm)).not.toMatch(/wrong|오답|incorrect/i);
    }
  });
  it('source has no Math.random and no network calls', () => {
    expect(cardSrc).not.toMatch(/Math\.random|fetch\(|XMLHttpRequest/);
  });
  it('onChoose fires once (guarded by sent flag)', () => {
    expect(cardSrc).toMatch(/if \(chosen === null \|\| sent\) return/);
  });
});
