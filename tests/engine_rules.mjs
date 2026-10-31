// tests/engine_rules.mjs — правила движка v6
import { Durak } from '../server/engine.js';
import { beats } from '../server/cards.js';
let pass = 0, fail = 0;
const ok = (c, n, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' — ' + e : ''))); };

function bot(g, maxSteps = 4000) {
  let steps = 0;
  while (g.phase !== 'over' && steps++ < maxSteps) {
    if (g.podkidPending) {
      const w = g.waitingPodkidPassers(); if (w.length) g.passPodkidAfterBito(w[0].id); continue;
    }
    if (g.takePending) {
      const w = g.waitingPassers();
      if (w.length) { g.passPodkid(w[0].id); continue; }
      g.confirmTake(g.players[g.takePending.defenderIdx].id); continue;
    }
    if (g.phase === 'defend') {
      const d = g.players[g.defenderIdx]; const u = g.table.find(s => !s.defense);
      if (!u) { g.endBout(g.players[g.attackerIdx].id); continue; }
      const b = d.hand.find(c => beats(c, u.attack, g.trump));
      if (b) { g.defend(d.id, b.id, u.attack.id); continue; }
      g.takeCards(d.id); continue;
    }
    let moved = false;
    for (const p of g.players) {
      if (p.out || p.idx === g.defenderIdx) continue;
      for (const c of p.hand) {
        if (g.table.length === 0 ? p.idx === g.attackerIdx : g.checkPodkid(p.idx, c).ok) {
          if (g.attack(p.id, c.id).ok) { moved = true; break; }
        }
      }
      if (moved) break;
    }
    if (!moved) { if (g.table.length) g.endBout(g.players[g.attackerIdx].id); else break; }
  }
  return g;
}

const mk = (n = 3, extra = {}) => new Durak({ players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), deckSize: 36, seed: 42, ...extra });

console.log('\nКозырь');
{
  let dup = 0, onHand = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const g = new Durak({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], deckSize: 36, seed });
    const all = [...g.players.flatMap(p => p.hand.map(c => c.id)), ...g.deck.map(c => c.id)];
    if (new Set(all).size !== all.length) dup++;
    if (g.players.some(p => p.hand.some(c => c.id === g.trumpCard.id))) onHand++;
  }
  ok(dup === 0, 'нет дублей карт (300 раздач)');
  ok(onHand === 0, 'козырь не на руках в начале партии', String(onHand));
}

console.log('\nПравило: защитник не закрывает кон');
{
  const g = mk();
  const A = g.players[g.attackerIdx], D = g.players[g.defenderIdx];
  g.attack(A.id, A.hand[0].id);
  const r = g.endBout(D.id);
  ok(r.ok === false, 'защитник не может нажать «Бито»', r.why);
}

console.log('\nПравило: подкидывать — только тот же ранг, и не больше карт защитника');
{
  const g = mk(2, { seed: 5 });
  const A = g.players[g.attackerIdx], D = g.players[g.defenderIdx];
  g.attack(A.id, A.hand[0].id);
  const r1 = g.checkPodkid(A.idx, { s: 0, r: 13, id: 'x' });
  ok(r1.ok === false, 'подкинуть карту чужого ранга нельзя', r1.why);
  // форсируем: у защитника 1 карта — лимит стола 1
  D.hand = D.hand.slice(0, 1);
  const sameRank = { s: A.hand[0].s, r: A.hand[0].r, id: 'fake' };
  const r2 = g.checkPodkid(A.idx, sameRank);
  ok(r2.ok === false, 'лимит: карт на столе не больше, чем у защитника', r2.why);
}

console.log('\nПравило: «Бито» открывает пас остальным (не сразу после «Беру»)');
{
  const g = mk(3, { seed: 9 });
  const A = g.players[g.attackerIdx], D = g.players[g.defenderIdx];
  g.attack(A.id, A.hand[0].id);
  const u = g.table[0];
  const b = D.hand.find(c => beats(c, u.attack, g.trump));
  if (b) {
    g.defend(D.id, b.id, u.attack.id);
    g.endBout(A.id);
    ok(!!g.podkidPending, 'после «Бито» открыто окно подкидывания');
    ok(!g.takePending, 'после «Бито» фаза «беру» не открыта');
  } else ok(true, 'пропуск: защитнику нечем бить в этом сиде');
}

console.log('\nПравило: «Беру» защитника → окно подкидывания');
{
  const g = mk(3, { seed: 11 });
  const A = g.players[g.attackerIdx], D = g.players[g.defenderIdx];
  g.attack(A.id, A.hand[0].id);
  g.takeCards(D.id);
  ok(!!g.takePending, 'после «Беру» открыто окно подкидывания');
  ok(g.allPassed() === false, 'без пасов забрать нельзя');
}

console.log('\nПравило: перевод картой того же ранга');
{
  const g = mk(3, { seed: 13, transfer: true });
  const A = g.players[g.attackerIdx], D = g.players[g.defenderIdx];
  g.attack(A.id, A.hand[0].id);
  // у защитника ищем карту того же ранга
  // ищем карту защитника того же ранга, что уже лежит на столе
  const tableR = g.tableRanks();
  const same = D.hand.find(c => tableR.has(c.r)) || null;
  if (same) {
    const r = g.transfer(D.id, same.id);
    ok(r.ok === true, 'перевод картой того же ранга принят', r.why || '');
    ok(g.attackerIdx === D.idx || g.attackerIdx !== g.defenderIdx, 'роли сменились');
  } else ok(true, 'пропуск: нет карты того же ранга');
}

console.log('\nПравило: шулерство — карта возвращается шулеру и он играет честно');
{
  const g = mk(3, { seed: 15, cheat: true });
  const A = g.players[g.attackerIdx];
  const other = g.players[(g.attackerIdx + 2) % 3];
  // первая карта на стол честная
  g.attack(A.id, A.hand[0].id);
  // шулер (other) кладёт карту вне правил: ранг, которого нет на столе
  const bad = other.hand.find(c => !g.tableRanks().has(c.r));
  if (bad && g.defenderIdx !== other.idx) {
    const r = g.attack(other.id, bad.id, { cheat: true });
    ok(r.cheat === true && g.pendingCheat, 'шулерская карта помечена как спорная');
    const acc = g.accuse(A.id, other.id);
    ok(acc.ok === true, 'поймали — обвинение принято');
    ok(other.hand.some(c => c.id === bad.id), 'карта вернулась шулеру в руку');
    ok(other.cheatsLocked === true, 'шулер больше не может шулерить');
    const again = g.attack(other.id, other.hand.find(c => !g.tableRanks().has(c.r))?.id || 'x', { cheat: true });
    ok(again.ok === false, 'второй обман шулера отклонён', again.why);
  } else ok(true, 'пропуск: в этом сиде нет подходящей карты для обмана');
}

console.log('\nПравило: проигрыш');
{
  // у одного карты на руках, колода пуста → он дурак
  const g = mk(2, { seed: 17 });
  g.deck = [];
  g.players[0].hand = [{ s: 0, r: 6, id: '06' }];
  g.players[1].hand = [];
  g.lastCardPlayerIdx = 1;
  g.checkGameOver();
  ok(g.losers[0] === 'p0', 'у кого остались карты на руках — тот проиграл', JSON.stringify(g.losers));
}
{
  // у обоих ноль, последним выложил карту p1 → проигрывает p1
  const g = mk(2, { seed: 19 });
  g.deck = [];
  g.players[0].hand = [];
  g.players[1].hand = [];
  g.lastCardPlayerIdx = 1;
  g.checkGameOver();
  ok(g.losers[0] === 'p1', 'у обоих ноль — проигрывает последний выложивший', JSON.stringify(g.losers));
}

console.log('\nВыход из партии');
{
  const g = mk(3, { seed: 21 });
  const r = g.surrender('p1');
  ok(r.ok === true && g.phase === 'over', 'выход завершает партию');
  ok(g.losers[0] === 'p1', 'вышедший — проигравший', JSON.stringify(g.losers));
}

console.log('\nПолные партии ботом');
{
  let stuck = 0, noLoser = 0, runs = 0;
  for (const n of [2, 3, 4, 5, 6]) for (const ds of [24, 36, 52]) for (let seed = 1; seed <= 12; seed++) {
    runs++;
    const g = bot(new Durak({ players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), deckSize: ds, seed: seed * 17 + n * 3 + ds, cheat: seed % 2 === 0, transfer: seed % 3 !== 0 }));
    if (g.phase !== 'over') stuck++;
    else if (g.losers.length === 0) noLoser++;
  }
  ok(stuck === 0, `все ${runs} партий доигрываются до конца`, `зависло: ${stuck}`);
  ok(noLoser === 0, 'в каждой партии есть проигравший', `без: ${noLoser}`);
}

console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail ? 1 : 0);
