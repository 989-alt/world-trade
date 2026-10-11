import { describe, expect, it } from 'vitest';
import { PORTS } from '../content/ports';
import type { GoodId } from '../content/types';
import { newGame } from './state';
import { buildLedger, checkResult, computeGrade, EPILOGUE_COMPARE_SCREEN, THRESHOLDS, type ResultJson } from './result';
import type { LogEvent, LogInput } from './types';

// @types/node 가 없다(의존성 추가 금지) → Node 내장 모듈은 동적 import 로 최소 타입만 붙인다
const nodeMod = (name: string) => import(/* @vite-ignore */ name);
const { readFileSync } = (await nodeMod('node:fs')) as { readFileSync(p: string, enc: 'utf8'): string };
const { execFileSync } = (await nodeMod('node:child_process')) as { execFileSync(cmd: string, args: string[], o: { encoding: 'utf8' }): string };
const { fileURLToPath } = (await nodeMod('node:url')) as { fileURLToPath(u: URL): string };

const mk = (events: LogInput[]): LogEvent[] => events.map((e, i) => ({ ...e, t: i + 1 }) as LogEvent);
const FOREIGN = PORTS.filter((p) => p.id !== 'busan');

/** rows 개 수입 행(각각 다른 항구) + 첫 시도 까닭 판정 causeTotal 건 중 causeCorrect 건 정답 + 문장 */
function play(o: { rows: number; causeCorrect: number; causeTotal: number; sentence?: string }): LogEvent[] {
  const ev: LogInput[] = [];
  for (let i = 0; i < o.rows; i++) {
    const p = FOREIGN[i];
    ev.push({ type: 'port_call', port: p.id, turn: i + 1 });
    ev.push({ type: 'trade', from: p.id, to: 'busan', good: 'rice', qty: 1, price: 24, dir: 'import' });
  }
  for (let i = 0; i < o.causeTotal; i++) ev.push({ type: 'judge_cause', port: 'saudi', good: 'crude-oil', answer: 'resource', correct: i < o.causeCorrect, attempt: 1 });
  if (o.sentence !== undefined) ev.push({ type: 'sentence', text: o.sentence });
  return mk(ev);
}
const GOOD_SENTENCE = '나라마다 자원과 기술이 달라서';

describe('PRD §7·§4.6 thresholds', () => {
  it('constants match PRD numbers', () => {
    expect(THRESHOLDS).toMatchObject({
      S1_DIR_ACC: 0.9, S1_LAST_N: 5, S2_CAUSE_ACC: 0.7, S2_HALF: 3, S3_MIN_ROWS: 6, S5_SLOTS: 5, S5_MIN_CORRECT: 4,
      S7_MAX_AUTARKY: 1, S8_MAX_SCREENS: 35, S8_MAX_JUDGE_DIALOGS: 14, A_CAUSE_ACC: 0.8, A_ROWS: 6, A_KEYWORDS: 2, B_CAUSE_ACC: 0.6, B_ROWS: 4,
    });
    expect(THRESHOLDS.S6_GOODS).toEqual(['crude-oil', 'natural-gas']);
  });
});

describe('computeGrade', () => {
  it('A at the boundary: acc 0.8, 6 rows, 2 keywords', () => {
    expect(computeGrade({ log: play({ rows: 6, causeCorrect: 4, causeTotal: 5, sentence: GOOD_SENTENCE }) })).toEqual({
      grade: 'A', nameKo: '대상단', causeAccuracy: 0.8, ledgerRows: 6, sentenceOk: true,
    });
  });
  it('grade lock: huge cash with first-try accuracy 0.79 is not A', () => {
    const s = { ...newGame(1, { nickname: 'a', seat: '1' }), cash: 9_999_999, log: play({ rows: 10, causeCorrect: 15, causeTotal: 19, sentence: GOOD_SENTENCE }) };
    const g = computeGrade(s);
    expect(g.causeAccuracy).toBeCloseTo(0.789, 3);
    expect(g.grade).toBe('B');
  });
  it('5 ledger rows is not A even with perfect accuracy', () => {
    expect(computeGrade({ log: play({ rows: 5, causeCorrect: 5, causeTotal: 5, sentence: GOOD_SENTENCE }) }).grade).toBe('B');
  });
  it('A needs 2 sentence keywords', () => {
    const g = computeGrade({ log: play({ rows: 6, causeCorrect: 5, causeTotal: 5, sentence: '무역은 좋다' }) });
    expect(g).toMatchObject({ grade: 'B', sentenceOk: false });
  });
  it('B boundary: 0.6 ∧ 4 rows ∧ sentence; below → C', () => {
    expect(computeGrade({ log: play({ rows: 4, causeCorrect: 3, causeTotal: 5, sentence: '좋다' }) }).grade).toBe('B');
    expect(computeGrade({ log: play({ rows: 3, causeCorrect: 3, causeTotal: 5, sentence: '좋다' }) }).grade).toBe('C');
    expect(computeGrade({ log: play({ rows: 4, causeCorrect: 2, causeTotal: 5, sentence: '좋다' }) }).grade).toBe('C');
    expect(computeGrade({ log: play({ rows: 4, causeCorrect: 3, causeTotal: 5, sentence: '  ' }) }).grade).toBe('C');
    expect(computeGrade({ log: [] }).grade).toBe('C');
  });
  it('only first attempts count toward cause accuracy', () => {
    const log = mk([
      { type: 'judge_cause', port: 'saudi', good: 'crude-oil', answer: 'geo', correct: false, attempt: 1 },
      { type: 'judge_cause', port: 'saudi', good: 'crude-oil', answer: 'resource', correct: true, attempt: 2 },
    ]);
    expect(computeGrade({ log }).causeAccuracy).toBe(0);
  });
});

describe('buildLedger', () => {
  it('import / export / transit rows with judged cause; busan resale and same-country skipped', () => {
    const log = mk([
      { type: 'port_call', port: 'shanghai', turn: 1 },
      { type: 'judge_cause', port: 'shanghai', good: 'semiconductor', answer: 'geo', correct: false, attempt: 1 },
      { type: 'judge_cause', port: 'shanghai', good: 'semiconductor', answer: 'tech', correct: true, attempt: 2 },
      { type: 'trade', from: 'busan', to: 'shanghai', good: 'semiconductor', qty: 2, price: 560, dir: 'export', fee: 112 },
      { type: 'trade', from: 'busan', to: 'shanghai', good: 'semiconductor', qty: 1, price: 560, dir: 'export' }, // 같은 입항 같은 행 → 한 줄
      { type: 'depart', port: 'shanghai', departure: 1 },
      { type: 'port_call', port: 'singapore', turn: 2 },
      { type: 'judge_cause', port: 'singapore', good: 'sugar', answer: 'capital', correct: false, attempt: 2 },
      { type: 'trade', from: 'singapore', to: 'busan', good: 'sugar', qty: 1, price: 45, dir: 'import' },
      { type: 'port_call', port: 'indonesia', turn: 3 },
      { type: 'trade', from: 'singapore', to: 'indonesia', good: 'sugar', qty: 1, price: 72, dir: 'transit' },
      { type: 'trade', from: 'indonesia', to: 'indonesia', good: 'nickel', qty: 1, price: 60, dir: 'export' },
      { type: 'port_call', port: 'busan', turn: 4 },
      { type: 'trade', from: 'indonesia', to: 'busan', good: 'nickel', qty: 1, price: 96, dir: 'import' },
    ]);
    expect(buildLedger({ log })).toEqual([
      { portCall: 1, exporter: '대한민국', good: '반도체', importer: '상하이', cause: '기술 ✓' },
      { portCall: 2, exporter: '싱가포르', good: '설탕', importer: '대한민국', cause: '자본 ✕' },
      { portCall: 3, exporter: '싱가포르', good: '설탕', importer: '인도네시아', cause: '' },
    ]);
  });
});

describe('buildLedger dir-keyed causes', () => {
  it('same port call same good: import and export rows each take their own cause; foreign transit takes export cause', () => {
    const log = mk([
      { type: 'port_call', port: 'shanghai', turn: 1 },
      { type: 'judge_cause', port: 'shanghai', good: 'semiconductor', answer: 'tech', correct: true, attempt: 1, dir: 'import' },
      { type: 'judge_cause', port: 'shanghai', good: 'semiconductor', answer: 'resource', correct: true, attempt: 1, dir: 'export' },
      { type: 'trade', from: 'shanghai', to: 'busan', good: 'semiconductor', qty: 1, price: 1, dir: 'import' },
      { type: 'trade', from: 'busan', to: 'shanghai', good: 'semiconductor', qty: 1, price: 1, dir: 'export' },
      { type: 'trade', from: 'singapore', to: 'shanghai', good: 'semiconductor', qty: 1, price: 1, dir: 'transit' },
    ]);
    expect(buildLedger({ log }).map((r) => r.cause)).toEqual(['기술 ✓', '자원 ✓', '자원 ✓']);
  });
});

const fixture = (name: string): ResultJson & Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../scripts/fixtures/${name}`, import.meta.url)), 'utf8'));
const base = fixture('result-pass.json');
const withLog = (extra: LogInput[], drop: (e: LogEvent) => boolean = () => false): ResultJson => {
  const log = base.log.filter((e) => !drop(e));
  const t = log[log.length - 1].t;
  return { ...base, log: [...log, ...extra.map((e, i) => ({ ...e, t: t + i + 1 }) as LogEvent)] };
};

describe('checkResult S1~S9', () => {
  it('pass fixture passes all; its ledger equals buildLedger(log)', () => {
    const r = checkResult(base);
    expect(Object.entries(r).filter(([, v]) => !v.pass).map(([k]) => k)).toEqual([]);
    expect(base.ledger).toEqual(buildLedger(base));
  });

  it('fail fixture fails S3 and S4', () => {
    const r = checkResult(fixture('result-fail.json'));
    expect(r.S3.pass).toBe(false);
    expect(r.S4.pass).toBe(false);
  });

  it('S4 regex: "나라마다 자원과 기술이 달라서" passes, "무역은 좋다" fails', () => {
    const notSentence = (e: LogEvent) => e.type === 'sentence';
    expect(checkResult(withLog([{ type: 'sentence', text: GOOD_SENTENCE }], notSentence)).S4).toMatchObject({ pass: true, value: 2 });
    expect(checkResult(withLog([{ type: 'sentence', text: '무역은 좋다' }], notSentence)).S4.pass).toBe(false);
    expect(checkResult(withLog([{ type: 'sentence', text: '자원과 기술이 많다' }], notSentence)).S4.pass).toBe(false); // 다르/차이 없음
    expect(checkResult(withLog([{ type: 'sentence', text: '자원이 차이 난다' }], notSentence)).S4.pass).toBe(false); // 키워드 1개
  });

  it('S3 fails with no non-Korea row, and with 5 rows', () => {
    const korea = base.ledger.filter((r) => r.exporter === '대한민국' || r.importer === '대한민국');
    expect(korea.length).toBeGreaterThanOrEqual(6);
    expect(checkResult({ ...base, ledger: korea }).S3.pass).toBe(false);
    expect(checkResult({ ...base, ledger: base.ledger.slice(0, 5) }).S3.pass).toBe(false);
    expect(checkResult({ ...base, ledger: base.ledger.slice(0, 6) }).S3.pass).toBe(true);
  });

  it('S1: one wrong in the last 5 dir judgments fails', () => {
    const r = checkResult(withLog([{ type: 'judge_dir', port: 'saudi', good: 'crude-oil', answer: 'export', correct: false, attempt: 1 }]));
    expect(r.S1.pass).toBe(false);
  });

  it('S2: later half worse than earlier half fails', () => {
    const r = checkResult(withLog([
      { type: 'port_call', port: 'saudi', turn: 6 },
      ...Array.from({ length: 3 }, () => ({ type: 'judge_cause', port: 'saudi', good: 'crude-oil', answer: 'geo', correct: false, attempt: 1 }) as LogInput),
    ]));
    expect(r.S2.pass).toBe(false);
  });

  it('S5: 3 of 5 mindmap slots fails, first answer per slot counts', () => {
    const wrong = (slot: string): LogInput => ({ type: 'mindmap', slot, answer: 'x', correct: false });
    const right: LogInput = { type: 'mindmap', slot: 'meaning', answer: '무역', correct: true };
    const noMeaning = (e: LogEvent) => e.type === 'mindmap' && e.slot === 'meaning';
    expect(checkResult(withLog([wrong('meaning')], noMeaning)).S5).toMatchObject({ pass: false, value: 3 });
    expect(checkResult(withLog([wrong('meaning'), right], noMeaning)).S5).toMatchObject({ pass: false, value: 3 });
    expect(checkResult(withLog([right, wrong('meaning')], noMeaning)).S5).toMatchObject({ pass: true, value: 4 });
    expect(checkResult(withLog([{ type: 'mindmap', slot: 'interdependence', answer: '상호의존', correct: true }])).S5.value).toBe(4);
  });

  it('S6: a crude-oil export attempt fails; other goods ignored', () => {
    expect(checkResult(withLog([{ type: 'export_attempt_blocked', good: 'nickel' as GoodId }])).S6.pass).toBe(true);
    expect(checkResult(withLog([{ type: 'export_attempt_blocked', good: 'crude-oil' }])).S6.pass).toBe(false);
  });

  it('S7: 2 autarky turns or no compare screen fails', () => {
    expect(checkResult(withLog([{ type: 'autarky', turn: 6 }])).S7.pass).toBe(false);
    expect(checkResult(withLog([], (e) => e.type === 'screen' && e.name === EPILOGUE_COMPARE_SCREEN)).S7.pass).toBe(false);
  });

  it('S8: 36 screens fails', () => {
    const n = base.log.filter((e) => e.type === 'screen').length;
    expect(checkResult(withLog(Array.from({ length: 36 - n }, () => ({ type: 'screen', name: 'map' }) as LogInput))).S8.pass).toBe(false);
  });

  it('S9: invariants from economy.ts hold; broken invariants fail', () => {
    expect(base.invariants).toMatchObject({ cashStart: 1000, maxRefuel: 150, portCalls: 6, tank: 300 });
    expect(checkResult({ ...base, invariants: { ...base.invariants, cashStart: 899 } }).S9.pass).toBe(false);
  });
});

describe('scripts/check-result.mjs', () => {
  const script = fileURLToPath(new URL('../../scripts/check-result.mjs', import.meta.url));
  const run = (name: string) => {
    const file = fileURLToPath(new URL(`../../scripts/fixtures/${name}`, import.meta.url));
    try {
      return { code: 0, out: JSON.parse(execFileSync('node', [script, file], { encoding: 'utf8' })) };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { code: err.status, out: JSON.parse(err.stdout) };
    }
  };
  it('pass fixture → exit 0, same as checkResult', () => {
    const r = run('result-pass.json');
    expect(r.code).toBe(0);
    expect(r.out).toEqual(JSON.parse(JSON.stringify(checkResult(fixture('result-pass.json')))));
  });
  it('fail fixture → exit 1, same as checkResult', () => {
    const r = run('result-fail.json');
    expect(r.code).toBe(1);
    expect(r.out).toEqual(JSON.parse(JSON.stringify(checkResult(fixture('result-fail.json')))));
  });
});
