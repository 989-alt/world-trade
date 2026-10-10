import { describe, expect, it } from 'vitest';
import { AXES, AXIS_LABEL, type GoodId, type PortId } from '../content/types';
import { FEEDBACK, shortageOption, whyBuys, whyRelays, whySells } from '../content/feedback';
import { PORT_BY_ID } from '../content/ports';
import { createLog } from './log';
import {
  answerCause, answerDir, canMove, customsFee, flagOwnSpecialty, judgmentResult,
  restoreSessions, revealPrices, startJudgment, tradeSlots, turnDelay, type Dir, type JudgmentSession, type Shuffle,
} from './judgment';
import type { LogEvent } from './types';

// 테스트 전용 시드 셔플 (엔진 rng.ts 와 무관)
const mulberry32 = (a: number) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const seeded = (seed: number): Shuffle => {
  const r = mulberry32(seed);
  return (xs) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
};

const start = (port: PortId, good: GoodId, dir: Dir, log = createLog(), seed = 1) => {
  const r = startJudgment({ port, good, dir, shuffle: seeded(seed), log });
  if (!r.ok) throw new Error(r.reason);
  return r.session;
};

describe('direction = Korean company view', () => {
  it('buy at foreign port = import, sell = export, singapore transit judged per trade', () => {
    const log = createLog();
    // 1) 사우디에서 원유를 산다 → 수입
    const a = start('saudi', 'crude-oil', 'import', log);
    expect(answerDir(a, 'import').correct).toBe(true);
    // 2) 사우디에 자동차를 판다 → 수출
    const b = start('saudi', 'car', 'export', log);
    expect(answerDir(b, 'export').correct).toBe(true);
    // 3) 싱가포르에서 사서(수입) 브라질에 판다(수출): trade.dir 'transit' 이어도 판정은 거래마다
    const c1 = start('singapore', 'phone', 'import', log);
    expect(answerDir(c1, 'export').correct).toBe(false);
    expect(answerDir(c1, 'import').correct).toBe(true);
    const c2 = start('brazil', 'phone', 'export', log);
    expect(answerDir(c2, 'export').correct).toBe(true);
    log.push({ type: 'trade', from: 'singapore', to: 'brazil', good: 'phone', qty: 1, price: 480, dir: 'transit' });
    const dirs = log.events.filter((e) => e.type === 'judge_dir');
    expect(dirs.map((e) => e.type === 'judge_dir' && [e.port, e.answer, e.correct])).toEqual([
      ['saudi', 'import', true], ['saudi', 'export', true],
      ['singapore', 'export', false], ['singapore', 'import', true], ['brazil', 'export', true],
    ]);
  });

  it('wrong direction gives M1 feedback', () => {
    const s = start('japan', 'robot', 'import');
    expect(answerDir(s, 'export').feedback).toBe(FEEDBACK.M1.textKo);
  });

  it('home port needs no judgment', () => {
    const r = startJudgment({ port: 'busan', good: 'semiconductor', dir: 'export', shuffle: seeded(1), log: createLog() });
    expect(r).toEqual({ ok: false, reason: 'home_port' });
  });
});

describe('cause', () => {
  it('shanghai tie: resource and capital both correct', () => {
    for (const axis of ['resource', 'capital'] as const) {
      const s = start('shanghai', 'graphite', 'import');
      answerDir(s, 'import');
      const r = answerCause(s, axis);
      expect(r).toEqual({ correct: true, attempt: 1 });
    }
  });

  it('import asks why_sells, answer = port.correctCauses, labels AXIS_LABEL', () => {
    const s = start('saudi', 'crude-oil', 'import');
    expect(s.questionKey).toBe('why_sells');
    expect(s.question).toBe(whySells('사우디아라비아', '원유'));
    expect(s.correctCauses).toEqual(['resource']);
    expect(s.options.find((o) => o.axis === 'resource')!.label).toBe('자원');
  });

  it('export asks why_buys, answer = shortageAxis of that good (saudi car → tech)', () => {
    const s = start('saudi', 'car', 'export');
    expect(s.questionKey).toBe('why_buys');
    expect(s.question).toBe(whyBuys('사우디아라비아', '자동차'));
    const axis = PORT_BY_ID.saudi.shortages.find((x) => x.good === 'car')!.shortageAxis;
    expect(s.correctCauses).toEqual([axis]);
    expect(s.options.find((o) => o.axis === 'tech')!.label).toBe(shortageOption('tech'));
    answerDir(s, 'export');
    expect(answerCause(s, axis).correct).toBe(true);
  });

  it('export shortage axis is per good (LA semiconductor → resource, japan semiconductor → resource, shanghai → tech)', () => {
    expect(start('la', 'semiconductor', 'export').correctCauses).toEqual(['resource']);
    expect(start('japan', 'semiconductor', 'export').correctCauses).toEqual(['resource']);
    expect(start('shanghai', 'semiconductor', 'export').correctCauses).toEqual(['tech']);
  });

  it('singapore is geo both ways', () => {
    expect(start('singapore', 'phone', 'import').correctCauses).toEqual(['geo']);
    expect(start('singapore', 'phone', 'export').correctCauses).toEqual(['geo']);
  });

  it('R2 singapore: own relay question both ways, options are plain axis names (not 「…이 부족해서」), answer 지리적 위치', () => {
    for (const dir of ['import', 'export'] as const) {
      const s = start('singapore', 'cosmetics', dir);
      expect(s.questionKey).toBe('why_relays');
      expect(s.question).toBe('싱가포르가 화장품을 사서 다시 파는 까닭은?');
      expect(s.question).not.toContain('싸게'); // R12
      expect(s.options.map((o) => o.label).sort()).toEqual(AXES.map((a) => AXIS_LABEL[a]).sort());
      expect(s.options.every((o) => !o.label.includes('부족'))).toBe(true);
      answerDir(s, dir);
      expect(answerCause(s, 'geo').correct).toBe(true);
    }
    expect(whyRelays('싱가포르', '로봇')).toBe('싱가포르가 로봇을 사서 다시 파는 까닭은?');
  });

  it('export of a good with no shortage axis is not invented', () => {
    const r = startJudgment({ port: 'germany', good: 'semiconductor', dir: 'export', shuffle: seeded(1), log: createLog() });
    expect(r).toEqual({ ok: false, reason: 'no_shortage_axis' });
  });

  it('options: 5 axes, same seed same order', () => {
    const a = start('japan', 'robot', 'import', createLog(), 42).options.map((o) => o.axis);
    const b = start('japan', 'robot', 'import', createLog(), 42).options.map((o) => o.axis);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([...AXES].sort());
    const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
      start('japan', 'robot', 'import', createLog(), seed).options.map((o) => o.axis).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('attempts, fee, delay', () => {
  it('1st wrong → feedback + retry, 2nd wrong → revealed and trade not blocked, attempts 1/2 logged', () => {
    const log = createLog();
    const s = start('thai', 'rice', 'import', log);
    const d1 = answerDir(s, 'export');
    expect(d1).toEqual({ correct: false, attempt: 1, feedback: FEEDBACK.M1.textKo });
    expect(s.step).toBe('dir');
    const d2 = answerDir(s, 'export');
    expect(d2.revealed).toBe('import');
    expect(s.step).toBe('cause');
    const c1 = answerCause(s, 'tech');
    expect(c1).toEqual({ correct: false, attempt: 1, feedback: FEEDBACK.M4.textKo });
    const c2 = answerCause(s, 'capital');
    expect(c2.correct).toBe(false);
    expect(c2.attempt).toBe(2);
    expect(c2.revealed).toEqual({ axes: ['nature'], hintKo: PORT_BY_ID.thai.hintKo, source: PORT_BY_ID.thai.source });
    expect(s.step).toBe('done');
    expect(revealPrices(s, () => 'prices')).toBe('prices');
    expect(log.events.map((e) => [e.type, 'attempt' in e && e.attempt])).toEqual([
      ['judge_dir', 1], ['judge_dir', 2], ['judge_cause', 1], ['judge_cause', 2],
    ]);
    expect(() => answerCause(s, 'nature')).toThrow();
  });

  it('1st try right → fee 0, no delay', () => {
    const s = start('chile', 'grapes', 'import');
    answerDir(s, 'import');
    answerCause(s, 'nature');
    expect(judgmentResult(s)).toEqual({ feeRate: 0, delay: false });
    expect(customsFee(500, s)).toBe(0);
    expect(tradeSlots(4, s.delay)).toBe(4);
  });

  it('2nd try right → fee 0.10, no delay', () => {
    const s = start('chile', 'grapes', 'import');
    answerDir(s, 'import');
    answerCause(s, 'tech');
    answerCause(s, 'nature');
    expect(judgmentResult(s)).toEqual({ feeRate: 0.1, delay: false });
    expect(customsFee(500, s)).toBe(50);
    expect(tradeSlots(4, s.delay)).toBe(4);
  });

  it('direction needed retry → fee 0.10 even if cause right first', () => {
    const s = start('chile', 'grapes', 'import');
    answerDir(s, 'export');
    answerDir(s, 'import');
    answerCause(s, 'nature');
    expect(judgmentResult(s)).toEqual({ feeRate: 0.1, delay: false });
  });

  it('cause wrong twice → fee 0.10 + customs delay (slots 4→3, min 1)', () => {
    const s = start('chile', 'grapes', 'import');
    answerDir(s, 'import');
    answerCause(s, 'tech');
    answerCause(s, 'geo');
    expect(judgmentResult(s)).toEqual({ feeRate: 0.1, delay: true });
    expect(customsFee(500, s)).toBe(50);
    expect(tradeSlots(4, s.delay)).toBe(3);
    expect(tradeSlots(1, s.delay)).toBe(1);
  });
});

describe('R11 delay from either judgment, turn-wide', () => {
  it('direction wrong twice → delay (cause then right first)', () => {
    const s = start('chile', 'grapes', 'import');
    answerDir(s, 'export');
    answerDir(s, 'export');
    expect(s.delay).toBe(true);
    answerCause(s, 'nature');
    expect(judgmentResult(s)).toEqual({ feeRate: 0.1, delay: true });
  });
  it('one delayed session delays the whole port call; 1st/2nd right alone does not', () => {
    const ok = start('chile', 'grapes', 'import');
    answerDir(ok, 'import');
    answerCause(ok, 'tech');
    answerCause(ok, 'nature');
    const bad = start('chile', 'phone', 'export');
    answerDir(bad, 'export');
    answerCause(bad, 'geo');
    answerCause(bad, 'capital');
    expect(turnDelay([ok])).toBe(false);
    expect(turnDelay([ok, bad])).toBe(true);
    expect(tradeSlots(4, turnDelay([ok, bad]))).toBe(3);
  });
});

describe('gates and order', () => {
  it('revealPrices throws before completion', () => {
    const s = start('vietnam', 'phone', 'import');
    const prices = () => ({ phone: 180 });
    expect(() => revealPrices(s, prices)).toThrow();
    answerDir(s, 'import');
    expect(() => revealPrices(s, prices)).toThrow();
    answerCause(s, 'capital');
    expect(revealPrices(s, prices)).toEqual({ phone: 180 });
  });

  it('canMove false while pending', () => {
    const s = start('vietnam', 'phone', 'import');
    expect(canMove(s)).toEqual({ ok: false, reason: 'judgment_pending' });
    answerDir(s, 'import');
    expect(canMove(s)).toEqual({ ok: false, reason: 'judgment_pending' });
    answerCause(s, 'capital');
    expect(canMove(s)).toEqual({ ok: true });
    expect(canMove(null)).toEqual({ ok: true });
  });

  it('log t monotonic, judge_dir → judge_cause → trade', () => {
    const log = createLog();
    const s = start('indonesia', 'nickel', 'import', log);
    answerDir(s, 'import');
    answerCause(s, 'resource');
    revealPrices(s, () => null);
    log.push({ type: 'trade', from: 'indonesia', to: 'busan', good: 'nickel', qty: 2, price: 36, dir: 'import' });
    expect(log.events.map((e) => e.type)).toEqual(['judge_dir', 'judge_cause', 'trade']);
    const ts = log.events.map((e) => e.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(new Set(ts).size).toBe(ts.length);
  });

  it('M7: importing a Korean specialty abroad is flagged', () => {
    expect(flagOwnSpecialty('vietnam', 'phone')).toBe(FEEDBACK.M7.textKo);
    expect(flagOwnSpecialty('saudi', 'crude-oil')).toBeNull();
    expect(flagOwnSpecialty('busan', 'phone')).toBeNull();
  });
});

describe('Q1 restoreSessions — 새로 고침 뒤 이번 입항 판정 복원', () => {
  const play = (seed: number) => {
    const log = createLog([{ t: 1, type: 'judge_dir', port: 'saudi', good: 'crude-oil', answer: 'import', correct: true, attempt: 1 }]);
    log.push({ type: 'screen', name: 'port-japan' });
    const events = log.events as unknown as LogEvent[];
    events.push({ t: 99, type: 'port_call', port: 'japan', turn: 2 });
    const shuffle = seeded(seed);
    const robot = startJudgment({ port: 'japan', good: 'robot', dir: 'import', shuffle, log });
    const other = startJudgment({ port: 'japan', good: 'semiconductor', dir: 'export', shuffle, log });
    if (!robot.ok || !other.ok) throw new Error('start');
    answerDir(robot.session, 'import');
    answerCause(robot.session, 'nature');
    answerCause(robot.session, 'tech');
    answerDir(other.session, 'import');
    return { events, robot: robot.session, other: other.session };
  };

  it('step·시도·retried·delay·수수료·선택지 순서가 같고, 복원은 로그를 남기지 않는다', () => {
    const { events, robot, other } = play(5);
    const n = events.length;
    const target = createLog(events as never);
    const got = restoreSessions(events, seeded(5), target);
    expect([...got.keys()]).toEqual(['import:robot', 'export:semiconductor']);
    const strip = ({ log: _l, ...s }: JudgmentSession) => s;
    expect(strip(got.get('import:robot')!)).toEqual(strip(robot));
    expect(strip(got.get('export:semiconductor')!)).toEqual(strip(other));
    expect(customsFee(228, got.get('import:robot')!)).toBe(23);
    expect(events.length).toBe(n);
    // 복원 뒤 이어서 답하면 원래 로그에 붙는다
    answerDir(got.get('export:semiconductor')!, 'export');
    expect(events.length).toBe(n + 1);
    expect(got.get('export:semiconductor')!.dirAttempts).toBe(2);
  });

  it('마지막 port_call 이전 판정은 복원하지 않는다', () => {
    const { events } = play(5);
    const later = [...events, { t: 200, type: 'port_call', port: 'singapore', turn: 3 } as LogEvent];
    expect(restoreSessions(later, seeded(5), createLog()).size).toBe(0);
  });
});
