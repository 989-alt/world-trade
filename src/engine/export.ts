import { START_CASH } from '../content/ports';
import { MAX_LEG_FUEL, MAX_REFUEL, PORT_CALLS, TANK } from './economy';
import { buildLedger, computeGrade, type Grade, type Invariants, type LedgerRow } from './result';
import type { GameState, LogEvent } from './types';

export { buildLedger };

/** 교사가 받는 결과 파일. 개인정보는 닉네임·출석번호뿐 */
export type ExportResult = {
  version: 1;
  nickname: string;
  seat: string;
  seed: number;
  finishedAt: string;
  summary: {
    cash: number;
    portCalls: number;
    factoryLevel: number;
    judgeDir: { correct: number; total: number };
    judgeCause: { firstTryCorrect: number; total: number };
    ledgerRows: number;
  };
  grade: Grade;
  invariants: Invariants;
  ledger: LedgerRow[];
  log: LogEvent[];
};

export function buildResult(state: GameState, now = new Date()): ExportResult {
  const dirs = state.log.filter((e) => e.type === 'judge_dir');
  const causes = state.log.filter((e) => e.type === 'judge_cause' && e.attempt === 1);
  const ledger = buildLedger(state);
  return {
    version: 1,
    nickname: state.profile.nickname,
    seat: state.profile.seat,
    seed: state.seed,
    finishedAt: now.toISOString(),
    summary: {
      cash: state.cash,
      portCalls: state.portCalls,
      factoryLevel: state.factoryLevel,
      judgeDir: { correct: dirs.filter((e) => e.type === 'judge_dir' && e.correct).length, total: dirs.length },
      judgeCause: { firstTryCorrect: causes.filter((e) => e.type === 'judge_cause' && e.correct).length, total: causes.length },
      ledgerRows: ledger.length,
    },
    grade: computeGrade(state),
    invariants: { cashStart: START_CASH, maxRefuel: MAX_REFUEL, portCalls: PORT_CALLS, tank: TANK, maxLegFuel: MAX_LEG_FUEL },
    ledger,
    log: state.log,
  };
}

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC 4180 + UTF-8 BOM(엑셀 한글) */
export function toCsv(rows: LedgerRow[]): string {
  const lines = [['입항', '수출국', '물자·서비스', '수입국', '까닭'], ...rows.map((r) => [r.portCall, r.exporter, r.good, r.importer, r.cause])];
  return '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** 경로 문자·공백·점·제어문자 제거, 20자 제한, 비면 'player' */
export function safeName(nickname: string): string {
  const s = Array.from(nickname.replace(/[\s./\\:*?"<>|\u0000-\u001f]/g, '')).slice(0, 20).join('');
  return s || 'player';
}

export function fileNames(nickname: string, date: Date): { json: string; csv: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const n = safeName(nickname);
  return { json: `result-${n}-${d}.json`, csv: `trade-log-${n}-${d}.csv` };
}

/** 브라우저에서 JSON·CSV 두 파일 내려받기. DOM 이 없으면 false */
export function downloadFiles(result: ExportResult): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
  const names = fileNames(result.nickname, new Date(result.finishedAt));
  const files: [string, Blob][] = [
    [names.json, new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })],
    [names.csv, new Blob([toCsv(result.ledger)], { type: 'text/csv;charset=utf-8' })],
  ];
  for (const [name, blob] of files) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); // 즉시 해제하면 일부 브라우저에서 다운로드가 끊긴다
  }
  return true;
}
