import type { PortId } from '../content/types';
import type { GameState } from '../engine/types';
import { tryMove, type Mask } from './collision';
import type { Pos } from './ship';

type Box = { x: number; y: number; w: number; h: number };
/** view: e2e 측정용 — 배 그림(중심·표시 크기)과 카메라가 보는 월드 사각형(worldView)·줌, 월드 좌표 */
export type Autopilot = { sailTo(port: PortId): Promise<void>; dock(): void; state(): GameState | null; view(): { ship: Box; cam: Box & { zoom: number } } };

/** e2e 전용 자동 조타는 URL ?e2e=1 일 때만 */
export const shouldExposeAutopilot = (search: string) => new URLSearchParams(search).get('e2e') === '1';

export function installAutopilot(api: Autopilot): void {
  if (shouldExposeAutopilot(window.location.search)) (window as unknown as { __ktrade: Autopilot }).__ktrade = api;
}

type P = [number, number];
/**
 * 부산 출항점에서 각 항구까지 바다 뱃길(비율 좌표). 마지막 둘 = 그 항구 출항점, 입항 반경 안 도착점.
 * 부산을 뿌리로 한 나무라 같은 앞부분은 같은 점이다 → 항구 사이는 갈림점까지 되짚어 간다.
 * T14: 선체 3점(선수·중심·선미 ±14 월드px) 기준으로 다시 뽑았다 — mask-worldmap.png 위에서 선체가 놓일 수 있는 칸만 잇는 최단 바닷길
 * (해안에 가까울수록·배 그림 상자에 육지가 많이 들수록 비싸게)을 부산에서 한 번에 펼쳐 나무로 만들고, 꺾인 점만 남긴 뒤
 * 부산→일본 첫 꺾임은 손으로 북쪽(대한 해협 가운데)으로 옮겼다. 북극해는 막았다(독일은 아프리카를 돈다).
 * 8px 보다 짧은 마디는 지웠다 — 웨이포인트 0.5px 앞에서 다음 점으로 넘어갈 때 짧은 마디는 방향이 크게 틀어져 선미가 해안에 걸린다(실측).
 * 검증: collision.test.ts 'autopilot waypoints' — 모든 항구 쌍, 1 월드px 이하 간격, 3점 선체.
 */
const ROUTES: Record<PortId, P[]> = {
  busan: [[0.48, 0.375], [0.5036, 0.3354]],
  shanghai: [[0.48, 0.375], [0.485, 0.37], [0.4632, 0.3608]],
  japan: [[0.48, 0.375], [0.4766, 0.3564], [0.5544, 0.3608], [0.5618, 0.3618], [0.5518, 0.3472]],
  vietnam: [[0.48, 0.375], [0.473, 0.4468], [0.4626, 0.4595], [0.4443, 0.4634], [0.4189, 0.4731], [0.4105, 0.5073], [0.4046, 0.5083], [0.4, 0.515], [0.4189, 0.4731]],
  thai: [[0.48, 0.375], [0.473, 0.4468], [0.4626, 0.4595], [0.4443, 0.4634], [0.4189, 0.4731], [0.4105, 0.5073], [0.4118, 0.5218], [0.3545, 0.5015]],
  singapore: [[0.48, 0.375], [0.473, 0.4468], [0.4626, 0.4595], [0.4443, 0.4634], [0.4189, 0.4731], [0.4105, 0.5073], [0.4105, 0.5317], [0.4352, 0.5532], [0.4435, 0.5616], [0.3786, 0.5679]],
  indonesia: [[0.48, 0.375], [0.473, 0.4468], [0.4626, 0.4595], [0.4443, 0.4634], [0.4189, 0.4731], [0.4105, 0.5073], [0.4105, 0.5317], [0.411, 0.6225], [0.4385, 0.5747]],
  saudi: [[0.48, 0.375], [0.473, 0.4468], [0.4626, 0.4595], [0.4443, 0.4634], [0.4189, 0.4731], [0.4105, 0.5073], [0.4046, 0.5083], [0.3369, 0.5083], [0.305, 0.46], [0.2803, 0.479]],
  germany: [[0.48, 0.375], [0.473, 0.4468], [0.4626, 0.4595], [0.4443, 0.4634], [0.4189, 0.4731], [0.4105, 0.5073], [0.4046, 0.5083], [0.3369, 0.5083], [0.1507, 0.5806], [0.0706, 0.6099], [0.0218, 0.5923], [0.0075, 0.3706], [0.0309, 0.2144], [0.0999, 0.2319], [0.0993, 0.2495], [0.0982, 0.2518], [0.1084, 0.2378]],
  la: [[0.48, 0.375], [0.4766, 0.3564], [0.5544, 0.3608], [0.5732, 0.3774], [0.5999, 0.3804], [0.7818, 0.3918], [0.7314, 0.3804]],
  chile: [[0.48, 0.375], [0.4766, 0.3564], [0.5544, 0.3608], [0.5732, 0.3774], [0.5999, 0.3804], [0.736, 0.5884], [0.8636, 0.7778], [0.8877, 0.8062], [0.899, 0.8225], [0.8682, 0.8267]],
  brazil: [[0.48, 0.375], [0.4766, 0.3564], [0.5544, 0.3608], [0.5732, 0.3774], [0.5999, 0.3804], [0.736, 0.5884], [0.8636, 0.7778], [0.8877, 0.8062], [0.9665, 0.8042], [0.9762, 0.647], [0.965, 0.63], [0.9476, 0.6323]],
};

const same = (a: P, b: P) => a[0] === b[0] && a[1] === b[1];

/** a 의 끝점에서 b 와 갈라진 점까지 되짚어 간 뒤 b 를 끝까지 */
function along(a: P[], b: P[]): Pos[] {
  let k = 0;
  while (k < a.length && k < b.length - 1 && same(a[k], b[k])) k++;
  return [...a.slice(Math.max(k - 1, 0)).reverse(), ...b.slice(k)].map(([x, y]) => ({ x, y }));
}

/** from 항구 출항점 → to 항구 도착점 경로 */
export const routeBetween = (from: PortId, to: PortId): Pos[] => along(ROUTES[from].slice(0, -1), ROUTES[to]);

/**
 * 예인 뱃길(V6): 지금 위치 → 선체가 곧장 갈 수 있는 가장 가까운 뱃길 점 → 나무를 따라 to 항구 도착점.
 * 도착점 바로 앞의 출항점은 곧장 갈 수 있으면 건너뛴다(지나쳤다 되돌아오지 않게). 곧장 갈 뱃길 점이 없으면 가장 가까운 점
 */
export function towPath(pos: Pos, to: PortId, m: Mask): Pos[] {
  const clear = (a: Pos, b: Pos) => tryMove(m, a, { x: b.x - a.x, y: b.y - a.y }) !== a;
  const pts = (Object.keys(ROUTES) as PortId[]).flatMap((id) => ROUTES[id].map(([x, y], j) => ({ id, j, d: Math.hypot(x - pos.x, y - pos.y) })));
  pts.sort((a, b) => a.d - b.d);
  const best = pts.find(({ id, j }) => clear(pos, { x: ROUTES[id][j][0], y: ROUTES[id][j][1] })) ?? pts[0];
  const path = [pos, ...along(ROUTES[best.id].slice(0, best.j + 1), ROUTES[to])];
  const n = path.length;
  if (n >= 3 && clear(path[n - 3], path[n - 1])) path.splice(n - 2, 1);
  return path;
}
