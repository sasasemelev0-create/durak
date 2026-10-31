// Проверка передачи хода и правил на двоих
import { Durak } from '../server/engine.js';
import { beats } from '../server/cards.js';

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' — ' + e : ''))); };

function play(seed, n = 2) {
  const g = new Durak({ players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), deckSize: 36, seed });
  const attackers = [];
  let steps = 0;
  while (g.phase !== 'over' && steps++ < 500) {
    attackers.push(g.players[g.attackerIdx].id);
    if (g.podkidPending) { const w = g.waitingPodkidPassers(); if (w.length) g.passPodkidAfterBito(w[0].id); continue; }
    if (g.takePending) {
      const w = g.waitingPassers();
      if (w.length) { g.passPodkid(w[0].id); continue; }
      g.confirmTake(g.players[g.takePending.defenderIdx].id); continue;
    }
    if (g.phase === 'defend') {
      const d = g.players[g.defenderIdx], u = g.table.find(s => !s.defense);
      if (!u) { g.endBout(g.players[g.attackerIdx].id); continue; }
      const b = d.hand.find(c => beats(c, u.attack, g.trump));
      if (b) { g.defend(d.id, b.id, u.attack.id); continue; }
      g.takeCards(d.id); continue;
    }
    const a = g.players[g.attackerIdx], c = a.hand[0];
    if (!c) break;
    if (!g.attack(a.id, c.id).ok) break;
    if (g.phase === 'defend' && g.table.every(s => s.defense)) g.endBout(a.id);
  }
  return { g, attackers };
}

console.log('\n1. Передача хода на двоих');
{
  let oneAttacker = 0, stuck = 0;
  for (let s = 1; s <= 60; s++) {
    const { g, attackers } = play(s, 2);
    if (new Set(attackers).size < 2) oneAttacker++;
    if (g.phase !== 'over') stuck++;
  }
  ok(oneAttacker === 0, 'атакуют оба игрока во всех 60 партиях', `${oneAttacker} с одним`);
  ok(stuck === 0, 'все 60 партий доигрываются', `${stuck} зависло`);
}

console.log('\n2. На двоих «Бито» → карты сразу в отбой');
{
  const g = new Durak({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], deckSize: 36, seed: 7 });
  const A = g.players[g.attackerIdx], D = g.players[g.defenderIdx];
  g.attack(A.id, A.hand[0].id);
  const slot = g.table.find(s => !s.defense);
  const b = D.hand.find(c => beats(c, slot.attack, g.trump));
  if (b) g.defend(D.id, b.id, slot.attack.id);
  const before = g.discard.length;
  const r = g.endBout(A.id);
  ok(r.ok && r.discarded, '«Бито» закрывает кон');
  ok(!g.podkidPending, 'окна паса нет');
  ok(g.discard.length > before, 'карты ушли в отбой');
  ok(g.players[g.attackerIdx].id === D.id, 'атакующим стал бывший защитник');
}

console.log('\n3. На двоих «Беру» → забирает сразу, без паса');
{
  const g = new Durak({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], deckSize: 36, seed: 9 });
  const A = g.players[g.attackerIdx], D = g.players[g.defenderIdx];
  g.attack(A.id, A.hand[0].id);
  g.takeCards(D.id);
  ok(g.canConfirmTake(D.id), 'кнопка «Забрать» активна сразу');
  const cardsBefore = D.hand.length;
  ok(g.confirmTake(D.id).ok, 'забрал без ожидания паса');
  ok(D.hand.length > cardsBefore, 'карты у него');
}

console.log('\n4. На троих пас нужен');
{
  const g = new Durak({ players: ['a','b','c'].map(i => ({ id: i, name: i })), deckSize: 36, seed: 11 });
  const A = g.players[g.attackerIdx], D = g.players[g.defenderIdx];
  g.attack(A.id, A.hand[0].id);
  g.takeCards(D.id);
  ok(!g.canConfirmTake(D.id), 'на троих сразу забрать нельзя');
  const others = g.players.filter(p => p.idx !== g.defenderIdx && !p.out);
  for (const o of others) g.passPodkid(o.id);
  ok(g.canConfirmTake(D.id), 'после пасов всех — можно');
}

console.log('\n5. Подкидывать нельзя, если у защитника мало карт');
{
  const g = new Durak({ players: ['a','b','c'].map(i => ({ id: i, name: i })), deckSize: 36, seed: 13 });
  const D = g.players[g.defenderIdx];
  D.hand = D.hand.slice(0, 1);   // у защитника 1 карта
  const attacker = g.players[g.attackerIdx];
  g.attack(attacker.id, attacker.hand[0].id);
  const other = g.players.find(p => p.idx !== g.attackerIdx && p.idx !== g.defenderIdx);
  const sameRank = other.hand.find(c => c.r === g.table[0].attack.r);
  if (sameRank) {
    const r = g.checkPodkid(other.idx, sameRank);
    ok(r.ok === false, 'вторую карту подкинуть нельзя — у защитника одна', r.why);
  } else ok(true, 'пропуск: нет карты того же ранга');
}

console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail ? 1 : 0);
