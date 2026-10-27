// tests/e2e.mjs — сквозной тест: сервер + 2 клиента по WebSocket
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 3111;
const BASE = `ws://127.0.0.1:${PORT}/ws`;
let pass = 0, fail = 0;
const ok = (c, n, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' — ' + e : ''))); };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function client(id, name) {
  const ws = new WebSocket(BASE);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(m)) { waiters[i].res(m); waiters.splice(i, 1); }
    }
  });
  ws.on('error', () => { });
  const api = {
    ws, id, name,
    open: () => new Promise(r => ws.once('open', r)),
    send: (o) => ws.send(JSON.stringify(o)),
    waitFor: (pred, timeout = 2500) => new Promise((res, rej) => {
      const hit = inbox.find(pred);
      if (hit) return res(hit);
      const w = { pred, res };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout waiting for ' + pred.toString())); }
      }, timeout);
    }),
    auth: async () => {
      api.send({ t: 'auth', devId: id, name });
      return api.waitFor(m => m.t === 'auth_ok');
    },
    last: (pred) => [...inbox].reverse().find(pred),
    clear: () => { inbox.length = 0; },
    close: () => ws.close()
  };
  return api;
}

const srv = spawn('node', ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '' },
  cwd: '/home/user/durak-v4',
  stdio: ['ignore', 'pipe', 'pipe']
});
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
await sleep(900);

try {
  // ---------- авторизация ----------
  console.log('\nАвторизация');
  const A = client('u_alice', 'Алиса');
  await A.open();
  const authA = await A.auth();
  ok(authA.t === 'auth_ok' && authA.profile.name === 'Алиса', 'вход в dev-режиме');

  const B = client('u_bob', 'Борис');
  await B.open();
  await B.auth();

  // ---------- создание лобби ----------
  console.log('\nСоздание лобби и настройки');
  A.send({
    t: 'create', password: '1234',
    opts: { maxPlayers: 2, deckSize: 36, podkid: 'neighbors', transfer: true, cheat: false, lossMode: 'classic' }
  });
  const roomA = await A.waitFor(m => m.t === 'room');
  ok(roomA.room.maxPlayers === 2, 'лобби на 2 игрока');
  ok(roomA.room.deckSize === 36, 'колода 36');
  ok(roomA.room.podkid === 'neighbors', 'подкидывают только соседи');
  ok(roomA.room.transfer === true, 'переводной включён');
  ok(roomA.room.locked === true, 'лобби под паролем');
  const roomId = roomA.room.id;

  // список лобби виден второму
  B.send({ t: 'lobby_list' });
  const list = await B.waitFor(m => m.t === 'lobby_list' && m.rooms.some(r => r.id === roomId));
  ok(!!list, 'лобби видно в списке');

  // ---------- вход по паролю ----------
  console.log('\nВход и пароль');
  B.send({ t: 'join', roomId, password: 'wrong' });
  const errBad = await B.waitFor(m => m.t === 'error');
  ok(/пароль/i.test(errBad.why), 'неверный пароль отклонён', errBad.why);

  B.send({ t: 'join', roomId, password: '1234' });
  const roomB = await B.waitFor(m => m.t === 'room' && m.players.length === 2);
  ok(roomB.players.length === 2, 'второй игрок вошёл');

  // ---------- старт ----------
  console.log('\nСтарт партии');
  // раньше стартовал хост — теперь партия начинается, когда готовы все
  A.send({ t: 'ready' });
  await sleep(300);
  ok(A.last(m => m.t === 'room')?.game === null, 'один готов — партия ещё не началась');

  B.send({ t: 'ready' });
  await sleep(700);
  console.log('   DEBUG readyCount=', A.last(m => m.t === 'room')?.readyCount,
    'players=', A.last(m => m.t === 'room')?.players?.map(p => p.id + ':' + p.ready).join(','),
    'game=', !!A.last(m => m.t === 'room')?.game);
  const started = await A.waitFor(m => m.t === 'room' && m.game && m.game.phase !== 'over');
  ok(!!started.game, 'партия началась');
  ok(started.game.players.every(p => p.count === 6), 'по 6 карт');
  ok(started.game.deckCount === 36 - 12, 'в колоде осталось 24');
  const meA = started.game.players.find(p => p.id === 'u_alice');
  const meB0 = started.game.players.find(p => p.id === 'u_bob');
  ok(meA.hand?.length === 6 && meB0.hand === null, 'свои карты видны, чужие скрыты');

  // ---------- ход ----------
  console.log('\nХод и синхронизация');
  const gA = A.last(m => m.t === 'room' && m.game).game;
  const gB = (await B.waitFor(m => m.t === 'room' && m.game)).game;
  ok(gA.attackerId === gB.attackerId, 'оба клиента видят одного атакующего');
  ok(gA.trump === gB.trump, 'козырь совпадает');
  ok(gA.you.id !== gB.you.id, 'каждый видит себя');

  const attackerId = gA.attackerId;
  const attacker = attackerId === 'u_alice' ? A : B;
  const defender = attackerId === 'u_alice' ? B : A;
  const attClientState = attackerId === 'u_alice' ? gA : gB;

  const card = attClientState.you.hand[0];
  attacker.clear();
  attacker.send({ t: 'act', action: 'attack', cardId: card.id });
  const afterAttack = await attacker.waitFor(m => m.t === 'room' && m.game?.table?.length === 1);
  ok(afterAttack.game.table.length === 1, 'карта легла на стол');
  ok(afterAttack.game.you.hand.length === 5, 'карта ушла из руки');

  const defAfter = await defender.waitFor(m => m.t === 'room' && m.game?.table?.length === 1);
  ok(defAfter.game.table.length === 1, 'защищающийся видит карту на столе');
  ok(defAfter.game.players.find(p => p.id === attackerId).count === 5, 'счётчик карт соперника обновился');

  // ---------- нелегальный ход ----------
  console.log('\nПроверка нелегальных действий');
  defender.clear();
  defender.send({ t: 'act', action: 'attack', cardId: defAfter.game.you.hand[0].id });
  const errTurn = await defender.waitFor(m => m.t === 'error');
  ok(!!errTurn, 'защищающийся не может атаковать', errTurn.why);

  // ---------- возврат карты ----------
  console.log('\nВозврат карты');
  attacker.clear();
  attacker.send({ t: 'act', action: 'recall', cardId: card.id });
  const afterRecall = await attacker.waitFor(m => m.t === 'room' && m.game?.table?.length === 0);
  ok(afterRecall.game.table.length === 0, 'карта вернулась со стола');
  ok(afterRecall.game.you.recallsLeft === 4, 'осталось 4 возврата', String(afterRecall.game.you.recallsLeft));

  // ---------- взятие ----------
  attacker.clear();
  attacker.send({ t: 'act', action: 'attack', cardId: card.id });
  await attacker.waitFor(m => m.t === 'room' && m.game?.table?.length === 1);
  defender.send({ t: 'act', action: 'take' });
  const inTake = await defender.waitFor(m => m.t === 'room' && m.game?.takePhase?.active);
  ok(!!inTake.game.takePhase, 'защитник сказал «беру» — началась фаза подкидывания');

  // атакующий пасует
  attacker.send({ t: 'act', action: 'passPodkid' });
  const allPassed = await defender.waitFor(m => m.t === 'room' && m.game?.takePhase?.allPassed);
  ok(allPassed.game.you.canConfirmTake, 'после паса защитник может забрать карты');

  // защитник забирает
  defender.send({ t: 'act', action: 'confirmTake' });
  const afterTake = await defender.waitFor(m => m.t === 'room' && m.game?.phase !== 'take' && m.game?.you?.hand?.length >= 7);
  ok(afterTake.game.you.hand.length >= 7, 'защищающийся забрал карты', String(afterTake.game.you.hand.length));

  // ---------- доигрываем до конца ----------
  console.log('\nДоигрывание партии');
  const all = { u_alice: A, u_bob: B };
  let over = false;
  for (let i = 0; i < 900 && !over; i++) {
    let actedAny = false;
    for (const cid of Object.keys(all)) {
      const st = all[cid].last(m => m.t === 'room' && m.game)?.game;
      if (!st) continue;
      if (st.phase === 'over') { over = true; break; }

      // фаза «беру»: пасуют все кроме защитника, защитник забирает
      if (st.takePhase?.active) {
        if (st.you.isDefender) {
          if (st.you.canConfirmTake) { all[cid].send({ t: 'act', action: 'confirmTake' }); actedAny = true; }
        } else if (!st.you.passed) {
          all[cid].send({ t: 'act', action: 'passPodkid' }); actedAny = true;
        }
        continue;
      }
      if (st.attackerId !== cid && st.defenderId !== cid) continue;

      if (st.defenderId === cid) {
        const undef = st.table.filter(s => !s.defense);
        if (undef.length) {
          const slot = undef[0];
          const beat = st.you.hand.find(c => c.s === slot.attack.s
            ? c.r > slot.attack.r
            : (c.s === st.trump && slot.attack.s !== st.trump));
          if (beat) all[cid].send({ t: 'act', action: 'defend', cardId: beat.id });
          else all[cid].send({ t: 'act', action: 'take' });
          actedAny = true;
        }
      } else {
        const legalRank = new Set();
        for (const s of st.table) { legalRank.add(s.attack.r); if (s.defense) legalRank.add(s.defense.r); }
        const card = st.table.length === 0
          ? st.you.hand[0]
          : st.you.hand.find(c => legalRank.has(c.r));
        if (card && st.table.length < 6) {
          all[cid].send({ t: 'act', action: 'attack', cardId: card.id });
          actedAny = true;
        } else if (st.table.length && st.table.every(s => s.defense)) {
          all[cid].send({ t: 'act', action: 'endBout' });
          actedAny = true;
        }
      }
    }
    await sleep(22);
    const stA = A.last(m => m.t === 'room' && m.game)?.game;
    if (stA?.phase === 'over') over = true;
    if (!actedAny && !over) await sleep(60);
  }
  const finalA = A.last(m => m.t === 'room' && m.game)?.game;
  ok(!!finalA, 'состояние получено');
  ok(finalA.phase === 'over', 'партия дошла до конца', finalA?.phase);
  if (finalA.phase === 'over') {
    ok(Array.isArray(finalA.losers) && finalA.losers.length >= 1, 'определён проигравший', JSON.stringify(finalA.losers));
  }

  // ---------- профиль обновился ----------
  console.log('\nСтатистика');
  A.clear();
  A.send({ t: 'auth', devId: 'u_alice', name: 'Алиса' });
  const reAuth = await A.waitFor(m => m.t === 'auth_ok');
  ok(reAuth.profile.games >= 1, 'партия записана в профиль', JSON.stringify(reAuth.profile));

  A.close(); B.close();
} catch (e) {
  fail++;
  console.log('\n✗ ИСКЛЮЧЕНИЕ: ' + e.message);
} finally {
  srv.kill();
  await sleep(200);
  console.log(`\n──────────────\nПройдено: ${pass}, провалено: ${fail}`);
  process.exit(fail ? 1 : 0);
}
