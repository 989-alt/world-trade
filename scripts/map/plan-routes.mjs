// 12 뱃길 계획: 항해 마스크(mask-worldmap.png, 1 = 육지) 위에서 부산 출항점을 뿌리로 한 최단 바닷길 나무를 만들어
// src/game/autopilot.ts 의 ROUTES 블록을 다시 쓴다. 검증은 validate-routes.mjs.
//   node scripts/map/plan-routes.mjs
// 1) 2px 격자 Dijkstra(8방향 + 출항점은 40px 안 직결 칸). 칸 비용 = 길이 × (1 + K·max(0, C − 해안 거리)/C) — 해안에서 멀수록 싸다.
//    지나갈 수 있는 칸 = 큰 바다(갇힌 호수 제외)·해안 거리 ≥ TP(출항점 NT px 안은 3)이고, 칸 사이 선분 위 선체(중심·선수·선미 ±MH)가 0.5px 마다 바다.
// 2) 나무의 갈림점·출항점만 남기고, 그 사이를 탐욕적으로 곧게 편다(선분 위 선체가 바다 ∧ 해안 거리 ≥ min(CL, 원래 길의 최소)).
//    북극해(y < ARCTIC_Y)는 막는다.
// 3) 도착점: 꺾은선이 출항점 전에 그 항구 반경에 들면 그 자리, 아니면 핀 0.025 안 큰 바다 중 마지막 꺾임에서 곧장 가는 점
//    (끝까지 바다인 점 우선, 없으면 반경에 들 때까지 바다인 점) 가운데 해안에서 가장 먼 점.
import { readFileSync, writeFileSync } from 'node:fs';
import { NAV_MASK, ROOT, decodeMask, distanceToBlocked, load } from './lib.mjs';

const [{ withOcean }, { exitPoint, nearestPortWithin }, { PORTS }] = await load('/src/game/collision.ts', '/src/game/ports-layout.ts', '/src/content/ports.ts');
const m = withOcean(decodeMask(NAV_MASK));
const { width: W, height: H, data: land, ocean } = m;

const S = 2; // 격자 간격(px)
const MH = 28; // 선체 반길이(런타임 HULL_PX). 여유는 비용(K·C)과 CL 로 준다 — 독일 항구 물길이 좁아 더 크게는 못 지난다
const TP = 8; // 지나갈 칸의 최소 해안 거리(출항점 NT px 밖). 12 면 아프리카 서쪽 → 독일 물길이 끊긴다(fix1 실측)
const NT = 350; // 출항점 근처(px)는 해안 거리 3 까지 허용(부산 만 어귀 10.8px·독일 항구 물길이 좁다)
const K = 3;
const C = 48;
const CL = 30; // 곧게 편 선분의 해안 거리 하한
const AR = 0.025; // 도착점 반경(비율)
/**
 * 북극해 금지 띠(T14 와 같은 정책): 지도 위쪽 y < ARCTIC_Y px(= 0.15, 지도 맨 위 307px)는 뱃길이 지나지 못한다 → 독일은 아프리카를 돈다.
 * 독일 항구 물길(y ≈ 430~480)과 아프리카 서쪽 바다는 이 띠 아래다. 손 조타는 막지 않는다(뱃길 계획만)
 */
const ARCTIC_Y = 0.15 * 2048;

const blocked = (x, y) => {
  const px = Math.floor(x), py = Math.floor(y);
  return px < 0 || py < ARCTIC_Y || px >= W || py >= H || land[py * W + px] === 1 || ocean[py * W + px] !== 1;
};

const edt = distanceToBlocked(m);
const clear = (x, y) => edt[Math.floor(y) * W + Math.floor(x)];

/** 점(px)에 방향 (hx,hy) 로 놓인 선체(중심·선수·선미)가 막혔나. 옆면은 안 본다 — 마스크가 이미 6px 부풀린 육지 */
const poseBad = (cx, cy, hx, hy) => blocked(cx, cy) || blocked(cx + hx * MH, cy + hy * MH) || blocked(cx - hx * MH, cy - hy * MH);
/** 선분(px) 위 0.5px 간격 선체 */
const segBad = (a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  if (!L) return false;
  const n = Math.ceil(L * 2);
  for (let i = 0; i <= n; i++) if (poseBad(a.x + (dx * i) / n, a.y + (dy * i) / n, dx / L, dy / L)) return true;
  return false;
};
const segClear = (a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, n = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  let c = Infinity;
  for (let i = 0; i <= n; i++) c = Math.min(c, clear(a.x + (dx * i) / n, a.y + (dy * i) / n));
  return c;
};

const r4 = (v) => Math.round(v * 1e5) / 1e5;
const toPx = (p) => ({ x: p.x * W, y: p.y * H });
const EX = Object.fromEntries(PORTS.map((p) => [p.id, exitPoint(p, m)]));
const EXR = Object.fromEntries(Object.entries(EX).map(([id, e]) => [id, { x: r4(e.x), y: r4(e.y) }]));

/* 1) 격자 Dijkstra */
const GW = Math.floor(W / S), GH = Math.floor(H / S), N = GW * GH;
const gx = (i) => (i % GW) * S + S / 2, gy = (i) => Math.floor(i / GW) * S + S / 2;
const cellOf = (p) => Math.floor((p.y * H) / S) * GW + Math.floor((p.x * W) / S);
const targets = PORTS.map((p) => cellOf(EX[p.id]));
const exitAt = new Map(PORTS.map((p) => [cellOf(EX[p.id]), p.id]));
/** 칸 → 비율 좌표(출항점 칸이면 정확한 출항점 — 배가 실제로 놓이는 자리) */
const P = (c) => (exitAt.has(c) ? EXR[exitAt.get(c)] : { x: r4(gx(c) / W), y: r4(gy(c) / H) });
const near = (i) => targets.some((t) => Math.hypot(gx(t) - gx(i), gy(t) - gy(i)) < NT);
const passable = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const c = clear(gx(i), gy(i));
  passable[i] = !blocked(gx(i), gy(i)) && (c >= TP || (c >= 3 && near(i))) ? 1 : 0;
}
const dist = new Float64Array(N).fill(Infinity);
const prev = new Int32Array(N).fill(-1);
// 이진 힙(키·값 배열)
let hk = new Float64Array(1 << 20), hv = new Int32Array(1 << 20), hn = 0;
const push = (k, v) => {
  if (hn === hk.length) {
    const k2 = new Float64Array(hn * 2), v2 = new Int32Array(hn * 2);
    k2.set(hk);
    v2.set(hv);
    [hk, hv] = [k2, v2];
  }
  let c = hn++;
  while (c > 0) {
    const p = (c - 1) >> 1;
    if (hk[p] <= k) break;
    hk[c] = hk[p];
    hv[c] = hv[p];
    c = p;
  }
  hk[c] = k;
  hv[c] = v;
};
const pop = () => {
  const v = hv[0];
  const k = hk[--hn], val = hv[hn];
  let c = 0;
  for (;;) {
    const l = 2 * c + 1;
    if (l >= hn) break;
    const r = l + 1 < hn && hk[l + 1] < hk[l] ? l + 1 : l;
    if (hk[r] >= k) break;
    hk[c] = hk[r];
    hv[c] = hv[r];
    c = r;
  }
  hk[c] = k;
  hv[c] = val;
  return v;
};
const src = cellOf(EX.busan);
dist[src] = 0;
push(0, src);
// 이웃 = 8방향 칸 + 출항점은 40px 안에서 선체가 곧장 닿는 칸 전부(좁은 물길의 출항점은 8방향 어디로도 바로 못 나간다 — 독일)
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const links = new Map();
const link = (a, b) => (links.get(a) ?? links.set(a, []).get(a)).push(b);
for (const [c] of exitAt) {
  const R = 40 / S, x = c % GW, y = Math.floor(c / GW);
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const k = (y + dy) * GW + x + dx;
      if ((dx || dy) && Math.hypot(dx, dy) <= R && passable[k] && !segBad(toPx(P(c)), toPx(P(k)))) [link(c, k), link(k, c)];
    }
}
const done = new Uint8Array(N);
while (hn) {
  const i = pop();
  if (done[i]) continue;
  done[i] = 1;
  const x = i % GW, y = Math.floor(i / GW);
  const near8 = NB.map(([dx, dy]) => (x + dx < 0 || y + dy < 0 || x + dx >= GW || y + dy >= GH ? -1 : (y + dy) * GW + x + dx)).filter((j) => j >= 0 && !segBad(toPx(P(i)), toPx(P(j))));
  for (const j of [...near8, ...(links.get(i) ?? [])]) {
    if (!passable[j] || done[j]) continue;
    const a = P(i), b = P(j);
    const nd = dist[i] + Math.hypot((a.x - b.x) * W, (a.y - b.y) * H) * (1 + (K * Math.max(0, C - clear(gx(j), gy(j)))) / C);
    if (nd < dist[j]) {
      dist[j] = nd;
      prev[j] = i;
      push(nd, j);
    }
  }
}

/* 2) 나무 → 꺾은선 */
const gp = {};
for (const p of PORTS) {
  if (p.id === 'busan') continue;
  const t = cellOf(EX[p.id]);
  if (dist[t] === Infinity) throw new Error(`닿지 못함: ${p.id}`);
  const path = [];
  for (let c = t; c !== -1; c = prev[c]) path.push(c);
  gp[p.id] = path.reverse();
}
const succ = new Map();
for (const p of Object.values(gp))
  for (let i = 0; i < p.length - 1; i++) {
    if (!succ.has(p[i])) succ.set(p[i], new Set());
    succ.get(p[i]).add(p[i + 1]);
  }
const kept = new Set([src, ...targets]);
for (const [n, s] of succ) if (s.size > 1) kept.add(n);

const ok = (a, b) => !segBad(toPx(a), toPx(b)) && !segBad(toPx(b), toPx(a));
const memo = new Map();
function straighten(seq) {
  const key = `${seq[0]}:${seq[seq.length - 1]}`;
  if (memo.has(key)) return memo.get(key);
  const out = [];
  let i = 0;
  while (i < seq.length - 1) {
    // 출항점(정확한 좌표)에서 바로 옆 칸 중심으로는 선체가 비스듬히 걸릴 수 있다 → 40칸 안에서 처음 곧장 닿는 칸부터
    let j = i + 1;
    while (j < Math.min(seq.length - 1, i + 40) && !ok(P(seq[i]), P(seq[j]))) j++;
    let lo = Infinity;
    for (let k = i; k <= j; k++) lo = Math.min(lo, clear(gx(seq[k]), gy(seq[k])));
    while (j + 1 < seq.length) {
      const lo2 = Math.min(lo, clear(gx(seq[j + 1]), gy(seq[j + 1])));
      const a = P(seq[i]), b = P(seq[j + 1]);
      if (!ok(a, b) || segClear(toPx(a), toPx(b)) < Math.min(CL, lo2) - 2) break; // −2: 칸 중심과 선분 표본의 픽셀 양자화
      lo = lo2;
      j++;
    }
    if (!ok(P(seq[i]), P(seq[j]))) throw new Error(`곧은 마디가 막힘 (${gx(seq[i])},${gy(seq[i])})`);
    out.push(P(seq[j]));
    i = j;
  }
  memo.set(key, out);
  return out;
}
const ROUTES = {};
const P0 = EXR.busan;
for (const [id, p] of Object.entries(gp)) {
  const wps = [P0];
  let s = 0;
  for (let i = 1; i < p.length; i++)
    if (kept.has(p[i])) {
      wps.push(...straighten(p.slice(s, i + 1)));
      s = i;
    }
  ROUTES[id] = wps;
}

/* 3) 도착점: 자동 조타는 입항 반경에 드는 순간 멈춘다 → 마지막 마디는 반경에 들 때까지만 선체 검사(validate-routes 와 같은 규칙).
   끝까지 곧장 갈 수 있는 점을 먼저, 그다음 해안에서 먼 점 */
const okUntilDock = (a, b, id) => {
  const A = toPx(a), B = toPx(b), dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy), n = Math.ceil(L * 2);
  for (let i = 0; i <= n; i++) {
    if (poseBad(A.x + (dx * i) / n, A.y + (dy * i) / n, dx / L, dy / L)) return false;
    if (nearestPortWithin({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n })?.id === id) return true;
  }
  return true;
};
/** 꺾은선이 출항점에 닿기 전에 그 항구 반경에 들면 그 자리(2px 더 안쪽)가 도착점 — 자동 조타는 거기서 선다(독일: 좁은 목 출항점) */
const entry = (r, id) => {
  for (let k = 1; k < r.length; k++) {
    const a = r[k - 1], b = r[k], n = Math.ceil(Math.hypot((b.x - a.x) * W, (b.y - a.y) * H) * 2);
    for (let i = 0; i <= n; i++)
      if (nearestPortWithin({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n })?.id === id) {
        const t = Math.min(n, i + 4) / n;
        const q = { x: r4(a.x + (b.x - a.x) * t), y: r4(a.y + (b.y - a.y) * t) };
        return nearestPortWithin(q)?.id === id ? q : null;
      }
  }
  return null;
};
for (const p of PORTS) {
  const last = p.id === 'busan' ? P0 : ROUTES[p.id][ROUTES[p.id].length - 1];
  const early = p.id === 'busan' ? null : entry(ROUTES[p.id], p.id);
  if (early) {
    ROUTES[p.id].push(early);
    console.error(`arrival ${p.id} on the way (before exit), ${ROUTES[p.id].length} points`);
    continue;
  }
  let best = null;
  let bs = -1;
  const { x: px, y: py } = p.mapPos;
  for (let y = Math.floor((py - AR) * H); y <= (py + AR) * H; y++)
    for (let x = Math.floor((px - AR) * W); x <= (px + AR) * W; x++) {
      const q = { x: r4((x + 0.5) / W), y: r4((y + 0.5) / H) };
      if (Math.hypot(q.x - px, q.y - py) > AR || blocked(q.x * W, q.y * H) || nearestPortWithin(q)?.id !== p.id) continue;
      const c = clear(q.x * W, q.y * H);
      if (c + 1000 <= bs || !okUntilDock(last, q, p.id)) continue;
      const sc = c + (ok(last, q) ? 1000 : 0);
      if (sc > bs) [best, bs] = [q, sc];
    }
  if (!best) throw new Error(`도착점 없음: ${p.id}`);
  if (p.id === 'busan') ROUTES.busan = [P0, best];
  else ROUTES[p.id].push(best);
  console.error(`arrival ${p.id} ${bs >= 1000 ? 'straight' : 'until-dock'} clearance ${(bs % 1000).toFixed(1)}px, ${ROUTES[p.id].length} points`);
}

/* autopilot.ts ROUTES 블록 교체(키 순서 = PORTS) */
const file = `${ROOT}src/game/autopilot.ts`;
const ts = readFileSync(file, 'utf8');
const body = PORTS.map((p) => `  ${p.id}: [${ROUTES[p.id].map((q) => `[${q.x}, ${q.y}]`).join(', ')}],`).join('\n');
const next = ts.replace(/(const ROUTES: Record<PortId, P\[\]> = \{\n)[\s\S]*?(\n\};)/, `$1${body}$2`);
if (next === ts) console.error('ROUTES 변화 없음');
writeFileSync(file, next);
console.error('wrote', file);
