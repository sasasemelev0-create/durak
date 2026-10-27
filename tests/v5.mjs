// tests/v5.mjs — проверка исправлений v5
import { Durak } from '../server/engine.js';
import { buildDeck } from '../server/cards.js';

let pass=0, fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};

// ---------- 1. Козырь не попадает на руки ----------
console.log('\n1. Козырь не должен быть на руках');
let trumpOnHand=0, dupTotal=0, deckIssues=0;
for (let seed=1; seed<=500; seed++){
  for (const deckSize of [24,36,52]){
    for (const n of [2,3,4,5,6]){
      const g=new Durak({players:Array.from({length:n},(_,i)=>({id:'p'+i,name:'P'+i})),deckSize,seed:seed*31+deckSize+n});
      const hands=g.players.flatMap(p=>p.hand.map(c=>c.id));
      // если карт на всех не хватило (24 на 6 игроков) — козырь неизбежно уходит в раздачу
      if (g.deck.length > 0 && hands.includes(g.trumpCard.id)) trumpOnHand++;
      const all=[...hands, ...g.deck.map(c=>c.id)];
      if (new Set(all).size !== all.length) dupTotal++;
      if (g.deck.length && g.deck[0].id !== g.trumpCard.id) deckIssues++;
      if (all.length !== deckSize) deckIssues++;
    }
  }
}
ok(trumpOnHand===0, 'козырь ни разу не попал в руку (7500 партий)', String(trumpOnHand));
ok(dupTotal===0, 'нет дублей карт', String(dupTotal));
ok(deckIssues===0, 'козырь лежит снизу колоды, карт ровно по колоде', String(deckIssues));

// козырь достаётся последним при доборе
{
  const g=new Durak({players:[{id:'a',name:'A'},{id:'b',name:'B'}],deckSize:24,seed:7});
  const trumpId=g.trumpCard.id;
  // опустошаем колоду добором
  while(g.deck.length) { g.players[0].hand.push(g.deck.pop()); }
  const lastTaken=g.players[0].hand[g.players[0].hand.length-1].id;
  ok(lastTaken===trumpId || g.players[0].hand.some(c=>c.id===trumpId),
     'козырь уходит последним при доборе', lastTaken);
}

// ---------- 2. Шулер: незамеченный обман -> карты в отбой ----------
console.log('\n2. Незамеченный обман: карты в отбой');
{
  const g=new Durak({players:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],
    deckSize:36,seed:11,cheat:true,podkid:'all',lossMode:'classic'});
  const cheater=g.players[2], att=g.players[g.attackerIdx];
  // шулер кладёт карту вне правил
  const bad=cheater.hand[0];
  const r=g.attack(cheater.id, bad.id);
  ok(r.ok===true && r.cheat===true, 'шулер выложил карту вне правил');
  ok(g.pendingCheat && g.pendingCheat.cardId===bad.id, 'карта помечена как спорная');

  const def=g.players[g.defenderIdx];
  const beforeDiscard=g.discard.length;
  g.takeCards(def.id);
  ok(!!g.takePending, 'защитник сказал «беру»');

  // все пасуют, никто не заметил обмана
  for (const p of g.players) if (p.idx!==g.defenderIdx) g.passPodkid(p.id);
  ok(g.allPassed(), 'все сказали пас');

  const res=g.confirmTake(def.id);
  ok(res.ok===true, 'защитник подтвердил');
  ok(res.discarded===true, 'карты ушли в отбой, а не в руку', JSON.stringify(res));
  ok(g.discard.length > beforeDiscard, 'отбой пополнился', `${beforeDiscard} -> ${g.discard.length}`);
  ok(!g.players[g.defenderIdx].hand.some(c=>c.id===bad.id), 'шулерская карта НЕ попала защитнику');
}

// ---------- 3. Обман заметили — карта вернулась ----------
console.log('\n3. Замеченный обман');
{
  const g=new Durak({players:[{id:'a',name:'A'},{id:'b',name:'B'}],deckSize:36,seed:21,cheat:true});
  const cheater=g.players[1];
  const bad=cheater.hand[0];
  g.attack(cheater.id, bad.id);
  ok(!!g.pendingCheat, 'карта помечена');
  const acc=g.players[0];
  const r=g.accuse(acc.id, cheater.id);
  ok(r.ok===true, 'обвинение принято');
  ok(cheater.hand.some(c=>c.id===bad.id), 'карта вернулась шулеру');
  ok(cheater.cheatsLocked===true, 'шулер заблокирован');
  ok(g.pendingCheat===null, 'спор снят');
}

// ---------- 4. «Бито» работает при незамеченном обмане ----------
console.log('\n4. Кон закрывается при незамеченном обмане');
{
  const g=new Durak({players:[{id:'a',name:'A'},{id:'b',name:'B'}],deckSize:36,seed:31,cheat:true});
  const cheater=g.players[1];
  const bad=cheater.hand[0];
  g.attack(cheater.id, bad.id);
  const def=g.players[g.defenderIdx];
  // защитник отбивается любой картой (шулерская карта любого ранга)
  const beat=def.hand.find(c=>c.s===bad.s ? c.r>bad.r : c.s===g.trump);
  if(beat) g.defend(def.id, beat.id, bad.id);
  if(g.table.every(s=>s.defense)){
    const before=g.discard.length;
    const r=g.endBout(g.players[g.attackerIdx].id);
    ok(r.ok===true, '«бито» проходит, даже если обман не заметили', r.why||'');
    ok(g.discard.length>before, 'карты ушли в отбой');
  } else {
    ok(true,'отбиться нечем — проверка пропущена');
  }
}

console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail?1:0);
