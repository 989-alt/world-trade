// 뱃길 검증(T15 M7·M9): 게임 모듈(autopilot·collision·ports-layout·ship)을 그대로 불러와 항해 마스크 위에서 잰다. 하나라도 걸리면 exit 1.
//   node scripts/map/validate-routes.mjs
// 1) 모든 항구 쌍(132): 출항점 → routeBetween 을 1px 간격 선체 3점(±HULL_PX)으로 — 목적 항구 반경에 드는 자리까지(자동 조타가 서는 자리), 반경 안에서 끝나야 한다.
// 2) 같은 132쌍을 실제 조타(helmStep·steer·tryMove)로 60fps·30fps 모의 항해: 막힘 0, 반경 도착.
// 3) 예인: 부산↔각 항구 뱃길 위 25px 마다 + 뱃길 밖 자유 항해 위치(seed 고정 50점) + QA 회귀 좌표 (0.5305, 0.5441)
//    → 엔진이 고르는 가장 가까운 항구까지 towPath 가 있고, 전 구간 1px 선체 3점 바다, 그 항구 반경에서 끝.
import { NAV_MASK, decodeMask, load } from './lib.mjs';

const [col, layout, ap, ship, { PORTS }, { nearestPort, dist }, { createRng }] = await load(
  '/src/game/collision.ts', '/src/game/ports-layout.ts', '/src/game/autopilot.ts', '/src/game/ship.ts', '/src/content/ports.ts', '/src/engine/economy.ts', '/src/engine/rng.ts',
);
const m = col.withOcean(decodeMask(NAV_MASK));
const W = m.width, H = m.height;
const px = (p) => `(${(p.x * W).toFixed(1)}, ${(p.y * H).toFixed(1)})`;
let bad = 0;
const fail = (msg) => {
  bad++;
  if (bad <= 30) console.log('BAD', msg);
};

/** 경로를 1px 선체 3점으로 — to 반경에 드는 첫 표본에서 멈춘다. 걸린 점 또는 null */
function landUntilDock(path, to) {
  for (let k = 1; k < path.length; k++) {
    const [a, b] = [path[k - 1], path[k]];
    const n = Math.max(1, Math.ceil(Math.hypot((b.x - a.x) * W, (b.y - a.y) * H)));
    for (let i = 0; i <= n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
      const d = { x: (b.x - a.x) * W, y: (b.y - a.y) * H };
      const L = Math.hypot(d.x, d.y) || 1;
      if (col.hullOnLand(m, p, { x: d.x / L, y: d.y / L })) return p;
      if (layout.nearestPortWithin(p)?.id === to) return null;
    }
  }
  return null;
}

/* 1) 정적 */
let pairs = 0;
for (const from of PORTS)
  for (const to of PORTS) {
    if (from === to) continue;
    pairs++;
    const path = [layout.exitPoint(from, m), ...ap.routeBetween(from.id, to.id)];
    const l = landUntilDock(path, to.id);
    if (l) fail(`route ${from.id}→${to.id} hull on land at ${px(l)}`);
    if (layout.nearestPortWithin(path[path.length - 1])?.id !== to.id) fail(`route ${from.id}→${to.id} ends outside ${to.id} radius`);
  }
console.log(`routes: ${pairs} pairs, 1px hull ±${col.HULL_PX} (3 points) until dock radius`);

/* 2) 실제 조타 모의 */
const legSec = {};
for (const dt of [1000 / 60, 1000 / 30]) {
  let worst = 0;
  for (const from of PORTS)
    for (const to of PORTS) {
      if (from === to) continue;
      const path = ap.routeBetween(from.id, to.id);
      let pos = layout.exitPoint(from, m);
      let helm = { angle: 0, speed: 0 };
      let i = 0;
      let f = 0;
      for (; f < 60 * 900; f++) {
        if (layout.nearestPortWithin(pos)?.id === to.id) break;
        const st = ship.steer(pos, path, i);
        i = st.i;
        if (st.target === null) {
          fail(`sim ${dt.toFixed(1)}ms ${from.id}→${to.id}: route ended outside port at ${px(pos)}`);
          break;
        }
        const r = ship.helmStep(helm, st.target, dt);
        helm = r.helm;
        const next = col.tryMove(m, pos, r.move);
        if (next === pos && (r.move.x || r.move.y)) {
          helm = { ...helm, speed: 0 };
          // SailingScene 과 같은 규칙: 목표 쪽을 다 보고도 막히면 실패, 도는 중이면 계속
          if (helm.angle === st.target) {
            fail(`sim ${dt.toFixed(1)}ms ${from.id}→${to.id}: blocked by land at ${px(pos)} waypoint ${i}`);
            break;
          }
        }
        pos = next;
      }
      if (dt < 20) legSec[`${from.id}>${to.id}`] = (f * dt) / 1000;
      worst = Math.max(worst, (f * dt) / 1000);
    }
  console.log(`sim ${dt.toFixed(1)}ms/frame: ${pairs} pairs, longest leg ${worst.toFixed(1)} s`);
}
const e2e = [['busan', 'vietnam'], ['vietnam', 'saudi'], ['saudi', 'singapore'], ['singapore', 'busan'], ['busan', 'japan'], ['japan', 'singapore']];
console.log(`e2e seed-42 legs (sim 60fps, 카드 시간 제외): ${e2e.map(([a, b]) => `${a}>${b} ${legSec[`${a}>${b}`].toFixed(1)}s`).join(' | ')} = ${e2e.reduce((s, [a, b]) => s + legSec[`${a}>${b}`], 0).toFixed(1)} s (S8 ≤ 240)`);
console.log(`busan→la ${legSec['busan>la'].toFixed(1)} s (PRD §3 직선 25 s)`);

/* 3) 예인 */
const towCheck = (pos, label) => {
  const port = nearestPort(pos).id;
  const path = ap.towPath(pos, port, m);
  if (!path) return fail(`tow ${label} ${px(pos)} → ${port}: no path`);
  for (let k = 1; k < path.length; k++) {
    const l = col.segmentOnLand(m, path[k - 1], path[k]);
    if (l) return fail(`tow ${label} ${px(pos)} → ${port}: hull on land at ${px(l)}`);
  }
  if (layout.nearestPortWithin(path[path.length - 1])?.id !== port) fail(`tow ${label} ${px(pos)} → ${port}: ends outside radius`);
};
let towN = 0;
for (const to of PORTS) {
  if (to.id === 'busan') continue;
  for (const [a, b] of [['busan', to.id], [to.id, 'busan']]) {
    const route = [layout.exitPoint(PORTS.find((p) => p.id === a), m), ...ap.routeBetween(a, b)];
    for (let i = 1; i < route.length; i++) {
      const n = Math.ceil(Math.hypot((route[i].x - route[i - 1].x) * W, (route[i].y - route[i - 1].y) * H) / 25);
      for (let k = 0; k < n; k++) {
        const pos = { x: route[i - 1].x + ((route[i].x - route[i - 1].x) * k) / n, y: route[i - 1].y + ((route[i].y - route[i - 1].y) * k) / n };
        if (layout.nearestPortWithin(pos)?.id === b) break; // 이미 도착
        towCheck(pos, `${a}→${b}#${i}.${k}`);
        towN++;
      }
    }
  }
}
const free = freeSailPositions(createRng, 50);
free.forEach((p, i) => towCheck(p, `free#${i}`));
towCheck({ x: 0.5305, y: 0.5441 }, 'QA-regression');
console.log(`tow: ${towN} route samples + ${free.length} free positions (seed 15) + QA (0.5305, 0.5441)`);

/** 뱃길 밖 자유 항해 위치: 큰 바다·항구 반경 밖이고 8방향 중 서로 다른 두 축 이상으로 선체 3점이 놓이는 점(배가 실제로 있고 돌 수 있는 자리). collision.test 와 같은 규칙 */
function freeSailPositions(rng, n) {
  const r = rng(15);
  const out = [];
  while (out.length < n) {
    const p = { x: r.next(), y: r.next() };
    if (!col.isOcean(m, p.x, p.y) || layout.nearestPortWithin(p)) continue;
    const ok = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => !col.hullOnLand(m, p, { x: Math.cos((k * Math.PI) / 4), y: Math.sin((k * Math.PI) / 4) }));
    if (!ok.some((a) => ok.some((b) => (a - b) % 4 !== 0))) continue; // 한 축(예: 지도 맨 위 가장자리에서 동·서)으로만 놓이는 자리는 배가 돌 수도, 갈 수도 없다
    out.push(p);
  }
  return out;
}

/* 연료 잣대: 부산 출발 뱃길 길이(비율) */
const len = (r) => r.slice(1).reduce((s, p, i) => s + dist(r[i], p), 0);
const lens = PORTS.map((p) => [p.id, len(ap.routeBetween('busan', p.id))]).sort((a, b) => b[1] - a[1]);
console.log(`busan route lengths: ${lens.map(([id, l]) => `${id} ${l.toFixed(4)}`).join(', ')}`);
console.log(`→ LONGEST_ROUTE ${lens[0][0]} ${lens[0][1].toFixed(4)}, FUEL_PER_UNIT = floor(270 / L) = ${Math.floor(270 / lens[0][1])}`);

console.log(bad ? `FAIL ${bad}` : 'OK 0 bad');
process.exit(bad ? 1 : 0);
