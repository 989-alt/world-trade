import type { PortId } from '../content/types';
import type { GameState } from '../engine/types';
import { segmentOnLand, type Mask } from './collision';
import { nearestPortWithin } from './ports-layout';
import type { Pos } from './ship';

type Box = { x: number; y: number; w: number; h: number };
/** view: e2e 측정용 — 배 그림(중심·표시 크기)과 카메라가 보는 월드 사각형(worldView, 월드 좌표)·줌(CSS px 당, dpr 배수 k 를 뺀 값)·k */
export type Autopilot = { sailTo(port: PortId): Promise<void>; dock(): void; state(): GameState | null; view(): { ship: Box; cam: Box & { zoom: number; k: number } } };

/** e2e 전용 자동 조타는 URL ?e2e=1 일 때만 */
export const shouldExposeAutopilot = (search: string) => new URLSearchParams(search).get('e2e') === '1';

export function installAutopilot(api: Autopilot): void {
  if (shouldExposeAutopilot(window.location.search)) (window as unknown as { __ktrade: Autopilot }).__ktrade = api;
}

type P = [number, number];
/**
 * 부산 출항점에서 각 항구까지 바다 뱃길(비율 좌표). 마지막 둘 = 그 항구 출항점(exitPoint), 입항 반경 안 도착점.
 * 부산을 뿌리로 한 나무라 같은 앞부분은 같은 점이다 → 항구 사이는 갈림점까지 되짚어 간다.
 * T15: 세부 지도 3072×2048 항해 마스크로 scripts/map/plan-routes.mjs 가 생성(손으로 고치지 않는다) — 선체 3점(±28)이 놓이는 칸만 잇는
 * 최단 바닷길(해안에 가까울수록 비싸게)을 부산에서 펼친 나무, 갈림점 사이는 곧게 폈다. 자동 조타는 입항 반경에 드는 순간 서므로
 * 마지막 마디는 반경에 들 때까지만 바다면 된다(독일·부산). 칠레는 출항점 전에 반경에 들어 도착점이 출항점보다 앞에 있다.
 * 검증: node scripts/map/validate-routes.mjs — 모든 항구 쌍 1px 선체 3점, 실제 조타(ship.ts helmStep) 모의 항해, 예인 연결.
 */
const ROUTES: Record<PortId, P[]> = {
  busan: [[0.48, 0.375], [0.4891, 0.35327]],
  saudi: [[0.48, 0.375], [0.50488, 0.35791], [0.51725, 0.35986], [0.5525, 0.36897], [0.56673, 0.37939], [0.7347, 0.55811], [0.73796, 0.56592], [0.7373, 0.7124], [0.72754, 0.74561], [0.71257, 0.76221], [0.66439, 0.80127], [0.62598, 0.84229], [0.43132, 0.71143], [0.41309, 0.68311], [0.305, 0.46], [0.26937, 0.48315]],
  shanghai: [[0.48, 0.375], [0.485, 0.37], [0.44548, 0.35132]],
  japan: [[0.48, 0.375], [0.50488, 0.35791], [0.51725, 0.35986], [0.5525, 0.36897], [0.54997, 0.34497]],
  vietnam: [[0.48, 0.375], [0.50488, 0.35791], [0.51725, 0.35986], [0.5525, 0.36897], [0.56673, 0.37939], [0.7347, 0.55811], [0.73796, 0.56592], [0.7373, 0.7124], [0.72754, 0.74561], [0.71257, 0.76221], [0.66439, 0.80127], [0.62598, 0.84229], [0.43132, 0.71143], [0.41309, 0.68311], [0.40788, 0.67041], [0.40332, 0.64307], [0.4, 0.515], [0.42041, 0.47485]],
  singapore: [[0.48, 0.375], [0.50488, 0.35791], [0.51725, 0.35986], [0.5525, 0.36897], [0.56673, 0.37939], [0.7347, 0.55811], [0.73796, 0.56592], [0.7373, 0.7124], [0.72754, 0.74561], [0.71257, 0.76221], [0.66439, 0.80127], [0.62598, 0.84229], [0.43132, 0.71143], [0.41309, 0.68311], [0.40788, 0.67041], [0.40332, 0.64307], [0.41103, 0.6225], [0.44347, 0.56165], [0.38037, 0.56519]],
  thai: [[0.48, 0.375], [0.50488, 0.35791], [0.51725, 0.35986], [0.5525, 0.36897], [0.56673, 0.37939], [0.7347, 0.55811], [0.73796, 0.56592], [0.7373, 0.7124], [0.72754, 0.74561], [0.71257, 0.76221], [0.66439, 0.80127], [0.62598, 0.84229], [0.43132, 0.71143], [0.41309, 0.68311], [0.40788, 0.67041], [0.36835, 0.53347], [0.35824, 0.5022]],
  indonesia: [[0.48, 0.375], [0.50488, 0.35791], [0.51725, 0.35986], [0.5525, 0.36897], [0.56673, 0.37939], [0.7347, 0.55811], [0.73796, 0.56592], [0.7373, 0.7124], [0.72754, 0.74561], [0.71257, 0.76221], [0.66439, 0.80127], [0.62598, 0.84229], [0.43132, 0.71143], [0.41309, 0.68311], [0.40788, 0.67041], [0.40332, 0.64307], [0.41103, 0.6225], [0.44157, 0.5769]],
  la: [[0.48, 0.375], [0.50488, 0.35791], [0.51725, 0.35986], [0.5525, 0.36897], [0.56673, 0.37939], [0.59993, 0.38623], [0.78182, 0.39182], [0.73063, 0.37573]],
  germany: [[0.48, 0.375], [0.50488, 0.35791], [0.51725, 0.35986], [0.5525, 0.36897], [0.56673, 0.37939], [0.59993, 0.38623], [0.62012, 0.34814], [0.61296, 0.18896], [0.60449, 0.16357], [0.59863, 0.1333], [0.50749, 0.07666], [0.20475, 0.03271], [0.08236, 0.05225], [0.0153, 0.16162], [0.03223, 0.20654], [0.05827, 0.2251], [0.075, 0.225], [0.09619, 0.2312]],
  brazil: [[0.48, 0.375], [0.50488, 0.35791], [0.51725, 0.35986], [0.5525, 0.36897], [0.56673, 0.37939], [0.7347, 0.55811], [0.73796, 0.56592], [0.90853, 0.83154], [0.97624, 0.81201], [0.98926, 0.73975], [0.98535, 0.65967], [0.96347, 0.64165], [0.94417, 0.63599]],
  chile: [[0.48, 0.375], [0.50488, 0.35791], [0.51725, 0.35986], [0.5525, 0.36897], [0.56673, 0.37939], [0.7347, 0.55811], [0.89897, 0.8225], [0.86736, 0.77162]],
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

/** 예인 격자 칸(월드 px). 계약은 8px 였지만 8px·8방향으로는 QA 회귀 좌표(좁고 굽은 만)에서 선체 3점 길이 안 나와 4px·16방향 */
export const TOW_CELL_PX = 4;
const TOW_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];

/**
 * 예인 뱃길(V6·M9, 순수·결정적): 지금 위치 → 선체가 곧장 갈 수 있는 뱃길 점(거리 + 그 점부터 to 까지 뱃길 길이가 가장 짧은 것) → 나무를 따라 to 항구,
 * 반경에 드는 자리에서 끝. 곧장 닿는 뱃길 점이 없으면 지금 위치에 맞춘 4px 격자 BFS(16방향, 칸 사이도 선체 3점 바다)로
 * 곧장 닿는 첫 칸까지 간 길을 앞에 붙인다(곧게 펴서).
 * 길이 없으면 null — 부르는 쪽이 경고하고 배는 제자리(직선으로 땅을 건너지 않는다)
 */
export function towPath(pos: Pos, to: PortId, m: Mask): Pos[] | null {
  const clear = (a: Pos, b: Pos) => !segmentOnLand(m, a, b);
  // 도착점(각 뱃길 마지막)은 빼고: 도착점→출항점 마디는 반경 안쪽이 바다라는 보장이 없다
  const pxLen = (r: Pos[]) => r.slice(1).reduce((L, q, i) => L + Math.hypot((q.x - r[i].x) * m.width, (q.y - r[i].y) * m.height), 0);
  const pts = (Object.keys(ROUTES) as PortId[]).flatMap((id) =>
    ROUTES[id].slice(0, -1).map(([x, y], j) => ({ id, j, x, y, rest: pxLen(along(ROUTES[id].slice(0, j + 1), ROUTES[to])) })),
  );
  const reach = (p: Pos, maxPx: number) =>
    pts
      .map((q) => ({ ...q, d: Math.hypot((q.x - p.x) * m.width, (q.y - p.y) * m.height) }))
      .filter((q) => q.d <= maxPx)
      .sort((a, b) => a.d + a.rest - (b.d + b.rest))
      .find((q) => clear(p, q));
  let lead: Pos[] = [pos];
  let best = reach(pos, Infinity);
  if (!best) {
    const cx = TOW_CELL_PX / m.width;
    const cy = TOW_CELL_PX / m.height;
    const key = (i: number, j: number) => `${i},${j}`;
    const from = new Map<string, string | null>([[key(0, 0), null]]);
    const queue: [number, number][] = [[0, 0]];
    const at = (i: number, j: number) => ({ x: pos.x + i * cx, y: pos.y + j * cy });
    for (let h = 0; h < queue.length && h < 50000 && !best; h++) {
      const [i, j] = queue[h];
      for (const [di, dj] of TOW_DIRS) {
        const [ni, nj] = [i + di, j + dj];
        if (from.has(key(ni, nj)) || !clear(at(i, j), at(ni, nj))) continue;
        from.set(key(ni, nj), key(i, j));
        queue.push([ni, nj]);
        best = reach(at(ni, nj), 300);
        if (best) {
          const chain: Pos[] = [];
          for (let k: string | null = key(ni, nj); k; k = from.get(k)!) chain.unshift(at(...(k.split(',').map(Number) as [number, number])));
          chain[0] = pos;
          // 곧게 펴기: 앞 점에서 곧장 닿는 가장 먼 점으로
          lead = [chain[0]];
          for (let a = 0; a < chain.length - 1; ) {
            let b = chain.length - 1;
            while (b > a + 1 && !clear(chain[a], chain[b])) b--;
            lead.push(chain[b]);
            a = b;
          }
          break;
        }
      }
    }
    if (!best) return null;
  }
  const path = [...lead, ...along(ROUTES[best.id].slice(0, best.j + 1), ROUTES[to])];
  const n = path.length;
  if (n >= 3 && clear(path[n - 3], path[n - 1])) path.splice(n - 2, 1); // 출항점까지 갔다 되돌아오지 않게
  // 반경에 들어 선체가 바다인 첫 자리에서 끝(자동 조타가 서는 자리) — 도착점까지 가면 반경 안쪽 육지를 지날 수 있다(독일·부산)
  for (let k = 1; k < path.length; k++) {
    const [a, b] = [path[k - 1], path[k]];
    const steps = Math.max(1, Math.ceil(Math.hypot((b.x - a.x) * m.width, (b.y - a.y) * m.height)));
    for (let s = 0; s <= steps; s++) {
      const p = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps };
      if (nearestPortWithin(p)?.id === to && (s === 0 || clear(a, p))) return [...path.slice(0, k), p];
    }
  }
  return path;
}
