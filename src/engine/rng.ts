/** 결정적 시드 난수(mulberry32). Math.random 금지 */
export type Rng = {
  next: () => number;
  int: (min: number, max: number) => number;
  shuffle: <T>(arr: readonly T[]) => T[];
  pick: <T>(arr: readonly T[]) => T;
};

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** min·max 포함 */
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const shuffle = <T>(arr: readonly T[]) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = int(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pick = <T>(arr: readonly T[]) => arr[int(0, arr.length - 1)];
  return { next, int, shuffle, pick };
}
