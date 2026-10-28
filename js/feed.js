// データの受け取り口。本番は Firebase Realtime Database を数秒おきに読みに行く
// （常時接続だと無料プランの同時接続100件を観戦者で使い切るため、短い読み込みを繰り返す）。
// URL 未設定や ?demo のときはブラウザ内で8チームを走らせるデモ。
// どちらも store = { teams: { id: {lat,lng,km,acc,t} }, marks: { id: { 100m番号: 通過時刻(秒) } } } を渡す
import { COURSE } from './course.js';
import { TEAMS } from './teams.js';
import { TOTAL_KM, RELAY_KM, kmToM, pointAtM } from './geo.js';

export const MARK_KM = 0.1;

export function connectLive(baseUrl, onData, onStatus) {
  const base = baseUrl.replace(/\/$/, '');
  const store = { teams: {}, marks: {} };
  const get = async part => {
    const res = await fetch(`${base}/live/${part}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    store[part] = (await res.json()) ?? {};
  };
  let failures = 0;
  const poll = async (part, everyMs) => {
    try { await get(part); failures = 0; onStatus('live'); onData(store); } catch { if (++failures > 1) onStatus('reconnecting'); }
    setTimeout(() => poll(part, everyMs), everyMs * (document.hidden ? 4 : 1));
  };
  poll('teams', 5000);
  poll('marks', 20000);
  return { now: () => Date.now() };
}

// ---- デモ ----
// 区間の走者区分ごとの目安ペース（分/km）
const PACE = {
  '中高生男子': 3.35, '29歳以下': 3.45, '30歳代': 3.7, '40歳代': 3.9, '50歳代': 4.25,
  '女子（フリー）': 4.4, '小学生男子': 3.95, '小学生女子': 4.3, 'フリー': 3.8,
};

function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

export function startDemo(onData, raceStartMs) {
  const rnd = seeded(20261108);
  // チームごとの各区間タイム（ミリ秒）
  const splits = TEAMS.map((t, ti) => {
    // 先頭が予定（10:56ゴール）前後になるくらいの強さ
    const strength = (t.cls === 'A' ? 0.8 : 0.86) + rnd() * 0.07;
    return COURSE.legs.map(l => l.km * PACE[l.runner] * 60000 * strength * (0.95 + rnd() * 0.1));
  });
  let speed = 10, demoT0 = Date.now(), race0 = raceStartMs - 60000;
  const now = () => race0 + (Date.now() - demoT0) * speed;
  const marks = Object.fromEntries(TEAMS.map(t => [t.id, {}]));

  function kmAt(ti, ms) {
    let el = ms - raceStartMs;
    if (el <= 0) return 0;
    for (let j = 0; j < splits[ti].length; j++) {
      if (el < splits[ti][j]) return RELAY_KM[j] + (RELAY_KM[j + 1] - RELAY_KM[j]) * el / splits[ti][j];
      el -= splits[ti][j];
    }
    return TOTAL_KM;
  }

  // km 地点の通過時刻（ミリ秒）
  function timeAt(ti, km) {
    let t = raceStartMs;
    for (let j = 0; j < splits[ti].length; j++) {
      if (km <= RELAY_KM[j + 1]) return t + splits[ti][j] * (km - RELAY_KM[j]) / (RELAY_KM[j + 1] - RELAY_KM[j]);
      t += splits[ti][j];
    }
    return t;
  }

  function tick() {
    const t = now();
    const teams = {};
    TEAMS.forEach((tm, ti) => {
      const km = kmAt(ti, t);
      const [lat, lng] = pointAtM(kmToM(km));
      teams[tm.id] = { lat: lat + (rnd() - 0.5) * 6e-5, lng: lng + (rnd() - 0.5) * 6e-5, km, acc: 8, t };
      if (km >= TOTAL_KM) teams[tm.id].fin = Math.round(timeAt(ti, TOTAL_KM));
      for (let i = 1; i <= Math.floor(km / MARK_KM + 1e-9); i++) marks[tm.id][i] ??= Math.round(timeAt(ti, i * MARK_KM) / 1000);
    });
    onData({ teams, marks });
  }
  tick();
  const timer = setInterval(tick, 1000);
  return {
    now,
    get speed() { return speed; },
    setSpeed(s) { race0 = now(); demoT0 = Date.now(); speed = s; tick(); },
    restart() { for (const k in marks) marks[k] = {}; race0 = raceStartMs - 60000; demoT0 = Date.now(); tick(); },
    close: () => clearInterval(timer),
  };
}
