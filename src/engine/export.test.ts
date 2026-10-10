import { describe, expect, it } from 'vitest';
import { START_CASH } from '../content/ports';
import { MAX_LEG_FUEL, MAX_REFUEL, PORT_CALLS, TANK, withLog } from './economy';
import { resultStats } from '../ui/EpilogueScreen';
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

describe('X1 CSV 수식 가드', () => {
  it("학생 기원 셀 =,+,-,@ 시작이면 ' 접두, 행 표식 + 은 그대로", () => {
    const out = toCsv([], [{ exporter: '=1+1', good: '@SUM(A1)', importer: '-2', correct: false }]);
    expect(out).toContain("\r\n+,'=1+1,'@SUM(A1),'-2,✕\r\n");
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
      manual: [],
      log: s.log,
    });
    expect(Object.keys(r).sort()).toEqual(['finishedAt', 'grade', 'invariants', 'ledger', 'log', 'manual', 'nickname', 'seat', 'seed', 'summary', 'version'].sort());
  });
  it('F3 summary.judgeDir 도 1차 시도만(결과 화면과 같은 잣대)', () => {
    let s = reduce(newGame(7, { nickname: '바다', seat: '7' }), { type: 'START_MAIN' }).state;
    s = withLog(s,
      { type: 'judge_dir', port: 'saudi', good: 'crude-oil', answer: 'export', correct: false, attempt: 1 },
      { type: 'judge_dir', port: 'saudi', good: 'crude-oil', answer: 'import', correct: true, attempt: 2 },
      { type: 'judge_dir', port: 'japan', good: 'robot', answer: 'import', correct: true, attempt: 1 },
      { type: 'judge_cause', port: 'japan', good: 'robot', answer: 'tech', correct: true, attempt: 1 });
    const r = buildResult(s);
    expect(r.summary.judgeDir).toEqual({ correct: 1, total: 2 });
    expect(r.summary.judgeCause).toEqual({ firstTryCorrect: 1, total: 1 });
    expect(r.summary.judgeDir.correct + r.summary.judgeCause.firstTryCorrect).toBe(resultStats(s).judge.correct);
    expect(r.summary.judgeDir.total + r.summary.judgeCause.total).toBe(resultStats(s).judge.total);
  });
  it('Q2 수동 일지 ledger_manual → manual 배열·CSV 끝 행, S3 ledger 는 자동 행 그대로', () => {
    let s = reduce(newGame(7, { nickname: '바다', seat: '7' }), { type: 'START_MAIN' }).state;
    s = withLog(s, { type: 'ledger_manual', exporter: '사우디아라비아', good: '원유', importer: '대한민국', correct: true });
    const r = buildResult(s);
    expect(r.manual).toEqual([{ exporter: '사우디아라비아', good: '원유', importer: '대한민국', correct: true }]);
    expect(r.ledger).toEqual([]);
    expect(r.summary.ledgerRows).toBe(0);
    const lines = toCsv(r.ledger, r.manual).slice(1).split('\r\n');
    expect(lines[1]).toBe('+,사우디아라비아,원유,대한민국,✓');
    expect(toCsv([], [{ exporter: '일본', good: '로봇', importer: '일본', correct: false }])).toContain('+,일본,로봇,일본,✕\r\n');
  });
  it('downloadFiles is a no-op without a DOM', () => {
    const s = newGame(1, { nickname: 'a', seat: '1' });
    expect(downloadFiles(buildResult(s))).toBe(false);
  });
});
