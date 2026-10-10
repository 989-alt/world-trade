import { describe, expect, it } from 'vitest';
import { START_CASH } from '../content/ports';
import { MAX_LEG_FUEL, MAX_REFUEL, PORT_CALLS, TANK } from './economy';
import { buildResult, downloadFiles, fileNames, safeName, toCsv } from './export';
import { newGame, reduce } from './state';

describe('toCsv', () => {
  const csv = toCsv([
    { portCall: 1, exporter: '대한민국', good: '김, 과자', importer: '타이', cause: '그는 "자연환경"이라 했다\n둘째 줄' },
    { portCall: 2, exporter: '싱가포르', good: '설탕', importer: '인도네시아', cause: '' },
  ]);
  it('UTF-8 BOM first, header row', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')[0]).toBe('입항,수출국,물자·서비스,수입국,까닭');
  });
  it('RFC 4180 escaping: comma, quote, newline', () => {
    expect(csv).toContain('1,대한민국,"김, 과자",타이,"그는 ""자연환경""이라 했다\n둘째 줄"\r\n');
    expect(csv).toContain('2,싱가포르,설탕,인도네시아,\r\n');
  });
});

describe('fileNames', () => {
  const d = new Date(2026, 9, 10);
  it("strips path chars and spaces: '../a b' → 'ab'", () => {
    expect(safeName('../a b')).toBe('ab');
    expect(fileNames('../a b', d)).toEqual({ json: 'result-ab-2026-10-10.json', csv: 'trade-log-ab-2026-10-10.csv' });
  });
  it('max 20 chars (code points), fallback player', () => {
    expect(safeName('가'.repeat(30))).toBe('가'.repeat(20));
    expect(safeName(' /\\.. ')).toBe('player');
    expect(safeName('a:b*c?d"e<f>g|h')).toBe('abcdefgh');
  });
});

describe('buildResult', () => {
  it('summary, invariants, ledger, log; only nickname/seat as profile', () => {
    let s = reduce(newGame(7, { nickname: '바다', seat: '7' }), { type: 'START_MAIN' }).state;
    s = reduce(s, { type: 'STAY_HOME' }).state;
    const r = buildResult(s, new Date('2026-10-10T03:00:00.000Z'));
    expect(r).toMatchObject({
      version: 1, nickname: '바다', seat: '7', seed: 7, finishedAt: '2026-10-10T03:00:00.000Z',
      summary: { cash: START_CASH, portCalls: 1, factoryLevel: 1, judgeDir: { correct: 0, total: 0 }, judgeCause: { firstTryCorrect: 0, total: 0 }, ledgerRows: 0 },
      grade: { grade: 'C', nameKo: '견습' },
      invariants: { cashStart: START_CASH, maxRefuel: MAX_REFUEL, portCalls: PORT_CALLS, tank: TANK, maxLegFuel: MAX_LEG_FUEL },
      ledger: [],
      log: s.log,
    });
    expect(Object.keys(r).sort()).toEqual(['finishedAt', 'grade', 'invariants', 'ledger', 'log', 'nickname', 'seat', 'seed', 'summary', 'version'].sort());
  });
  it('downloadFiles is a no-op without a DOM', () => {
    const s = newGame(1, { nickname: 'a', seat: '1' });
    expect(downloadFiles(buildResult(s))).toBe(false);
  });
});
