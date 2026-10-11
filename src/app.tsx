import { useEffect, useRef, useState } from 'preact/hooks';
import { playBgm } from './audio/audio';
import type { GameEvent } from './content/types';
import { withLog } from './engine/economy';
import { clearSave, createAutosave, loadGame, saveGame } from './engine/save';
import type { GameState, LogInput } from './engine/types';
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

const SAVE_FAILED = '저장하지 못했습니다';
const LOAD_FAILED = '저장된 판을 읽지 못했습니다';
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function App() {
  const [route, setRoute] = useState<Route>('title');
  const [state, setState] = useState(gameStore.get());
  const [event, setEvent] = useState<GameEvent | null>(null);
  const [ledger, setLedger] = useState(false);
  // 항해 리스너(route 클로저)가 지금 열린 창을 읽도록: 무전·일지는 겹치지 않는다(§4.7)
  const open = useRef({ event: false });
  open.current = { event: !!event };
  const [toast, setToast] = useState<string | null>(() => {
    const r = loadGame();
    return !r.ok && r.notice !== 'none' ? LOAD_FAILED : null;
  });

  useEffect(() => gameStore.subscribe(setState), []);

  // 자동 저장: 로그가 붙을 때마다(완주 done 도 저장 — 새로 고침하면 결과 화면)
  useEffect(() => {
    const autosave = createAutosave();
    return gameStore.subscribe((s) => {
      const r = autosave(s);
      if (r && !r.ok) setToast(SAVE_FAILED);
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
      if (open.current.event) return; // 무전 카드가 열려 있으면 일지를 열지 않는다
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
  // 「처음으로」: 완주 저장은 여기서만 지운다
  const home = () => {
    clearSave();
    gameStore.set(null); // 판을 내려놓아 뒤늦은 로그가 지운 저장을 되살리지 않게
    setRoute('title');
  };
  const choose = (choiceId: string) => {
    if (event) gameStore.dispatch({ type: 'EVENT_CHOICE', eventId: event.id, choiceId });
    setEvent(null);
    if (!ledger) resumeSailing(); // 남은 창이 없을 때만 항해 재개
  };
  const closeLedger = () => {
    setLedger(false);
    if (!event) resumeSailing();
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
        <EpilogueScreen state={state} dispatch={(a) => gameStore.dispatch(a)} onLog={epilogueLog} onDone={home} />
      )}
      {toast && <div class="ep-toast" role="status">{toast}</div>}
    </>
  );
}
