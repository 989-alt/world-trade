import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MANIFEST } from '../assets/manifest';
import { BGM, FADE_MS, MUTE_KEY, RESULT_MS, createAudio, type Deps, type El } from './audio';

type Fake = El & { src: string; plays: number; paused: boolean; fail: () => void };

function setup(saved: Record<string, string> = {}, playRejects = false) {
  const els: Fake[] = [];
  const store = { ...saved };
  const listeners = new Map<string, () => void>();
  const warn = vi.fn();
  const deps: Deps = {
    make(src) {
      let onError = () => {};
      const e: Fake = {
        src, loop: false, volume: 1, muted: false, currentTime: 0, plays: 0, paused: true,
        play() {
          e.plays++;
          e.paused = false;
          return playRejects ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
        },
        pause() { e.paused = true; },
        addEventListener(_t, fn) { onError = fn; },
        fail: () => onError(),
      };
      els.push(e);
      return e;
    },
    storage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => void (store[k] = v) },
    target: {
      addEventListener: (t, f) => void listeners.set(t, f),
      removeEventListener: (t) => void listeners.delete(t),
    },
    warn,
  };
  const a = createAudio(deps);
  const gesture = (t = 'pointerdown') => listeners.get(t)?.();
  const bySrc = (src: string) => els.find((e) => e.src === src)!;
  return { a, els, store, warn, gesture, bySrc, listeners };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('audio', () => {
  it('자동재생: 제스처 전 요청은 재생하지 않고 마지막 것만 큐에, 첫 제스처에 재생', () => {
    const { a, els, gesture, bySrc, listeners } = setup();
    a.playBgm('sail');
    a.playBgm('port');
    expect(els.filter((e) => e.plays > 0)).toHaveLength(0);
    gesture('keydown');
    expect(bySrc(BGM.port).plays).toBe(1);
    expect(els.find((e) => e.src === BGM.sail)).toBeUndefined();
    expect(listeners.size).toBe(0); // 리스너 정리
  });

  it('같은 곡 재요청은 재시작 없음, 다른 곡은 0.5초 크로스페이드 후 이전 곡 정지', () => {
    const { a, gesture, bySrc } = setup();
    gesture();
    a.playBgm('sail');
    vi.advanceTimersByTime(FADE_MS);
    const sail = bySrc(BGM.sail);
    expect(sail.volume).toBeCloseTo(1);
    sail.currentTime = 12;
    a.playBgm('sail');
    expect(sail.plays).toBe(1);
    expect(sail.currentTime).toBe(12);

    a.playBgm('port');
    const port = bySrc(BGM.port);
    vi.advanceTimersByTime(FADE_MS / 2);
    expect(port.volume).toBeGreaterThan(0.3);
    expect(port.volume).toBeLessThan(0.7);
    expect(sail.volume).toBeGreaterThan(0.3);
    expect(sail.paused).toBe(false);
    vi.advanceTimersByTime(FADE_MS / 2);
    expect(port.volume).toBeCloseTo(1);
    expect(sail.volume).toBeCloseTo(0);
    expect(sail.paused).toBe(true);
    expect(port.loop).toBe(true);
  });

  it('결과 곡은 반복 없이 30초에 페이드로 끝', () => {
    const { a, gesture, bySrc } = setup();
    gesture();
    a.playBgm('result');
    const r = bySrc(BGM.result);
    expect(r.loop).toBe(false);
    vi.advanceTimersByTime(RESULT_MS - FADE_MS - 1);
    expect(r.paused).toBe(false);
    vi.advanceTimersByTime(FADE_MS + 1);
    expect(r.paused).toBe(true);
    expect(r.volume).toBeCloseTo(0);
    expect(a.current()).toBeNull();
  });

  it('음소거: localStorage ktrade.mute 에 저장, 새로 만들 때 복원, 재생 중 곡에도 반영', () => {
    const s1 = setup();
    s1.gesture();
    s1.a.playBgm('sail');
    s1.a.setMuted(true);
    expect(s1.store[MUTE_KEY]).toBe('1');
    expect(s1.bySrc(BGM.sail).muted).toBe(true);

    const s2 = setup({ [MUTE_KEY]: '1' });
    expect(s2.a.isMuted()).toBe(true);
    s2.gesture();
    s2.a.playBgm('port');
    expect(s2.bySrc(BGM.port).muted).toBe(true);
    s2.a.setMuted(false);
    expect(s2.store[MUTE_KEY]).toBe('0');
    expect(s2.bySrc(BGM.port).muted).toBe(false);
  });

  it('파일 누락(404)·재생 거부: warn 1회, throw 없음', async () => {
    const { a, gesture, bySrc, warn } = setup({}, true);
    gesture();
    expect(() => a.playBgm('sail')).not.toThrow();
    await Promise.resolve();
    bySrc(BGM.sail).fail();
    bySrc(BGM.sail).fail();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('효과음: 파일이 없으면 아무것도 만들지 않고 이름마다 warn 1회', () => {
    const { a, gesture, els, warn } = setup();
    gesture();
    expect(() => {
      a.playSfx('coin');
      a.playSfx('coin');
      a.playSfx('click');
    }).not.toThrow();
    expect(els).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('asset manifest', () => {
  // 디스크 목록·소스 원문은 Vite glob 으로(테스트에 node 타입 없음)
  const onDisk = new Set(Object.keys(import.meta.glob('../../assets/**/*.{png,mp3}')).map((k) => k.replace('../../', '')));
  const sources = import.meta.glob(['../**/*.{ts,tsx,css}', '!../**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('모든 경로가 상대경로이고 world-trade/assets 아래 실제 파일이다(키·파일 1:1)', () => {
    const paths = Object.values(MANIFEST);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) {
      expect(p, p).toMatch(/^assets\/(ui|img|bgm)\//);
      expect(onDisk.has(p), p).toBe(true);
    }
  });

  it('src 가 문자열로 쓰는 에셋 경로는 전부 매니페스트에 있다', () => {
    const used = new Set<string>();
    for (const src of Object.values(sources)) {
      for (const m of src.matchAll(/assets\/(?:ui|img|bgm)\/[\w\-/]+\.(?:png|mp3)/g)) used.add(m[0]);
    }
    expect(used.size).toBeGreaterThan(15);
    const listed = new Set(Object.values(MANIFEST));
    expect([...used].filter((p) => !listed.has(p))).toEqual([]);
  });
});
