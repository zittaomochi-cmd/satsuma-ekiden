// 本番前にここを書き換える（README の「Firebase の準備」参照）
export const CONFIG = {
  // Firebase Realtime Database の URL。空のままだとデモ表示になる
  // 例: 'https://satsuma-ekiden-default-rtdb.asia-southeast1.firebasedatabase.app'
  firebaseUrl: 'https://satsuma-ekiden-default-rtdb.asia-southeast1.firebasedatabase.app',
  raceStart: '2026-11-08T10:00:00+09:00',
  // タスキのスマホが位置を送る間隔（秒）
  sendEverySec: 5,
};

// 手元のテスト用：localhost で開いたときだけ ?db=http://localhost:8781 で送り先を差し替えられる
const db = new URLSearchParams(location.search).get('db');
if (db && ['localhost', '127.0.0.1'].includes(location.hostname)) CONFIG.firebaseUrl = db;
