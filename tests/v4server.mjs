// tests/v4server.mjs — серверные сценарии: выход=поражение, реванш, лимит подкидывания, пас
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 3251;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' — ' + e : ''))); };

const srv = spawn('node', ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '' },
  cwd: '/home/user/durak-v4', stdio: ['ignore', 'ignore', 'pipe']
});
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
await sleep(1100);

function client(id, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const inbox = [];
  ws.on('message', r => inbox.push(JSON.parse(r.toString())));
  return {
    ws, id, name, inbox,
    open: () => new Promise(r => ws.once('open', r)),
    send: o => ws.send(JSON.stringify(o)),
    auth() { this.send({ t: 'auth', devId: id, name }); },
    room() { return [...this.inbox].reverse().find(m => m.t === 'room'); },
    game() { return this.room()?.game; },
    lastErr() { return [...this.inbox].reverse().find(m => m.t === 'error')?.why; },
  };
}

const A = client('srv_a', 'Аня');
const B = client('srv_b', 'Боря');
const C = client('srv_c', 'Вера');
for (const c of [A, B, C]) { await c.open(); c.auth(); }
await sleep(400);

// лобби на 3 со ставкой
A.send({ t: 'create', opts: { maxPlayers: 3, deckSize: 36, podkid: 'all', transfer: false, cheat: false, lossMode: 'classic', bet: 100 } });
await sleep(400);
const roomId = A.room()?.room.id;
ok(!!roomId, 'лобби создано');
ok(A.room()?.room.bet === 100, 'ставка 100 в лобби', String(A.room()?.room.bet));

const balBefore = A.room()?.players?.find(p => p.id === 'srv_a')?.coins;

for (const c of [B, C]) { c.send({ t: 'join', roomId }); await sleep(250); }
ok(A.room()?.players.length === 3, 'три игрока в лобби');

console.log('\n3.1 Готовность');
for (const c of [A, B]) { c.send({ t: 'ready' }); await sleep(200); }
ok(!A.game(), 'двое готовы из трёх — партии нет');
C.send({ t: 'ready' });
await sleep(600);
ok(A.game()?.phase === 'attack', 'все готовы — партия стартовала', A.game()?.phase);

const balAfter = A.room()?.players?.find(p => p.id === 'srv_a')?.coins;
ok(balAfter === balBefore - 100, 'ставка списана при старте', `${balBefore} -> ${balAfter}`);

console.log('\n4. Защитник не может отправить карты в отбой');
const g0 = A.game();
const attackerId = g0.attackerId;
const defenderId = g0.defenderId;
const att = [A, B, C].find(c => c.id === attackerId);
const def = [A, B, C].find(c => c.id === defenderId);
const attCard = att.game().you.hand[0];
att.send({ t: 'act', action: 'attack', cardId: attCard.id });
await sleep(400);
ok(A.game().table.length === 1, 'атака выложена');

// защитник пробует «бито»
def.send({ t: 'act', action: 'endBout' });
await sleep(350);
ok(/защищающ|атакующ/i.test(def.lastErr() || ''), 'защитнику закрыть кон не дают', def.lastErr());

console.log('\n3.3 Фаза «беру» с подкидыванием');
def.send({ t: 'act', action: 'take' });
await sleep(400);
ok(!!def.game().takePhase?.active, 'защитник сказал «беру» — началась фаза подкидывания');
ok(def.game().you.canConfirmTake === false, 'сразу забрать нельзя — ждём пасов');

const maxCards = def.game().takePhase.maxCards;
ok(maxCards === Math.min(6, def.game().players.find(p => p.id === defenderId).count), 'лимит стола = карт в руке защитника', String(maxCards));

// второй атакующий подкидывает
const third = [A, B, C].find(c => c.id !== attackerId && c.id !== defenderId);
const thirdCard = third.game().you.hand.find(c => {
  const ranks = new Set();
  for (const s of third.game().table) { ranks.add(s.attack.r); if (s.defense) ranks.add(s.defense.r); }
  return ranks.has(c.r);
});
if (thirdCard) {
  third.send({ t: 'act', action: 'attack', cardId: thirdCard.id });
  await sleep(400);
  ok(third.game().table.length === 2, 'третий игрок подкинул карту', String(third.game().table.length));
}

// все пасуют
att.send({ t: 'act', action: 'passPodkid' });
await sleep(250);
ok(def.game().you.canConfirmTake === false, 'после одного паса ещё ждём');
third.send({ t: 'act', action: 'passPodkid' });
await sleep(350);
ok(def.game().you.canConfirmTake === true, 'все сказали пас — защитник может забрать');
ok(def.game().takePhase.allPassed === true, 'фаза помечена как allPassed');

def.send({ t: 'act', action: 'confirmTake' });
await sleep(500);
ok(!def.game().takePhase, 'защитник забрал карты — фаза закрылась');
ok(def.game().table.length === 0, 'стол очищен');

console.log('\n3.2 Выход из партии = поражение');
const loser = [A, B, C].find(c => c.id !== defenderId) || A;
// ставка списывается при старте, поэтому сравниваем с балансом ДО партии
const beforeOut = [A, B, C].map(c => c.room()?.players?.find(p => p.id === c.id)?.coins);
loser.send({ t: 'surrender' });
await sleep(700);
const gEnd = A.game();
ok(gEnd.phase === 'over', 'после выхода партия завершена', gEnd.phase);
ok(gEnd.losers.includes(loser.id), 'вышедший признан проигравшим', JSON.stringify(gEnd.losers));
const afterOut = [A, B, C].map(c => c.room()?.players?.find(p => p.id === c.id)?.coins);
const loserIdx = [A, B, C].findIndex(c => c.id === loser.id);
// выигравшие должны получить больше, чем у них было после списания, а вышедший — остаться без возврата
const winnerIdxs = [0,1,2].filter(i => [A,B,C][i].id !== loser.id);
const winnerGained = winnerIdxs.some(i => afterOut[i] > beforeOut[i]);
const loserSame = afterOut[loserIdx] === beforeOut[loserIdx];
ok(loserSame && winnerGained,
  'ставка вышедшего ушла победителям',
  `loser ${beforeOut[loserIdx]}->${afterOut[loserIdx]}, winners ${winnerIdxs.map(i=>beforeOut[i]+'->'+afterOut[i]).join(' ')}`);

console.log('\n3.4 Реванш');
const balBeforeRematch = A.room()?.players?.find(p => p.id === 'srv_a')?.coins;
const richEnough = [A, B, C].every(c => (c.room()?.players?.find(p => p.id === c.id)?.coins ?? 0) >= 100);
if (richEnough) {
  for (const c of [A, B, C]) { c.send({ t: 'ready' }); await sleep(250); }
  await sleep(700);
  const gNew = A.game();
  ok(gNew && gNew.phase !== 'over', 'после реванша пошла новая партия', gNew?.phase);
  ok(gNew.players.every(p => p.count === 6), 'новая раздача по 6 карт');
  const balNow = A.room()?.players?.find(p => p.id === 'srv_a')?.coins;
  ok(balNow === balBeforeRematch - 100, 'ставка списана за реванш', `${balBeforeRematch} -> ${balNow}`);
} else {
  ok(true, 'реванш пропущен — не у всех хватает монет');
}

for (const c of [A, B, C]) c.ws.close();
await sleep(300);
srv.kill();
console.log(`\n──────────────\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
