/** 무전 이벤트 해역 표. 좌표는 항해 지도 비율(0..1). id 는 content/events.ts 의 zone 과 같다. */
export type Zone = { id: string; x: number; y: number; r: number };
type Pos = { x: number; y: number };

export const ZONES: Zone[] = [
  { id: 'yellow-sea', x: 0.42, y: 0.31, r: 0.025 },
  { id: 'busan-harbor', x: 0.47, y: 0.29, r: 0.025 },
  { id: 'east-sea', x: 0.52, y: 0.27, r: 0.025 },
  { id: 'korea-strait', x: 0.49, y: 0.385, r: 0.025 },
  { id: 'south-china-sea', x: 0.42, y: 0.51, r: 0.025 },
  { id: 'strait-of-malacca', x: 0.35, y: 0.53, r: 0.025 },
  { id: 'java-sea', x: 0.41, y: 0.6, r: 0.025 },
  { id: 'bay-of-bengal', x: 0.3, y: 0.5, r: 0.02 },
  { id: 'indian-ocean', x: 0.3, y: 0.62, r: 0.04 },
  { id: 'north-pacific', x: 0.64, y: 0.3, r: 0.04 },
  { id: 'east-pacific', x: 0.82, y: 0.55, r: 0.04 },
];

export const zoneAt = (pos: Pos): string | null =>
  ZONES.find((z) => Math.hypot(pos.x - z.x, pos.y - z.y) <= z.r)?.id ?? null;

/** prev 에는 없고 pos 에는 있는 해역(들어선 순간만). */
export const enteredZones = (prev: Pos, pos: Pos): string[] => {
  const was = zoneAt(prev);
  const now = zoneAt(pos);
  return now !== null && now !== was ? [now] : [];
};
