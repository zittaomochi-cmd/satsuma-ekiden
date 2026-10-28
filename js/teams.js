// 大会要項の「各チームの編成・色分け」より。色はタスキの色
export const TEAMS = [
  { id: 'red', name: '宮之城北部', short: '北部', tasuki: '赤', cls: 'A', color: '#d7263d', ink: '#fff' },
  { id: 'white', name: '宮之城ほたるA', short: 'ほA', tasuki: '白', cls: 'A', color: '#ffffff', ink: '#222' },
  { id: 'blue', name: '鶴田A', short: '鶴A', tasuki: '青', cls: 'A', color: '#1f63d6', ink: '#fff' },
  { id: 'purple', name: '宮之城屋地船木', short: '屋船', tasuki: '紫', cls: 'A', color: '#7b3fbf', ink: '#fff' },
  { id: 'pink', name: '宮之城山崎', short: '山崎', tasuki: '桃', cls: 'B', color: '#ff7eb6', ink: '#222' },
  { id: 'brown', name: '宮之城ほたるB', short: 'ほB', tasuki: '茶', cls: 'B', color: '#8b5a2b', ink: '#fff' },
  { id: 'yellow', name: '薩摩', short: '薩摩', tasuki: '黄', cls: 'B', color: '#f5c518', ink: '#222' },
  { id: 'green', name: '鶴田B', short: '鶴B', tasuki: '緑', cls: 'B', color: '#2e9d4a', ink: '#fff' },
];

export const teamById = id => TEAMS.find(t => t.id === id);
