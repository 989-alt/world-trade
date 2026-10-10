import { useEffect, useState } from 'preact/hooks';
import { playBgm } from './audio/audio';
import type { GameEvent } from './content/types';
import { withLog } from './engine/economy';
import { AUTOSAVE_POINTS, loadGame, saveGame } from './engine/save';
import type { GameState, LogEvent, LogInput } from './engine/types';
import { setDialogOpen } from './game/boot';
import { gameStore, resumeSailing, startSailing } from './game/SailingScene';
import { EpilogueScreen } from './ui/EpilogueScreen';
import { EventCard } from './ui/EventCard';
import { mountSailingUi } from './ui/Hud';
import { LedgerScreen } from './ui/LedgerScreen';
import { mountPortUi } from './ui/PortPanel';
import { PrologueScreen } from './ui/PrologueScreen';
import { TeacherGuide } from './ui/TeacherGuide';
import { TitleScreen } from './ui/TitleScreen';

type Route = 'title' | 'prologue' | 'game' | 'epilogue' | 'teacher';

const routeFor = (s: GameState): Route => (s.stage === 'prologue' ? 'prologue' : s.stage === 'main' ? 'game' : 'epilogue');

/** 로그는 한 판 상태에 바로 붙인다(withLog). 판이 없으면(타이틀) 버린다 */
const onLog = (e: LogInput) => {
  const s = gameStore.get();
  if (s) gameStore.set(withLog(s, e));
};
const logScreen = (name: string) => onLog({ type: 'screen', name });

/** save.ts AUTOSAVE_POINTS 를 로그로 읽는다. judgment_done = 까닭 판정이 맞았거나 두 번째 시도 */
const autosaveAt = (e: LogEvent) =>
  e.type === 'judge_cause' ? e.correct || e.attempt === 2 : (AUTOSAVE_POINTS as readonly string[]).includes(e.type);

const SAVE_FAILED = '저장하지 못했습니다';
const LOAD_FAILED = '저장된 판을 읽지 못했습니다';
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function App() {
  const [route, setRoute] = useState<Route>('title');
  const [state, setState] = useState(gameStore.get());
  const [event, setEvent] = useState<GameEvent | null>(null);
  const [ledger, setLedger] = useState(false);
  const [toast, setToast] = useState<string | null>(() => {
    const r = loadGame();
    return !r.ok && r.notice !== 'none' ? LOAD_FAILED : null;
  });

  useEffect(() => gameStore.subscribe(setState), []);

  // 자동 저장: 새로 붙은 로그에 저장 시점이 있으면
  useEffect(() => {
    let seen = 0;
    return gameStore.subscribe((s) => {
      if (!s) return;
      if (s.log.length < seen) seen = 0; // 새 판
      const fresh = s.log.slice(seen);
      seen = s.log.length;
      if (fresh.some(autosaveAt) && !saveGame(s).ok) setToast(SAVE_FAILED);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // 6번째 입항 뒤 출항·머물기 → stage epilogue: 항해 화면을 걷고 에필로그로(씬은 대화창 열린 채 멈춰 있다)
  useEffect(() => {
    if (route === 'game' && state && state.stage !== 'main') setRoute('epilogue');
  }, [route, state?.stage]);

  // 항해 ⇄ 항구·무전·일지
  useEffect(() => {
    if (route !== 'game') return;
    const onDocked = (e: Event) => {
      logScreen(`port-${(e as CustomEvent<{ port: string }>).detail.port}`);
      playBgm('port');
    };
    const onUndock = () => playBgm('sail');
    const onEvent = (e: Event) => {
      const ev = (e as CustomEvent<{ event: GameEvent }>).detail.event;
      logScreen(`event-${ev.id}`);
      setEvent(ev);
    };
    const onLedger = () => {
      logScreen('ledger');
      setDialogOpen(true);
      setLedger(true);
    };
    window.addEventListener('ktrade:docked', onDocked);
    window.addEventListener('ktrade:undock', onUndock);
    window.addEventListener('ktrade:event', onEvent);
    window.addEventListener('ktrade:log', onLedger);
    const offHud = mountSailingUi(gameStore);
    const offPort = mountPortUi(gameStore);
    logScreen('game');
    playBgm('sail');
    setDialogOpen(false);
    startSailing(gameStore.get()!);
    return () => {
      window.removeEventListener('ktrade:docked', onDocked);
      window.removeEventListener('ktrade:undock', onUndock);
      window.removeEventListener('ktrade:event', onEvent);
      window.removeEventListener('ktrade:log', onLedger);
      offHud();
      offPort();
      setEvent(null);
      setLedger(false);
    };
  }, [route]);

  const start = (s: GameState) => {
    gameStore.set(s);
    saveGame(s); // 새 판이 이전 저장을 덮는다
    setRoute('prologue');
  };
  const resume = () => {
    const r = loadGame();
    if (!r.ok) return setToast(LOAD_FAILED);
    gameStore.set(r.state);
    setRoute(routeFor(r.state));
  };
  const choose = (choiceId: string) => {
    if (event) gameStore.dispatch({ type: 'EVENT_CHOICE', eventId: event.id, choiceId });
    setEvent(null);
    resumeSailing();
  };
  const closeLedger = () => {
    setLedger(false);
    resumeSailing();
  };
  const epilogueLog = (e: LogInput) => {
    onLog(e);
    if (e.type === 'screen' && e.name === 'epilogue-result') playBgm('result');
  };

  return (
    <>
      {route === 'title' && (
        <div class="title">
          <TitleScreen hasSave={loadGame().ok} onStart={start} onContinue={resume} onTeacher={() => setRoute('teacher')} />
        </div>
      )}
      {route === 'teacher' && <TeacherGuide onClose={() => setRoute('title')} />}
      {route === 'prologue' && (
        <PrologueScreen dispatch={(a) => gameStore.dispatch(a)} onLog={onLog} onDone={() => setRoute('game')} />
      )}
      {route === 'game' && event && <EventCard key={event.id} event={event} onChoose={choose} reduceMotion={reduceMotion()} />}
      {route === 'game' && ledger && state && (
        <div class="ep-root">
          <div class="ep-panel">
            <LedgerScreen state={state} onLog={onLog} onDone={closeLedger} />
          </div>
        </div>
      )}
      {route === 'epilogue' && state && (
        <EpilogueScreen state={state} dispatch={(a) => gameStore.dispatch(a)} onLog={epilogueLog} onDone={() => setRoute('title')} />
      )}
      {toast && <div class="ep-toast" role="status">{toast}</div>}
    </>
  );
}
