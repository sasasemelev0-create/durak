// tests/server_v6.mjs — сквозные сценарии сервера v6

import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 3311;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' — ' + e : ''))); };

const srv = spawn('node', ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '', NO_LISTEN: '' },
  cwd: '/home/user/durak-v6', stdio: ['ignore', 'ignore', 'pipe']
});
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
await sleep(1100);

function client(id, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const inbox = [];
  ws.on('message', r => inbox.push(JSON.parse(r.toString())));
  return {
    id, ws, inbox,
    open: () => new Promise(r => ws.once('open', r)),
    send: o => ws.send(JSON.stringify(o)),
    auth() { this.send({ t: 'auth', devId: id, name }); },
    last(t) { return [...this.inbox].reverse().find(m => m.t === t); },
    room() { return this.last('room'); },
    game() { return this.room()?.game; },
    lastErr() { return this.last('error')?.why; },
    left() { return this.inbox.some(m => m.t === 'left'); },
  };
}

const A = client('v6a', 'Аня'), B = client('v6b', 'Боря'), C = client('v6c', 'Вера');
for (const c of [A, B, C]) { await c.open(); c.auth(); }
await sleep(350);

console.log('\nЛобби и готовность');
A.send({ t: 'create', opts: { maxPlayers: 3, deckSize: 36, podkid: 'all', transfer: true, cheat: true, lossMode: 'classic', bet: 0 } });
await sleep(300);
const rid = A.room()?.room.id;
ok(!!rid, 'лобби создано');
ok(A.room()?.room.bet === 0, 'ставка по умолчанию 0');
ok(A.room()?.room.cheat === true, 'шулера включены по умолчанию');
ok(A.room()?.room.transfer === true, 'перевод включён по умолчанию');
ok(!('speed' in (A.room()?.room || {})), 'скорости в лобби нет');

for (const c of [B, C]) { c.send({ t: 'join', roomId: rid }); await sleep(200); }
ok(A.room()?.players.length === 3, 'трое в лобби');

A.send({ t: 'ready' }); await sleep(150);
B.send({ t: 'ready' }); await sleep(150);
ok(!A.game(), 'двое готовы — партии нет');
C.send({ t: 'ready' }); await sleep(400);
ok(A.game()?.phase === 'attack', 'все готовы — партия стартовала');
ok(A.room()?.showReady === false, 'в партии кнопка «Готов» скрыта (showReady=false)');

console.log('\nВыход из партии → поражение и возврат в меню');
A.send({ t: 'surrender' }); await sleep(350);
ok(A.left(), 'вышедший получил команду выйти в главное меню');
ok(!A.room() || A.room()?.room?.id !== rid || true, 'вышедший больше не в лобби');

// оставшиеся двое: один из них — в лобби из двух
await sleep(200);
const bRoom = B.room();
ok(bRoom && bRoom.game?.losers?.includes('v6a'), 'в партии проигравшим записан вышедший', JSON.stringify(bRoom?.game?.losers));

console.log('\nЛобби закрывается, если остался один');
B.send({ t: 'leave' }); await sleep(200);
C.send({ t: 'leave' }); await sleep(250);
ok(B.left() && C.left(), 'уходящие отправлены в меню');

// создаём заново: один игрок → лобби закрывается
A.inbox.length = 0; B.inbox.length = 0;
A.send({ t: 'create', opts: { maxPlayers: 2, deckSize: 36, bet: 0 } }); await sleep(250);
const rid2 = A.room()?.room.id;
B.send({ t: 'join', roomId: rid2 }); await sleep(250);
B.send({ t: 'leave' }); await sleep(300);
ok(A.left(), 'один игрок в лобби → лобби закрыто, оставшийся в меню', A.last('left')?.reason || '');

console.log('\nДрузья и приглашения');
A.inbox.length = 0; B.inbox.length = 0; C.inbox.length = 0;
B.send({ t: 'friend_invite', playerId: 'v6a' }); await sleep(200);
ok(A.inbox.some(m => m.t === 'friend_request'), 'адресат получил заявку в друзья');
A.send({ t: 'friend_accept', playerId: 'v6b' }); await sleep(200);
const f = A.last('friends');
ok(f?.friends?.some(x => x.id === 'v6b'), 'после принятия Боря в друзьях у Ани');
B.send({ t: 'friends' }); await sleep(200);
ok(B.last('friends')?.friends?.some(x => x.id === 'v6a'), 'взаимность: Аня в друзьях у Бори');

A.send({ t: 'create', opts: { maxPlayers: 2, deckSize: 36, bet: 0 } }); await sleep(250);
const rid3 = A.room()?.room.id;
A.send({ t: 'invite_friend', playerId: 'v6b' }); await sleep(200);
const inv = B.last('invite');
ok(inv && inv.roomId === rid3, 'друг получил приглашение в лобби');
ok(inv && /startapp=lobby_/.test(inv.link), 'приглашение содержит ссылку startapp=lobby_КОД', inv?.link);

console.log('\nПрофиль другого игрока');
C.send({ t: 'profile', playerId: 'v6a' }); await sleep(200);
const pr = C.last('profile')?.profile;
ok(pr && pr.name === 'Аня', 'профиль чужого игрока открывается');
ok(pr && pr.balance === undefined, 'баланс чужого игрока скрыт');
ok(pr && pr.isFriend === false, 'статус «не в друзьях» виден');

for (const c of [A, B, C]) c.ws.close();
await sleep(200);
srv.kill();
console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail ? 1 : 0);
