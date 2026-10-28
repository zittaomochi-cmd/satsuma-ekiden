import { COURSE } from './course.js';
import { CONFIG } from './config.js';
import { TEAMS } from './teams.js';
import { TOTAL_KM, RELAY_KM, legAtKm } from './geo.js';
import { connectLive, startDemo, MARK_KM } from './feed.js';

const $ = id => document.getElementById(id);
const RACE_START = Date.parse(CONFIG.raceStart);
const STALE_MS = 60000;

// ---- 地図 ----
const map = L.map('map', { zoomControl: true, attributionControl: true });
L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
  maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
}).addTo(map);
const courseLine = L.polyline(COURSE.route, { color: '#fff', weight: 9, opacity: .9 }).addTo(map);
L.polyline(COURSE.route, { color: getComputedStyle(document.documentElement).getPropertyValue('--course').trim(), weight: 5 }).addTo(map);
const fitCourse = () => map.fitBounds(courseLine.getBounds(), { padding: [24, 24] });
fitCourse();
$('fitBtn').onclick = fitCourse;

// 同じ地点を何度も通るので、中継所の番号はまとめて表示
const RELAY_LABEL = { start: 'S・4・7・11', r1: '1・8', r2: '2・9', r3: '3・10', r5: '5', r6: '6', r12: '12', goal: 'ゴール' };
for (const r of COURSE.relays) {
  L.marker([r.lat, r.lng], {
    icon: L.divIcon({ className: '', html: `<div class="relay ${r.key === 'goal' ? 'goal' : ''}">${RELAY_LABEL[r.key]}</div>`, iconSize: [0, 0] }),
    zIndexOffset: -100,
  }).bindTooltip(`${r.name}${r.key === 'goal' ? '' : '（中継所）'}`).addTo(map);
}

const markers = {};
let selected = null;

// ---- 区間表 ----
$('legTable').innerHTML = COURSE.legs.map(l =>
  `<tr data-leg="${l.no}"><td>${l.no}</td><td>${l.to}</td><td>${l.runner}</td><td>${l.km.toFixed(2)}</td><td>${l.planTo}</td></tr>`).join('');

// ---- 計算 ----
const fmt = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

// 100mごとの通過時刻 → [[時刻ms, km], ...]。Firebase は連番キーを配列で返すので null を飛ばす
let trackCache = {};
function sortedTrack(id, raw) {
  const entries = raw ? Object.entries(raw).filter(([, sec]) => sec != null) : [];
  const c = trackCache[id];
  if (c && c.n === entries.length) return c.arr;
  const arr = entries.map(([i, sec]) => [sec * 1000, +(i * MARK_KM).toFixed(2)]).sort((a, b) => a[0] - b[0]);
  trackCache[id] = { n: entries.length, arr };
  return arr;
}

// track の中で km 地点を通過した時刻（線形補間）
function timeAtKm(track, km) {
  for (let i = 0; i < track.length; i++) {
    if (track[i][1] >= km) {
      if (!i) return track[0][0];
      const [t0, k0] = track[i - 1], [t1, k1] = track[i];
      return t0 + (t1 - t0) * (km - k0) / (k1 - k0 || 1);
    }
  }
  return null;
}

function standings(store, now) {
  const rows = TEAMS.map(team => {
    const s = store.teams?.[team.id];
    const marks = sortedTrack(team.id, store.marks?.[team.id]);
    if (!s) return { team, km: -1, track: marks, finished: false };
    const km = Math.min(TOTAL_KM, Math.max(0, +s.km || 0));
    const track = [...marks.filter(p => p[1] < km), [s.t, km]];
    const finished = km >= TOTAL_KM - 0.005;
    const finishT = finished ? (s.fin ?? s.t) : null;
    // 直近90秒の速度から次の中継所までの時間を見積もる
    let eta = null;
    const back = track.filter(p => p[0] >= s.t - 90000);
    if (back.length >= 2) {
      const [t0, k0] = back[0], [t1, k1] = back[back.length - 1];
      const v = (k1 - k0) / (t1 - t0);
      if (v > 0) eta = (RELAY_KM[legAtKm(km) + 1] - km) / v;
    }
    return { team, s, km, track, finished, finishT, eta, stale: now - s.t > STALE_MS && !finished };
  });
  rows.sort((a, b) => {
    if (a.finished && b.finished) return a.finishT - b.finishT;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.km - a.km;
  });
  const leader = rows[0];
  for (const r of rows) {
    if (r.km < 0 || r === leader) continue;
    if (r.finished) r.gap = r.finishT - leader.finishT;
    else {
      const t = timeAtKm(leader.track, r.km);
      if (t != null) r.gap = r.s.t - t;
    }
  }
  return rows;
}

// ---- 描画 ----
function render(store, now) {
  const rows = standings(store, now);
  const any = rows.some(r => r.km >= 0);
  $('empty').hidden = any;

  const el = now - RACE_START;
  if (el < -86400000) {
    const d = new Date(RACE_START);
    $('clockLabel').textContent = 'スタート';
    $('clock').textContent = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  } else if (el < 0) { $('clockLabel').textContent = 'スタートまで'; $('clock').textContent = fmt(-el); }
  else { $('clockLabel').textContent = '経過'; $('clock').textContent = fmt(el); }

  $('standings').innerHTML = rows.map((r, i) => {
    const t = r.team;
    if (r.km < 0) {
      return `<li class="row" data-id="${t.id}"><span class="rank">-</span><div class="who"><div class="name">${chip(t)}${t.name}<span class="cls">${t.cls}</span></div><div class="where">データ待ち</div></div><div class="gap"></div></li>`;
    }
    const leg = COURSE.legs[legAtKm(r.km)];
    let where, gap;
    if (r.finished) {
      where = `<b>ゴール</b>（${fmt(r.finishT - RACE_START)}）`;
    } else if (r.km <= 0) {
      where = 'スタート前';
    } else {
      const left = (RELAY_KM[leg.no] - r.km).toFixed(2);
      where = `<b>${leg.no}区</b> ${leg.runner}・${leg.to}まで ${left}km${r.eta ? `・約${Math.max(1, Math.round(r.eta / 60000))}分` : ''}`;
    }
    if (i === 0) gap = `<div class="gap ${r.finished ? 'fin' : 'lead'}">${r.finished ? '優勝' : 'トップ'}<small>${r.km.toFixed(2)}km</small></div>`;
    else gap = `<div class="gap ${r.finished ? 'fin' : ''}">${r.gap != null ? '+' + fmt(r.gap) : ''}<small>${r.km.toFixed(2)}km</small></div>`;
    const pct = (r.km / TOTAL_KM * 100).toFixed(1);
    return `<li class="row ${r.stale ? 'stale' : ''} ${selected === t.id ? 'sel' : ''}" data-id="${t.id}">
      <span class="rank">${i + 1}</span>
      <div class="who"><div class="name">${chip(t)}${t.name}<span class="cls">${t.cls}</span></div>
        <div class="where">${where}</div><div class="bar"><i style="width:${pct}%;background:${t.color === '#ffffff' ? '#9aa1ab' : t.color}"></i></div></div>
      ${gap}</li>`;
  }).join('');

  // 先頭チームの区間を区間表で強調
  const lead = rows.find(r => r.km > 0 && !r.finished);
  const curLeg = lead ? COURSE.legs[legAtKm(lead.km)].no : 0;
  document.querySelectorAll('#legTable tr').forEach(tr => tr.classList.toggle('now', +tr.dataset.leg === curLeg));

  rows.forEach((r, i) => {
    if (r.km < 0 || !r.s) return;
    const t = r.team;
    const html = `<div class="tm ${selected === t.id ? 'sel' : ''} ${r.stale ? 'stale' : ''}" style="background:${t.color};color:${t.ink}">${i + 1}</div>`;
    const icon = L.divIcon({ className: '', html, iconSize: [26, 26], iconAnchor: [13, 13] });
    if (!markers[t.id]) {
      markers[t.id] = L.marker([r.s.lat, r.s.lng], { icon }).bindTooltip(t.name, { direction: 'top', offset: [0, -14] }).addTo(map);
      markers[t.id].on('click', () => select(t.id));
    } else {
      markers[t.id].setLatLng([r.s.lat, r.s.lng]).setIcon(icon);
    }
    markers[t.id].setZIndexOffset(1000 - i * 10 + (selected === t.id ? 500 : 0));
  });
}

const chip = t => `<span class="chip" style="background:${t.color};color:${t.ink}">${t.tasuki}</span>`;

function select(id) {
  selected = selected === id ? null : id;
  if (selected && markers[id]) map.panTo(markers[id].getLatLng());
  redraw();
}
$('standings').addEventListener('click', e => {
  const li = e.target.closest('.row');
  if (li) select(li.dataset.id);
});

// ---- データ ----
let store = {};
let feed;
const redraw = () => render(store, feed.now());
const onData = s => { store = s; if (feed) redraw(); };
const params = new URLSearchParams(location.search);

if (CONFIG.firebaseUrl && !params.has('demo')) {
  feed = connectLive(CONFIG.firebaseUrl, onData, st => {
    $('status').textContent = st === 'live' ? 'LIVE' : '再接続中';
    $('status').className = 'pill ' + (st === 'live' ? 'live' : '');
  });
} else {
  feed = startDemo(onData, RACE_START);
  $('status').textContent = 'DEMO';
  $('status').className = 'pill demo';
  $('demoBar').hidden = false;
  const mark = () => document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === feed.speed));
  document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { feed.setSpeed(+b.dataset.speed); mark(); });
  $('restartBtn').onclick = () => { trackCache = {}; feed.restart(); };
  mark();
}
setInterval(redraw, 1000);
