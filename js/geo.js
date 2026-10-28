// コース上の位置計算。距離は「コース線上のメートル」と「公式km」の2種類があり、
// 中継所ごとに区切って線形に対応させる（コース線の長さが公式距離と少し違っても区間表どおりに表示するため）
import { COURSE } from './course.js';

const DEG = Math.PI / 180;
const R = 6371000;
const KX = Math.cos(COURSE.route[0][0] * DEG) * DEG * R;
const KY = DEG * R;
const xy = ([lat, lng]) => [lng * KX, lat * KY];

const P = COURSE.route.map(xy);
const CUM = [0];
for (let i = 1; i < P.length; i++) CUM.push(CUM[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
export const ROUTE_M = CUM[CUM.length - 1];

const RELAY_M = [0, ...COURSE.legs.map(l => CUM[l.i1])];
export const RELAY_KM = [0];
for (const l of COURSE.legs) RELAY_KM.push(+(RELAY_KM[RELAY_KM.length - 1] + l.km).toFixed(2));
export const TOTAL_KM = RELAY_KM[RELAY_KM.length - 1];

function lerpTable(v, from, to) {
  if (v <= from[0]) return to[0];
  for (let j = 0; j < from.length - 1; j++) {
    if (v <= from[j + 1]) return to[j] + (to[j + 1] - to[j]) * (v - from[j]) / (from[j + 1] - from[j] || 1);
  }
  return to[to.length - 1];
}
export const mToKm = m => lerpTable(m, RELAY_M, RELAY_KM);
export const kmToM = km => lerpTable(km, RELAY_KM, RELAY_M);

export function pointAtM(m) {
  m = Math.max(0, Math.min(ROUTE_M, m));
  let i = 1;
  while (i < CUM.length - 1 && CUM[i] < m) i++;
  const f = (m - CUM[i - 1]) / (CUM[i] - CUM[i - 1] || 1);
  const a = COURSE.route[i - 1], b = COURSE.route[i];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

// 線上 fromM〜toM の範囲だけで最寄り点を探す（周回コースで別の周に飛ばないように）
export function project(lat, lng, fromM, toM) {
  const [x, y] = xy([lat, lng]);
  let best = null;
  for (let i = 1; i < P.length; i++) {
    if (CUM[i] < fromM || CUM[i - 1] > toM) continue;
    const [ax, ay] = P[i - 1], [bx, by] = P[i];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    const f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const d = Math.hypot(x - ax - dx * f, y - ay - dy * f);
    const m = CUM[i - 1] + (CUM[i] - CUM[i - 1]) * f;
    if (m < fromM || m > toM) continue;
    if (!best || d < best.dist) best = { m, dist: d };
  }
  return best;
}

// km がどの区間か（0始まり）。ゴール後は最終区間
export function legAtKm(km) {
  for (let j = 0; j < COURSE.legs.length; j++) if (km < RELAY_KM[j + 1]) return j;
  return COURSE.legs.length - 1;
}
