import { afterEach, describe, expect, it, vi } from 'vitest';
import { MINDMAP_SLOTS } from '../content/mindmap';
import { downloadFiles } from '../engine/export';
import { EPILOGUE_COMPARE_SCREEN, checkResult } from '../engine/result';
import { reduce } from '../engine/state';
import type { GameState, LogEvent, LogInput } from '../engine/types';
import { EpilogueScreen, compareBars, doExport, firstPhase, resultStats, sentenceGate, whyInit } from './EpilogueScreen';
import { COUNTRIES, GOOD_NAMES, checkManualRow } from './LedgerScreen';
import { mindInit, scoreMindmap } from './MindmapForm';
import { CSV_COLUMNS, TEACHER_PRIVACY } from './TeacherGuide';
import guideSrc from './TeacherGuide.tsx?raw';

const fresh = () => reduce(null, { type: 'NEW_GAME', seed: 1, profile: { nickname: '별', seat: '3' } }).state;
const withLog = (s: GameState, ...ev: LogInput[]): GameState => ({
  ...s, log: [...s.log, ...ev.map((e, i) => ({ ...e, t: s.log.length + i + 1 }) as LogEvent)],
});

describe('sentence gate', () => {
  it('under 10 chars cannot submit; one edit after submit; then locked', () => {
    expect(sentenceGate(0, false, '짧다').canSubmit).toBe(false);
    expect(sentenceGate(0, false, '나라마다 자원이 달라서 무역한다').canSubmit).toBe(true);
    const after1 = sentenceGate(1, false, '나라마다 자원이 달라서 무역한다');
    expect(after1).toEqual({ readOnly: true, canSubmit: false, canEdit: true });
    expect(sentenceGate(1, true, '나라마다 자원이 달라서 무역한다').canSubmit).toBe(true);
    expect(sentenceGate(1, true, '짧다').canSubmit).toBe(false);
    expect(sentenceGate(2, false, '나라마다 자원이 달라서 무역한다')).toEqual({ readOnly: true, canSubmit: false, canEdit: false });
  });
});

describe('C7 문장 화면 복원', () => {
  it('저장 로그의 sentence 수 = 제출 수, 선택 = 마지막 제출; 2건이면 잠금', () => {
    expect(whyInit([])).toEqual({ submits: 0, axes: [], ending: null });
    const one = withLog(fresh(), { type: 'sentence', text: '자원·기술이 나라마다 달라서 무역을 한다.', axes: ['resource', 'tech'], ending: 'differ' }).log;
    expect(whyInit(one)).toEqual({ submits: 1, axes: ['resource', 'tech'], ending: 'differ' });
    expect(sentenceGate(1, false, 'x'.repeat(10)).canEdit).toBe(true);
    const two = withLog({ ...fresh(), log: one }, { type: 'sentence', text: '자연환경·자원에 차이가 있어서 무역을 한다.', axes: ['nature', 'resource'], ending: 'gap' }).log;
    const w = whyInit(two);
    expect(w).toEqual({ submits: 2, axes: ['nature', 'resource'], ending: 'gap' });
    expect(sentenceGate(w.submits, false, '자연환경·자원에 차이가 있어서 무역을 한다.')).toEqual({ readOnly: true, canSubmit: false, canEdit: false });
  });
});

describe('mindmap scoring', () => {
  it('uses normalize; wrong slots reveal first accepted answer; blank is wrong', () => {
    const ans = { meaning: ' 무역. ', import: '수입 하는 것', export: '몰라', cause: '', interdependence: '상호의존' };
    const s = scoreMindmap(ans);
    expect(s).toHaveLength(MINDMAP_SLOTS.length);
    expect(s.map((x) => x.correct)).toEqual([true, true, false, false, true]);
    expect(s[2].reveal).toBe('수출');
    expect(s[3].reveal).toBe(MINDMAP_SLOTS[3].accepted[0]);
    expect(s[0].reveal).toBeNull();
  });
});

describe('mindmap restore (Z2)', () => {
  const mind = (slot: string, answer: string, correct: boolean): LogInput => ({ type: 'mindmap', slot, answer, correct });
  it('no or partial mindmap logs: answers restored, not locked', () => {
    expect(mindInit([])).toEqual({ answers: {}, scores: null });
    expect(mindInit(withLog(fresh(), mind('meaning', '수입', false)).log)).toEqual({ answers: { meaning: '수입' }, scores: null });
  });
  it('5 slots logged: first answer per slot, locked with reveals; later resubmits ignored', () => {
    const first = MINDMAP_SLOTS.map((x) => mind(x.id, '자급자족', false));
    const again = MINDMAP_SLOTS.map((x) => mind(x.id, x.accepted[0], true));
    const r = mindInit(withLog(fresh(), ...first, ...again).log);
    expect(r.answers).toEqual(Object.fromEntries(MINDMAP_SLOTS.map((x) => [x.id, '자급자족'])));
    expect(r.scores?.map((x) => x.correct)).toEqual([false, false, false, false, false]);
    expect(r.scores?.map((x) => x.reveal)).toEqual(MINDMAP_SLOTS.map((x) => x.accepted[0]));
  });
});

describe('manual ledger row', () => {
  it('Z3 대한민국 수출 정답 = 부산 특산 ∪ 가공 출력품, 원유·천연가스는 오답', () => {
    expect(checkManualRow('대한민국', '배터리', '로스앤젤레스').correct).toBe(true);
    expect(checkManualRow('대한민국', '자동차', '로스앤젤레스').correct).toBe(true);
    expect(checkManualRow('대한민국', '석유 제품', '싱가포르').correct).toBe(true);
    expect(checkManualRow('대한민국', '원유', '로스앤젤레스').correct || checkManualRow('대한민국', '천연가스', '일본').correct).toBe(false);
  });
  it('needs all three cells; checks against specialties', () => {
    expect(checkManualRow('', '원유', '대한민국').complete).toBe(false);
    expect(checkManualRow('사우디아라비아', '원유', '').complete).toBe(false);
    expect(checkManualRow('사우디아라비아', '원유', '대한민국')).toEqual({ complete: true, correct: true });
    expect(checkManualRow('한국', '반도체', '일본').correct).toBe(true);
    expect(checkManualRow('사우디아라비아', '반도체', '대한민국').correct).toBe(false);
    expect(checkManualRow('일본', '로봇', '일본').correct).toBe(false);
  });
  it('C2 선택 상자 보기: 나라 12(대한민국 + 부산 밖 11항구), 품목 20, 모든 나라 이름이 판정에 걸린다', () => {
    expect(COUNTRIES).toHaveLength(12);
    expect(COUNTRIES[0]).toBe('대한민국');
    expect(GOOD_NAMES).toHaveLength(20);
    expect(checkManualRow('대한민국', '반도체', '일본').correct).toBe(true);
    for (const c of COUNTRIES.slice(1)) expect(COUNTRIES.some((im) => GOOD_NAMES.some((g) => checkManualRow(c, g, im).correct)) || c === '싱가포르').toBe(true);
  });
});

describe('result screen', () => {
  it('stats numbers and grade', () => {
    let s = fresh();
    s = withLog(s,
      { type: 'judge_dir', port: 'saudi', good: 'crude-oil', answer: 'import', correct: true, attempt: 1 },
      { type: 'judge_dir', port: 'saudi', good: 'crude-oil', answer: 'export', correct: false, attempt: 2 },
      { type: 'judge_cause', port: 'saudi', good: 'crude-oil', answer: 'resource', correct: true, attempt: 1 });
    const r = resultStats(s);
    expect(r.coins).toBe(s.cash);
    expect(r.judge).toEqual({ correct: 2, total: 2 }); // R15 방향·까닭 모두 1차 시도만
    expect(r.rows).toBe(0);
    expect(r.grade.grade).toBe('C');
  });
  it('R15 방향 2차 시도·까닭 2차 시도는 분자·분모 모두에서 빠진다', () => {
    const s = withLog(fresh(),
      { type: 'judge_dir', port: 'saudi', good: 'crude-oil', answer: 'export', correct: false, attempt: 1 },
      { type: 'judge_dir', port: 'saudi', good: 'crude-oil', answer: 'import', correct: true, attempt: 2 },
      { type: 'judge_cause', port: 'saudi', good: 'crude-oil', answer: 'tech', correct: false, attempt: 1 },
      { type: 'judge_cause', port: 'saudi', good: 'crude-oil', answer: 'resource', correct: true, attempt: 2 },
      { type: 'judge_dir', port: 'japan', good: 'robot', answer: 'import', correct: true, attempt: 1 },
      { type: 'judge_cause', port: 'japan', good: 'robot', answer: 'tech', correct: true, attempt: 1 });
    expect(resultStats(s).judge).toEqual({ correct: 2, total: 4 });
  });
  it('R5 완주(done) 저장본을 이어하면 결과 화면부터, 에필로그 중이면 일지부터', () => {
    expect(firstPhase({ stage: 'done' })).toBe(3);
    expect(firstPhase({ stage: 'epilogue' })).toBe(0);
  });
  it('doExport hands buildResult to downloader; downloadFiles triggers 2 object URLs', () => {
    const dl = vi.fn(() => true);
    expect(doExport(fresh(), dl)).toBe(true);
    expect(dl).toHaveBeenCalledTimes(1);
    const create = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', { createElement: () => ({ click: vi.fn(), remove: vi.fn() }), body: { appendChild: vi.fn() } });
    expect(downloadFiles(JSON.parse(JSON.stringify({ ...doExportArg(), }) ))).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
const doExportArg = () => { let got: any; doExport(fresh(), (r) => ((got = r), true)); return got; };
afterEach(() => vi.unstubAllGlobals());

describe('compare bars', () => {
  it('no stay-home turns -> stayTurns 0 (graph omitted); with stays counted', () => {
    expect(compareBars([]).stayTurns).toBe(0);
    const s = withLog(fresh(),
      { type: 'port_call', port: 'saudi', turn: 1 },
      { type: 'trade', from: 'saudi', to: 'busan', good: 'crude-oil', qty: 2, price: 40, dir: 'import' },
      { type: 'depart', port: 'saudi', departure: 1 },
      { type: 'port_call', port: 'busan', turn: 2 },
      { type: 'trade', from: 'saudi', to: 'busan', good: 'crude-oil', qty: 2, price: 100, dir: 'import' },
      { type: 'autarky', turn: 3 });
    expect(compareBars(s.log)).toEqual({ tradeAvg: Math.round((-80 + 200) / 2), tradeCalls: 2, stayTurns: 1 });
  });
  it('Q3 출발 전 부산 구매는 다음 입항 몫(가짜 턴 없음), 입항 수만 분모', () => {
    const log = withLog(fresh(),
      { type: 'buy_home', good: 'phone', qty: 1, price: 180 },
      { type: 'depart', port: 'busan', departure: 1 },
      { type: 'port_call', port: 'saudi', turn: 1 },
      { type: 'trade', from: 'busan', to: 'saudi', good: 'phone', qty: 1, price: 480, dir: 'export' },
      { type: 'depart', port: 'saudi', departure: 2 },
      { type: 'port_call', port: 'busan', turn: 2 },
      { type: 'autarky', turn: 3 }).log;
    expect(compareBars(log)).toEqual({ tradeAvg: 150, tradeCalls: 2, stayTurns: 1 });
  });
  it('Q3 통관 수수료·급유비 차감, 예인 직후 입항은 분모 제외', () => {
    const log = withLog(fresh(),
      { type: 'port_call', port: 'japan', turn: 1 },
      { type: 'trade', from: 'japan', to: 'busan', good: 'robot', qty: 1, price: 228, dir: 'import', fee: 23 },
      { type: 'refuel', port: 'japan', fuel: 10, cost: 50 },
      { type: 'depart', port: 'japan', departure: 2 },
      { type: 'port_call', port: 'singapore', turn: 2 },
      { type: 'trade', from: 'japan', to: 'singapore', good: 'robot', qty: 1, price: 380, dir: 'transit' },
      { type: 'refuel', port: 'singapore', fuel: 50, cost: 100 },
      { type: 'autarky', turn: 3 }).log;
    expect(compareBars(log).tradeAvg).toBe(Math.round((380 - 228 - 23 - 50 - 100) / 2));
    const towed = withLog({ ...fresh(), log }, { type: 'depart', port: 'singapore', departure: 3 },
      { type: 'towed', to: 'chile' }, { type: 'port_call', port: 'chile', turn: 4 }, { type: 'refuel', port: 'chile', fuel: 300, cost: 150 }).log;
    expect(compareBars(towed)).toMatchObject({ tradeCalls: 2, tradeAvg: Math.round((380 - 228 - 23 - 50 - 100 - 150) / 2) });
  });
});

describe('epilogue wiring', () => {
  it('compare screen name matches the S7 checker', () => {
    const s = withLog(fresh(), { type: 'screen', name: EPILOGUE_COMPARE_SCREEN });
    const c = checkResult({ log: s.log, ledger: [], invariants: { cashStart: 1, maxRefuel: 0, portCalls: 0, tank: 1, maxLegFuel: 0 } });
    expect(c.S7.pass).toBe(true);
    expect(typeof EpilogueScreen).toBe('function');
  });
});

describe('TeacherGuide', () => {
  it('privacy line lives here and mentions CSV columns', () => {
    expect(TEACHER_PRIVACY).toContain('실명·학급은 저장되지 않습니다');
    expect(TEACHER_PRIVACY).toContain('결과 파일 보관은 교사 책임입니다');
    expect(guideSrc).toContain('TEACHER_PRIVACY');
    expect(CSV_COLUMNS).toHaveLength(5);
  });
});
