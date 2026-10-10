/**
 * 배경음악 3곡 + 효과음 자리. <audio> 로 재생(CSP connect-src 'none' 이라 fetch·Web Audio 디코딩은 막힌다, media-src 'self' 는 열림).
 * - 첫 사용자 제스처 전 요청은 마지막 것 하나만 기억했다가 첫 pointerdown/keydown 에 튼다(자동재생 정책)
 * - 곡 바꿈 = 0.5초 크로스페이드, 같은 곡 재요청은 무시(처음부터 다시 틀지 않는다)
 * - result 곡은 30초에서 0.5초 페이드로 끝(파일은 62초)
 * - 음소거는 localStorage 'ktrade.mute' 에 저장·복원
 * - 파일이 없거나(404) 재생이 막혀도 콘솔 warn 1회, 앱은 그대로
 */
export type Track = 'sail' | 'port' | 'result';
export type Sfx = 'click' | 'coin' | 'correct' | 'wrong' | 'radio' | 'horn';

export const BGM: Record<Track, string> = {
  sail: 'assets/bgm/bgm-sail.mp3',
  port: 'assets/bgm/bgm-port.mp3',
  result: 'assets/bgm/bgm-result.mp3',
};
/** 효과음 파일(CC0 팩 승인 대기). 파일이 생기면 여기에 경로만 넣는다 */
export const SFX: Partial<Record<Sfx, string>> = {};

export const MUTE_KEY = 'ktrade.mute';
export const FADE_MS = 500;
export const RESULT_MS = 30_000;
const TICK = 50;

export type El = {
  loop: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: 'error', fn: () => void): void;
};
export type Deps = {
  make: (src: string) => El;
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
  /** 첫 제스처를 들을 대상(window) */
  target: { addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void } | null;
  warn: (msg: string) => void;
};

export function createAudio(d: Deps) {
  const els = new Map<string, El>();
  const warned = new Set<string>();
  let muted = false;
  try {
    muted = d.storage?.getItem(MUTE_KEY) === '1';
  } catch {
    /* 저장소 접근 불가 → 소리 켬 */
  }
  let unlocked = false;
  let queued: Track | null = null;
  let current: Track | null = null;
  let fadeTimer: ReturnType<typeof setInterval> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;

  const warnOnce = (src: string, why: string) => {
    if (warned.has(src)) return;
    warned.add(src);
    d.warn(`[audio] ${why}: ${src}`);
  };
  const el = (src: string) => {
    let e = els.get(src);
    if (!e) {
      e = d.make(src);
      e.muted = muted;
      e.addEventListener('error', () => warnOnce(src, 'missing'));
      els.set(src, e);
    }
    return e;
  };
  const start = (src: string, e: El) => {
    try {
      const p = e.play();
      if (p && typeof p.catch === 'function') p.catch(() => warnOnce(src, 'play blocked'));
    } catch {
      warnOnce(src, 'play failed');
    }
  };

  /** into 를 0→1, 나머지 소리 나는 곡은 지금 볼륨→0, 끝나면 멈춤 */
  const crossfade = (into: El | null) => {
    clearInterval(fadeTimer);
    const outs = [...els.values()].filter((e) => e !== into).map((e) => [e, e.volume] as const);
    const from = into ? into.volume : 0;
    let n = 0;
    fadeTimer = setInterval(() => {
      const k = Math.min(1, ++n / (FADE_MS / TICK));
      if (into) into.volume = from + (1 - from) * k;
      for (const [e, v] of outs) e.volume = v * (1 - k);
      if (k < 1) return;
      clearInterval(fadeTimer);
      for (const [e] of outs) e.pause();
    }, TICK);
  };

  function playBgm(track: Track): void {
    if (!unlocked) {
      queued = track;
      return;
    }
    if (current === track) return;
    current = track;
    clearTimeout(endTimer);
    const e = el(BGM[track]);
    e.loop = track !== 'result';
    e.currentTime = 0;
    e.volume = 0;
    start(BGM[track], e);
    crossfade(e);
    if (track === 'result') {
      endTimer = setTimeout(() => {
        if (current !== 'result') return;
        current = null;
        crossfade(null);
      }, RESULT_MS - FADE_MS);
    }
  }

  function playSfx(name: Sfx): void {
    const src = SFX[name];
    if (!src) return warnOnce(`sfx:${name}`, 'no sfx file');
    if (!unlocked || muted) return;
    const e = el(src);
    e.currentTime = 0;
    e.volume = 1;
    start(src, e);
  }

  function setMuted(m: boolean): void {
    muted = m;
    for (const e of els.values()) e.muted = m;
    try {
      d.storage?.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* 저장 실패해도 이번 판은 반영 */
    }
  }

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    d.target?.removeEventListener('pointerdown', unlock);
    d.target?.removeEventListener('keydown', unlock);
    if (queued) playBgm(queued);
    queued = null;
  };
  d.target?.addEventListener('pointerdown', unlock);
  d.target?.addEventListener('keydown', unlock);

  return { playBgm, playSfx, setMuted, isMuted: () => muted, current: () => current };
}

function browserDeps(): Deps {
  let storage: Deps['storage'] = null;
  try {
    storage = window.localStorage;
  } catch {
    /* 사파리 개인 모드 등 */
  }
  return { make: (src) => new Audio(src), storage, target: window, warn: (m) => console.warn(m) };
}

let shared: ReturnType<typeof createAudio> | undefined;
const audio = () => (shared ??= createAudio(browserDeps()));

export const playBgm = (t: Track) => audio().playBgm(t);
export const playSfx = (n: Sfx) => audio().playSfx(n);
export const setMuted = (m: boolean) => audio().setMuted(m);
export const isMuted = () => audio().isMuted();
/** 첫 제스처 리스너를 일찍 달아 둔다(main.tsx 에서 부팅 때 한 번) */
export const initAudio = () => void audio();
