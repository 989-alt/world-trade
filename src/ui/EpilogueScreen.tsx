import { useEffect, useState } from 'preact/hooks';
import { buildLedger, computeGrade, EPILOGUE_COMPARE_SCREEN } from '../engine/result';
import { buildResult, downloadFiles, type ExportResult } from '../engine/export';
import type { Action } from '../engine/state';
import type { GameState, LogEvent, LogInput } from '../engine/types';
import { LedgerScreen } from './LedgerScreen';
import { MindmapForm } from './MindmapForm';
import './epilogue.css';

export const SENTENCE_MIN = 10;

/** 까닭 문장 입력 규칙: 10자 이상만 제출, 제출 뒤 고치기 1회, 그 뒤 잠금 */
export function sentenceGate(submits: number, editing: boolean, text: string) {
  const long = Array.from(text.trim()).length >= SENTENCE_MIN;
  const open = submits === 0 || (submits === 1 && editing);
  return { readOnly: !open, canSubmit: open && long, canEdit: submits === 1 && !editing };
}

/** 비교 막대 값(§4.5): 무역 턴 평균 = 비자급 턴 현금 증감(판 값 − 산 값 − 통관 수수료 − 급유비) ÷ 실제 입항 수.
 *  입항 전(출발 전 부산 구매 등) 비용은 다음 입항 몫이라 합계에만 들고 턴을 따로 세지 않는다.
 *  예인 직후 입항은 거래 없는 입항(자급자족 턴과 같은 로그)이라 분모에서 뺀다. 머문 턴(autarky)은 0 */
export function compareBars(log: LogEvent[]) {
  let here = 'busan';
  let net = 0;
  let calls = 0;
  let prev: LogEvent['type'] | null = null;
  for (const e of log) {
    if (e.type === 'port_call') { here = e.port; if (prev !== 'towed') calls++; }
    else if (e.type === 'depart') here = 'sea';
    else if (e.type === 'buy_home') net -= e.price * e.qty;
    else if (e.type === 'refuel') net -= e.cost;
    else if (e.type === 'trade') {
      const v = e.price * e.qty;
      net += (e.dir === 'import' && e.to === 'busan' && here !== 'busan' ? -v : v) - (e.fee ?? 0); // 해외에서 산 값 / 판 값
    }
    prev = e.type;
  }
  return {
    tradeAvg: calls ? Math.round(net / calls) : 0,
    tradeCalls: calls,
    stayTurns: log.filter((e) => e.type === 'autarky').length,
  };
}

function WhyScreen({ log, onLog, onDone }: { log: LogEvent[]; onLog: (e: LogInput) => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [submits, setSubmits] = useState(0);
  const [editing, setEditing] = useState(false);
  useEffect(() => { onLog({ type: 'screen', name: EPILOGUE_COMPARE_SCREEN }); }, []);
  const g = sentenceGate(submits, editing, text);
  const b = compareBars(log);
  const top = Math.max(Math.abs(b.tradeAvg), 1);
  const submit = () => {
    if (!g.canSubmit) return;
    onLog({ type: 'sentence', text: text.trim() });
    setSubmits(submits + 1);
    setEditing(false);
  };
  return (
    <>
      <div class="ep-two">
        <div class="ep-col">
          <h2 class="ep-h">무역이 생기는 까닭</h2>
          <textarea class="ep-text" value={text} readOnly={g.readOnly} aria-label="무역이 생기는 까닭"
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          <div class="ep-acts">
            <button type="button" class="ep-btn" disabled={!g.canSubmit} onClick={submit}>제출</button>
            {g.canEdit && <button type="button" class="ep-btn cream" onClick={() => setEditing(true)}>고치기</button>}
          </div>
        </div>
        <div class="ep-col">
          <h2 class="ep-h">무역한 턴 · 머문 턴</h2>
          {b.stayTurns === 0 ? (
            <p class="ep-note">머문 턴 없음</p>
          ) : (
            <div class="ep-bars">
              <div class="ep-bar"><span>{b.tradeAvg}</span><i style={{ height: `${Math.max(8, (Math.abs(b.tradeAvg) / top) * 110)}px` }} /><span>무역한 턴</span></div>
              <div class="ep-bar"><span>0</span><i class="low" style={{ height: '8px' }} /><span>머문 턴</span></div>
            </div>
          )}
        </div>
      </div>
      {submits >= 1 && !editing && <button type="button" class="ep-btn orange" onClick={onDone}>다음</button>}
    </>
  );
}

/** 결과 화면 숫자: 코인, 판정 정답/전체(방향·까닭 모두 1차 시도 기준), 일지 행 수 */
export function resultStats(state: GameState) {
  const first = state.log.filter((e) => (e.type === 'judge_dir' || e.type === 'judge_cause') && e.attempt === 1);
  return {
    grade: computeGrade(state),
    coins: state.cash,
    judge: { correct: first.filter((e) => 'correct' in e && e.correct).length, total: first.length },
    rows: buildLedger(state).length,
  };
}

/** 내보내기: JSON·CSV 두 파일. 다운로드 함수는 주입 가능(테스트) */
export function doExport(state: GameState, dl: (r: ExportResult) => boolean = downloadFiles): boolean {
  return dl(buildResult(state));
}

export function ResultScreen({ state, onDone }: { state: GameState; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const s = resultStats(state);
  const save = () => { if (doExport(state)) setSaved(true); };
  return (
    <div class="ep-root">
      <img class="ep-art" src="assets/img/key-title.png" alt="" />
      <div class="ep-panel result">
        <div class="ep-ribbon">항해 결과</div>
        <div class={`ep-medal ${s.grade.grade}`}><b>{s.grade.grade}</b></div>
        <div class="ep-rankname">{s.grade.nameKo}</div>
        <div class="ep-stats">
          <span class="ep-stat"><img src="assets/ui/icon-coin.png" alt="코인" />{s.coins}</span>
          <span class="ep-stat"><img src="assets/ui/icon-compass.png" alt="판정" />{s.judge.correct}/{s.judge.total}</span>
          <span class="ep-stat"><img src="assets/ui/icon-ledger.png" alt="일지" />{s.rows}</span>
        </div>
        <div class="ep-acts">
          <button type="button" class="ep-btn orange lg" onClick={save}>결과 내보내기</button>
          <button type="button" class="ep-btn cream" onClick={onDone}>처음으로</button>
        </div>
      </div>
      {saved && <div class="ep-toast" role="status">저장됨</div>}
    </div>
  );
}

type Props = { state: GameState; dispatch: (a: Action) => void; onLog: (e: LogInput) => void; onDone: () => void };
const PHASES = ['ledger', 'why', 'mind', 'result'] as const;
/** 완주(done) 저장본을 이어하면 결과 화면부터 */
export const firstPhase = (s: Pick<GameState, 'stage'>) => (s.stage === 'done' ? PHASES.indexOf('result') : 0);

export function EpilogueScreen({ state, dispatch, onLog, onDone }: Props) {
  const [i, setI] = useState(() => firstPhase(state));
  const phase = PHASES[i];
  const next = () => setI((n) => Math.min(n + 1, PHASES.length - 1));
  useEffect(() => {
    if (phase !== 'why') onLog({ type: 'screen', name: `epilogue-${phase}` });
    if (phase === 'result' && state.stage === 'epilogue') dispatch({ type: 'FINISH' });
  }, [phase]);
  if (phase === 'result') return <ResultScreen state={state} onDone={onDone} />;
  return (
    <div class="ep-root">
      <img class="ep-art" src="assets/img/key-title.png" alt="" />
      <div class="ep-panel">
        {phase === 'ledger' && <LedgerScreen state={state} onLog={onLog} onDone={next} />}
        {phase === 'why' && <WhyScreen log={state.log} onLog={onLog} onDone={next} />}
        {phase === 'mind' && <MindmapForm onLog={onLog} onDone={next} />}
      </div>
    </div>
  );
}
