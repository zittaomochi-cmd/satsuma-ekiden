// タスキに付けるスマホ用。GPSの位置をコース上の距離に直して Firebase に送る。
// URL: runner.html?team=red&key=データベースの秘密鍵   （?test=1 で大会時刻を待たずに距離を数える）
// 送るもの: teams/{id} = 最新の位置と距離（ゴール後は fin にゴール時刻）、marks/{id}/{n} = n×100m 地点の通過時刻（秒）
import { COURSE } from './course.js';
import { CONFIG } from './config.js';
import { teamById } from './teams.js';
import { ROUTE_M, mToKm, project, legAtKm } from './geo.js';
import { MARK_KM } from './feed.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const team = teamById(params.get('team'));
const key = params.get('key') ?? '';
const testMode = params.get('test') === '1';
const RACE_START = Date.parse(CONFIG.raceStart);
const MAX_ACC = 60;      // これより粗いGPSは距離計算に使わない（m）
const MAX_OFF = 50;      // コース線からこれ以上離れた点は無視（m）

function fail(msg) {
  $('setupErr').hidden = false;
  $('setupErr').innerHTML = msg;
  $('startBtn').disabled = true;
}
if (!team) fail('チームが指定されていません。<br>設定ページのQRコードから開き直してください。');
else if (CONFIG.firebaseUrl && !key) fail('送信用の鍵がありません。<br>設定ページのQRコードから開き直してください。');

const STORE_KEY = `ekiden:${team?.id}`;
// m: コース線上の距離, marks: まだ送れていない100mごとの通過時刻, lastKm/lastT: 前回の距離と時刻
const fresh = () => ({ m: 0, log: [], marks: {}, lastKm: 0, lastT: 0, fin: 0 });
let state = fresh();
try { state = { ...state, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { /* 初回 */ }
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 容量不足でも計測は続ける */ } };

if (team) {
  document.documentElement.style.setProperty('--c', team.color);
  document.documentElement.style.setProperty('--ink', team.ink);
  $('teamName').textContent = `${team.name}（${team.tasuki}）`;
  $('lockTeam').textContent = team.name;
  document.title = `${team.name} タスキ送信機`;
}

const setStat = (id, text, cls) => { $(id).textContent = text; $(id).className = cls; };

function showProgress() {
  const km = mToKm(state.m);
  $('km').textContent = `${km.toFixed(2)}km`;
  const leg = COURSE.legs[legAtKm(km)];
  $('leg').textContent = state.m <= 0 ? 'スタート前' : km >= COURSE.totalKm - 0.005 ? 'ゴール' : `${leg.no}区`;
}
showProgress();

// ---- GPS ----
let last = null;
function onFix(pos) {
  const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
  const t = Date.now();
  last = { lat, lng, acc, t };
  state.log.push([t, +lat.toFixed(6), +lng.toFixed(6), Math.round(acc)]);
  if (state.log.length > 20000) state.log.shift();

  if (acc > MAX_ACC) {
    setStat('gps', `弱い ±${Math.round(acc)}m`, 'wait');
  } else {
    setStat('gps', `良好 ±${Math.round(acc)}m`, 'ok');
    if (testMode || t >= RACE_START) {
      // 普段は少し先までだけ探す。電波が途切れて先に進んでいたら範囲を広げて探し直す
      const hit = [600, 3000].map(ahead => project(lat, lng, state.m - 100, state.m + ahead)).find(h => h && h.dist <= MAX_OFF);
      if (hit && hit.m > state.m) state.m = Math.min(hit.m, ROUTE_M);
      recordMarks(mToKm(state.m), t);
      if (!state.fin && mToKm(state.m) >= COURSE.totalKm - 0.005) state.fin = t;
    }
  }
  showProgress();
  save();
}
// 前回から今回までに越えた100m地点ごとに、通過時刻を補間して記録する
function recordMarks(km, t) {
  const { lastKm, lastT } = state;
  if (km <= lastKm) return;
  const t0 = lastT || t;
  for (let i = Math.floor(lastKm / MARK_KM + 1e-9) + 1; i * MARK_KM <= km + 1e-9; i++) {
    state.marks[i] = Math.round((t0 + (t - t0) * (i * MARK_KM - lastKm) / (km - lastKm)) / 1000);
  }
  state.lastKm = km;
  state.lastT = t;
}

function onGpsError(e) {
  setStat('gps', e.code === 1 ? '許可されていません' : '取得できません', 'ng');
  if (e.code === 1) $('hint').innerHTML = '位置情報が許可されていません。<br>ブラウザの設定でこのページの位置情報を「許可」にしてください。';
}

// ---- 送信 ----
async function send() {
  if (!last) return;
  const km = +mToKm(state.m).toFixed(3);
  if (!CONFIG.firebaseUrl) { setStat('net', '未設定', 'wait'); return; }
  const body = { [`teams/${team.id}`]: { lat: last.lat, lng: last.lng, acc: Math.round(last.acc), km, t: last.t, fin: state.fin || undefined } };
  const sending = { ...state.marks };
  for (const [i, sec] of Object.entries(sending)) body[`marks/${team.id}/${i}`] = sec;
  try {
    const res = await fetch(`${CONFIG.firebaseUrl.replace(/\/$/, '')}/live.json?auth=${encodeURIComponent(key)}`, {
      method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(res.status === 401 ? '鍵が違います' : `エラー ${res.status}`);
    for (const i of Object.keys(sending)) delete state.marks[i];
    save();
    const tm = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setStat('net', `OK ${tm}`, 'ok');
    $('lockInfo').textContent = `${km.toFixed(2)}km ・ ${tm}`;
  } catch (e) {
    setStat('net', e.message.startsWith('鍵') || e.message.startsWith('エラー') ? e.message : '圏外？再送待ち', 'ng');
    $('lockInfo').textContent = '（電波待ち）';
  }
}

// ---- 画面を消さない ----
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && running) keepAwake(); });

let running = false;
$('startBtn').onclick = () => {
  if (running || !team) return;
  if (!navigator.geolocation) return fail('この端末では位置情報が使えません。');
  running = true;
  navigator.geolocation.watchPosition(onFix, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  setInterval(send, CONFIG.sendEverySec * 1000);
  keepAwake();
  setStat('gps', '測位中…', 'wait');
  setStat('net', CONFIG.firebaseUrl ? '待機中' : '未設定', 'wait');
  $('startBtn').textContent = testMode ? '計測中（試走モード）' : '計測中';
  $('startBtn').disabled = true;
  $('lockBtn').hidden = false;
  $('hint').innerHTML = !testMode && Date.now() < RACE_START
    ? '計測中です。距離は 10:00 のスタートから数えはじめます。<br>ポーチに入れる前に「画面ロック」を押してください。'
    : '計測中です。ポーチに入れる前に「画面ロック」を押してください。';
};

// ---- ポケットの中で誤タッチしないためのロック（長押しで解除）----
$('lockBtn').onclick = () => $('lock').classList.add('on');
let holdTimer = null, holdStart = 0;
const holdBar = () => {
  const p = Math.min(1, (Date.now() - holdStart) / 2000);
  $('hold').style.width = `${p * 100}%`;
  if (p >= 1) { $('lock').classList.remove('on'); endHold(); } else holdTimer = requestAnimationFrame(holdBar);
};
const endHold = () => { cancelAnimationFrame(holdTimer); $('hold').style.width = '0'; };
$('lock').addEventListener('pointerdown', () => { holdStart = Date.now(); holdBar(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('lock').addEventListener(ev, endHold));

// ---- 試走用 ----
$('resetBtn').onclick = () => {
  if (!confirm('距離を 0 に戻し、GPSログも消します。よろしいですか？')) return;
  state = fresh();
  save();
  showProgress();
};

// GPSログをGPXで保存（試走で取ったログはコース線の差し替えに使える）
$('gpxBtn').onclick = () => {
  const pts = state.log.map(([t, lat, lng]) => `<trkpt lat="${lat}" lon="${lng}"><time>${new Date(t).toISOString()}</time></trkpt>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="satsuma-ekiden-live" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${team?.name ?? ''}</name><trkseg>\n${pts}\n</trkseg></trk></gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = `ekiden-${team?.id ?? 'log'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.gpx`;
  a.click();
};
