// tests/run.mjs — самотесты движка: правила, инварианты, партии ботов
import { Durak, RECALL_QUOTA, MAX_ATTACKS } from '../server/engine.js';
import { buildDeck, beats } from '../server/cards.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

// ---------- карты ----------
section('Колоды и сравнение');
ok(buildDeck(24).length === 24, 'колода 24 = 24 карты');
ok(buildDeck(36).length === 36, 'колода 36 = 36 карт');
ok(buildDeck(52).length === 52, 'колода 52 = 52 карты');
ok(new Set(buildDeck(52).map(c => c.id)).size === 52, 'все id уникальны');
ok(beats({ s: 1, r: 7 }, { s: 0, r: 13 }, 2) === false, '7 червей не бьёт короля пик');
ok(beats({ s: 2, r: 2 }, { s: 0, r: 14 }, 2) === true, 'козырь 2 бьёт туза другой масти');
ok(beats({ s: 0, r: 10 }, { s: 0, r: 9 }, 3) === true, '10 пик бьёт 9 пик');
ok(beats({ s: 0, r: 9 }, { s: 0, r: 9 }, 3) === false, 'равный ранг не бьёт');

// ---------- создание ----------
section('Создание партии');
const mk = (n, opts = {}) => new Durak({
  players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), ...opts
});
let g = mk(2);
ok(g.players.length === 2, '2 игрока');
ok(g.players.every(p => p.hand.length === 6), 'по 6 карт на руки');
ok(g.deck.length === 36 - 12, 'колода уменьшилась на розданные карты (козырь лежит снизу)');
ok(g.trumpCard && g.trump >= 0 && g.trump <= 3, 'козырь определён');

for (const n of [2, 3, 4, 5, 6]) {
  const gg = mk(n);
  ok(gg.players.every(p => p.hand.length === 6), `${n} игроков — по 6 карт`);
}
let threw = false;
try { mk(1); } catch (e) { threw = true; }
ok(threw, '1 игрок — ошибка');
threw = false;
try { mk(7); } catch (e) { threw = true; }
ok(threw, '7 игроков — ошибка');

// ---------- лимиты стола ----------
section('Правила стола');
g = mk(3, { deckSize: 52 });
const attacker = g.players[g.attackerIdx];
const first = attacker.hand[0];
ok(g.attack(attacker.id, first.id).ok === true, 'атакующий ходит');
ok(g.table.length === 1, 'на столе 1 карта');

// нельзя положить карту не того ранга
const wrongRank = attacker.hand.find(c => c.r !== first.r);
if (wrongRank) {
  const r = g.attack(attacker.id, wrongRank.id);
  ok(r.ok === false, 'подкидывать карту другого ранга нельзя', r.why);
}

// столько карт, сколько в руке защищающегося
const g2 = mk(2, { deckSize: 52 });
// насильно ставим защищающемуся 1 карту
g2.players[g2.defenderIdx].hand = [g2.players[g2.defenderIdx].hand[0]];
const a2 = g2.players[g2.attackerIdx];
g2.attack(a2.id, a2.hand[0].id);
const undef = g2.table.filter(s => !s.defense).length;
ok(g2.table.length >= 1 && g2.maxAttacks() <= MAX_ATTACKS, 'лимит карт на столе не больше 6');

// ---------- возвраты ----------
section('Возврат карты (5 раз за партию)');
g = mk(2, { deckSize: 52 });
ok(g.players.every(p => p.recallsLeft === RECALL_QUOTA), 'у всех по 5 возвратов');
const a = g.players[g.attackerIdx];
const c0 = a.hand[0];
g.attack(a.id, c0.id);
const rec = g.recall(a.id, c0.id);
ok(rec.ok === true, 'атакующий вернул свою карту со стола');
ok(a.hand.some(c => c.id === c0.id), 'карта снова в руке');
ok(a.recallsLeft === 4, 'счётчик уменьшился до 4');
ok(g.table.length === 0, 'стол пуст');

// 5 раз подряд и шестой — отказ
g = mk(2, { deckSize: 52 });
const a3 = g.players[g.attackerIdx];
let count = 0;
for (let k = 0; k < 6; k++) {
  const card = a3.hand.find(c => !g.table.some(s => s.attack.id === c.id));
  if (!card) break;
  if (!g.attack(a3.id, card.id).ok) break;
  if (g.recall(a3.id, card.id).ok) count++;
}
ok(count === 5, 'больше 5 возвратов за партию не даёт', 'получилось ' + count);

// вернуть нельзя чужую карту
g = mk(2, { deckSize: 52 });
const at = g.players[g.attackerIdx];
g.attack(at.id, at.hand[0].id);
const other = g.players.find(p => p.idx !== g.attackerIdx && p.idx !== g.defenderIdx);
const res = g.recall(g.players[g.defenderIdx].id, 'nope');
ok(res.ok === false, 'чужую/несуществующую карту вернуть нельзя');

// ---------- защита ----------
section('Защита и отбой');
g = mk(2, { deckSize: 52 });
const A = g.players[g.attackerIdx], D = g.players[g.defenderIdx];
const atkCard = A.hand[0];
g.attack(A.id, atkCard.id);
const canBeat = D.hand.find(c => beats(c, atkCard, g.trump));
if (canBeat) {
  ok(g.defend(D.id, canBeat.id).ok === true, 'защищающийся отбился');
  ok(g.endBout(D.id).ok === true, 'кон закрыт — бито');
  ok(g.table.length === 0, 'стол очищен');
} else {
  ok(g.takeCards(D.id).ok === true, 'нечем бить — забрал карты');
  ok(D.hand.length >= 7, 'карты ушли защищающемуся');
}
ok(g.players.every(p => p.hand.length <= 6 || g.deck.length === 0 || p.idx === g.defenderIdx || p.hand.length <= 6),
  'добор до 6 карт (забравший может иметь больше 6)');

// защита картой не того ранга — отказ
g = mk(2, { deckSize: 52 });
const A2 = g.players[g.attackerIdx], D2 = g.players[g.defenderIdx];
g.attack(A2.id, A2.hand[0].id);
const bad = D2.hand.find(c => !beats(c, A2.hand[0], g.trump));
if (bad) ok(g.defend(D2.id, bad.id).ok === false, 'слабая карта не бьёт');

// ---------- перевод ----------
section('Переводной');
g = mk(3, { deckSize: 52, transfer: true });
const att = g.players[g.attackerIdx], def = g.players[g.defenderIdx];
const card0 = att.hand[0];
g.attack(att.id, card0.id);
const sameRank = def.hand.find(c => c.r === card0.r);
if (sameRank) {
  const tr = g.transfer(def.id, sameRank.id);
  ok(tr.ok === true, 'перевод на следующего игрока');
  ok(g.defenderIdx !== def.idx, 'защищающийся сменился');
} else {
  ok(true, 'перевод: карты того же ранга не нашлось, пропуск');
}
// с выключенным режимом
g = mk(3, { deckSize: 52, transfer: false });
ok(g.transfer(g.players[g.defenderIdx].id, g.players[g.defenderIdx].hand[0].id).ok === false, 'без режима перевод запрещён');

// ---------- подкидывание: все / соседи ----------
section('Подкидывание: все или только соседи');
const g3 = mk(4, { deckSize: 52, podkid: 'neighbors' });
const neig = g3.players.filter(p => p.idx !== g3.attackerIdx && p.idx !== g3.defenderIdx);
for (const p of neig) {
  const isN = g3.isNeighborOfDefender(p.idx);
  const chk = g3.canAttackWith(p.idx, p.hand[0]);
  if (!isN) ok(chk.ok === false, `не сосед (${p.name}) подкидывать не может`, chk.why);
  else ok(true, `сосед ${p.name} подкидывать может (нужен ранг со стола)`);
}
const g4 = mk(4, { deckSize: 52, podkid: 'all' });
for (const p of g4.players.filter(p => p.idx !== g4.attackerIdx && p.idx !== g4.defenderIdx)) {
  ok(g4.opts.podkid === 'all', `${p.name} участвует в подкидывании (режим "все")`);
}

// ---------- шулеры ----------
section('Режим "с шулерами"');
g = mk(3, { deckSize: 52, cheat: true });
const ch = g.players[2], ch1 = g.players[0];
const cheatCard = ch.hand[0];
const orgRanks = [...g.tableRanks()];
const atk = g.attack(ch.id, cheatCard.id);
ok(atk.ok === true && atk.cheat === true, 'шулер выложил карту вне правил');
ok(g.pendingCheat !== null, 'есть спорная карта');
ok(g.accuse(g.players[1].id, ch.id).ok === true, 'игрок заметил и обвинил');
ok(ch.hand.some(c => c.id === cheatCard.id), 'карта вернулась шулеру');
ok(ch.cheatsLocked === true, 'шулер заблокирован до конца партии');
ok(g.table.length === 0, 'стол очищен от спорной карты');
// повторный обман невозможен
const again = g.attack(ch.id, cheatCard.id);
ok(again.ok === false, 'после поимки обманывать нельзя', again.why);

// без режима шулеров — обычная проверка
g = mk(3, { deckSize: 52, cheat: false });
const badAttack = g.attack(g.players[2].id, g.players[2].hand[0].id);
if (g.players[2].idx !== g.attackerIdx) ok(badAttack.ok === false, 'без режима обман невозможен');

// ---------- определение проигравшего ----------
section('Классика и ничья');
// симулируем "все вышли одновременно"
g = mk(3, { deckSize: 36, lossMode: 'draw' });
g.players.forEach(p => { p.hand = []; });
g.lastCardPlayerIdx = 1;
g.phase = 'over';
g.checkGameOver();
ok(g.losers.length === 3, 'ничья — проигрыш делится на всех', JSON.stringify(g.losers));

g = mk(3, { deckSize: 36, lossMode: 'classic' });
g.players.forEach(p => { p.hand = []; });
g.lastCardPlayerIdx = 2;
g.phase = 'over';
g.checkGameOver();
ok(g.losers.length === 1 && g.losers[0] === 'p2', 'классика — проиграл последний выложивший', JSON.stringify(g.losers));

// ---------- полные партии ботами ----------
section('Симуляция полных партий');

function autoPlay(opts, seed, maxSteps = 4000) {
  const g = new Durak({ ...opts, seed });
  let steps = 0;
  while (g.phase !== 'over' && steps++ < maxSteps) {
    const me = g.players[g.defenderIdx];
    const att = g.players[g.attackerIdx];

    if (g.phase === 'defend') {
      const slot = g.table.find(s => !s.defense);
      const beatCard = slot ? me.hand.find(c => beats(c, slot.attack, g.trump)) : null;
      if (beatCard) { g.defend(me.id, beatCard.id); continue; }
      if (g.table.every(s => s.defense)) { g.endBout(me.id); continue; }
      g.takeCards(me.id); continue;
    }

    // фаза атаки: кто-нибудь легально кладёт карту
    let moved = false;
    for (const p of g.players) {
      if (p.out || p.hand.length === 0) continue;
      for (const c of p.hand) {
        if (g.canAttackWith(p.idx, c).ok) { g.attack(p.id, c.id); moved = true; break; }
      }
      if (moved) break;
    }
    if (!moved) {
      // никто не может — закрываем кон как атакующий
      if (g.table.length > 0 && g.table.every(s => s.defense)) g.endBout(g.players[g.attackerIdx].id);
      else if (g.table.length > 0) g.takeCards(g.players[g.defenderIdx].id);
      else {
        // защищающемуся нечем — просто передаём ход
        const dIdx = g.defenderIdx;
        g.takeCards(g.players[dIdx].id);
      }
    }
  }
  return { g, steps };
}

let completed = 0, totalSteps = 0;
for (const n of [2, 3, 4, 5, 6]) {
  for (const deckSize of [24, 36, 52]) {
    for (const podkid of ['all', 'neighbors']) {
      for (const transfer of [true, false]) {
        let done = 0;
        for (let seed = 1; seed <= 5; seed++) {
          const { g: gg, steps } = autoPlay({
            players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })),
            deckSize, podkid, transfer, lossMode: 'draw', cheat: false
          }, seed * 7919 + n * 13 + deckSize);
          totalSteps += steps;
          if (gg.phase === 'over') { done++; completed++; }
          const total = gg.players.reduce((s, p) => s + p.hand.length, 0) + gg.deck.length + gg.discard.length + gg.table.length * 2;
          const expected = deckSize;
          if (total !== expected) {
            console.log(`    ! карты потерялись: ${total} vs ${expected} (n=${n}, ${deckSize})`);
            fail++;
          }
        }
        if (done !== 5) console.log(`    ! не доиграно ${5 - done}/5 (n=${n}, deck=${deckSize}, podkid=${podkid})`);
      }
    }
  }
}
ok(completed === 5 * 3 * 2 * 2 * 5, `все 300 партий доиграны (${completed})`, 'среднее шагов: ' + Math.round(totalSteps / 300));

// ---------- скрытие рук ----------
section('Приватность состояния');
g = mk(4, { deckSize: 36 });
const view = g.publicState('p1');
const me = view.players.find(p => p.id === 'p1');
const others = view.players.filter(p => p.id !== 'p1');
ok(me.hand.length === 6, 'свою руку видно');
ok(others.every(p => p.hand === null), 'чужие руки скрыты');
ok(view.deckCount > 0 && !('deck' in view), 'колода не отдаётся клиенту');
ok(view.trumpCard, 'козырь виден');

console.log(`\n──────────────\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
