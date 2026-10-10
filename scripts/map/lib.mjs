// 지도 도구 공용(plan-routes·validate-routes): 런타임 TS 모듈을 vite 로 그대로 불러온다 — 계획·검증이 게임과 같은 함수(exitPoint·tryMove·towPath…)를 쓴다
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createServer } from 'vite';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** '/src/...' 경로들을 SSR 로 불러온 모듈 배열 */
export async function load(...paths) {
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
  try {
    return await Promise.all(paths.map((p) => server.ssrLoadModule(p)));
  } finally {
    await server.close();
  }
}

/** 1비트 회색 PNG(비인터레이스) → { width, height, data(1 = 흰색 = 육지) } */
export function decodeMask(path) {
  const b = readFileSync(path);
  let [w, h, depth, color, interlace] = [0, 0, 0, 0, 0];
  const idat = [];
  for (let p = 8; p < b.length; ) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') [w, h, depth, color, interlace] = [b.readUInt32BE(p + 8), b.readUInt32BE(p + 12), b[p + 16], b[p + 17], b[p + 20]];
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  if (depth !== 1 || color !== 0 || interlace !== 0) throw new Error(`${path}: 1비트 회색 비인터레이스가 아니다`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil(w / 8);
  const rows = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x > 0 ? rows[y * stride + x - 1] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const c = x > 0 && y > 0 ? rows[(y - 1) * stride + x - 1] : 0;
      const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f];
      rows[y * stride + x] = (v + pred) & 255;
    }
  }
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = (rows[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
  return { width: w, height: h, data };
}

export const NAV_MASK = `${ROOT}assets/img/mask-worldmap.png`;

/** 정확한 유클리드 거리 변환(Felzenszwalb): 칸마다 가장 가까운 육지·갇힌 물·지도 밖까지 px */
export function distanceToBlocked({ width: W, height: H, data: land, ocean }) {
  const INF = 1e12;
  const pass = (f, n) => {
    const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    let k = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) {
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s <= z[k]) k--;
        else break;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) ** 2 + f[v[k]];
    }
    return d;
  };
  const g = new Float64Array(W * H);
  for (let x = 0; x < W; x++) {
    const f = new Float64Array(H);
    for (let y = 0; y < H; y++) f[y] = land[y * W + x] || ocean[y * W + x] !== 1 ? 0 : INF;
    const d = pass(f, H);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const d = pass(g.slice(y * W, y * W + W), W);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.min(Math.sqrt(d[x]), x + 0.5, W - x - 0.5, y + 0.5, H - y - 0.5);
  }
  return out;
}
