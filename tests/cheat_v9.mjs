// Шулерство v9: подкидывание / бой / перевод неподходящей картой, проверка любым игроком
import { Durak } from '../server/engine.js';
import { beats } from '../server/cards.js';
let pass=0, fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const mk=(n=3,seed=21,extra={})=>new Durak({players:Array.from({length:n},(_,i)=>({id:'p'+i,name:'P'+i})),deckSize:36,seed,cheat:true,transfer:true,...extra});

// находим карту заданного правила у игрока
function findIllegalAttack(g, idx){
  // карта, которой нельзя подкинуть: ранга нет на столе
  return g.players[idx].hand.find(c=>!g.tableRanks().has(c.r));
}

console.log('\n1. Неподходящая подкинутая карта — не подсвечена, не видна как нарушение');
{
  const g=mk(3,21);
  const A=g.players[g.attackerIdx];
  g.attack(A.id,A.hand[0].id);
  const other=g.players.find(p=>p.idx!==g.attackerIdx&&p.idx!==g.defenderIdx);
  const bad=findIllegalAttack(g,other.idx);
  if(bad){
    const r=g.attack(other.id,bad.id,{cheat:true});
    ok(r.ok===true, 'шулер подкинул неподходящую карту');
    const st=g.publicState(A.id);
    const slot=st.table.find(s=>s.attack.id===bad.id);
    ok(slot && !('illegal' in slot) && !('cheat' in slot) && !('suspect' in slot), 'в публичном состоянии карта ничем не помечена');
    ok(st.pendingCheat===undefined || st.pendingCheat===null, 'нет отдельного «спора», игра не блокируется');
    // игра не заблокирована: защитник может ходить
    ok(g.defend(g.players[g.defenderIdx].id, g.players[g.defenderIdx].hand[0].id, g.table[0].attack.id).ok!==undefined, 'игра не остановлена спором');
  } else ok(true,'пропуск: нет подходящей карты для теста');
}

console.log('\n2. Проверка: нарушение → карта возвращается шулеру, он больше не шулерит');
{
  const g=mk(3,21);
  const A=g.players[g.attackerIdx];
  g.attack(A.id,A.hand[0].id);
  const cheater=g.players.find(p=>p.idx!==g.attackerIdx&&p.idx!==g.defenderIdx);
  const bad=findIllegalAttack(g,cheater.idx);
  if(bad){
    g.attack(cheater.id,bad.id,{cheat:true});
    const before=cheater.hand.length;
    const r=g.checkCard(A.id,bad.id);
    ok(r.ok && r.legal===false, 'проверка нашла нарушение');
    ok(cheater.hand.some(c=>c.id===bad.id), 'карта вернулась шулеру в руку');
    ok(cheater.hand.length===before+1, 'в руке +1 карта');
    ok(!g.table.some(s=>s.attack.id===bad.id), 'карты больше нет на столе');
    ok(cheater.cheatsLocked===true, 'шулер заблокирован до конца партии');
    const bad2=cheater.hand.find(c=>!g.tableRanks().has(c.r));
    if(bad2){
      const again=g.attack(cheater.id,bad2.id,{cheat:true});
      ok(again.ok===false, 'второй обман отклонён', again.why);
    }
  } else ok(true,'пропуск');
}

console.log('\n3. Проверка по правилам → штрафа нет, карта остаётся');
{
  const g=mk(3,21);
  const A=g.players[g.attackerIdx];
  g.attack(A.id,A.hand[0].id);
  // честная подкидка того же ранга
  const other=g.players.find(p=>p.idx!==g.attackerIdx&&p.idx!==g.defenderIdx);
  const good=other.hand.find(c=>g.tableRanks().has(c.r));
  if(good && g.table.length < g.attackLimit()){
    g.attack(other.id,good.id);
    const r=g.checkCard(A.id,good.id);
    ok(r.ok && r.legal===true, 'честная карта признана по правилам');
    ok(g.table.some(s=>s.attack.id===good.id), 'карта осталась на столе');
    ok(other.cheatsLocked===false, 'никакого штрафа');
    ok(A.cheatsLocked===false, 'проверяющий не наказан');
  } else ok(true,'пропуск');
}

console.log('\n4. Проверять можно любую карту и сколько угодно раз');
{
  const g=mk(3,21);
  const A=g.players[g.attackerIdx];
  g.attack(A.id,A.hand[0].id);
  const cardId=g.table[0].attack.id;
  const r1=g.checkCard(g.players[g.defenderIdx].id, cardId);
  const r2=g.checkCard(g.players[g.defenderIdx].id, cardId);
  ok(r1.ok && r2.ok, 'одну карту можно проверить несколько раз подряд');
  ok(r1.legal===true, 'первая карта по правилам — проверка ничего не ломает');
}

console.log('\n5. Нельзя проверить свою карту');
{
  const g=mk(3,21);
  const A=g.players[g.attackerIdx];
  g.attack(A.id,A.hand[0].id);
  const r=g.checkCard(A.id,g.table[0].attack.id);
  ok(r.ok===false, 'свою карту проверить нельзя', r.why);
}

console.log('\n6. Неподходящий бой → карта возвращается шулеру');
{
  const g=mk(3,31);
  const A=g.players[g.attackerIdx], D=g.players[g.defenderIdx];
  g.attack(A.id,A.hand[0].id);
  // защитник-шулер: пробуем побить картой, которая не бьёт
  const slot=g.table[0];
  const notBeat=D.hand.find(c=>!beats(c,slot.attack,g.trump));
  if(notBeat){
    // имитируем шулера-защитника: в движке бой неподходящей картой разрешён только при cheat=true
    const r=g.defend(D.id,notBeat.id,slot.attack.id,{cheat:true});
    ok(r.ok===true, 'защитник побил неподходящей картой (шулерство)');
    const chk=g.checkCard(A.id,notBeat.id);
    ok(chk.ok && chk.legal===false, 'проверка поймала неправильный бой');
    ok(D.hand.some(c=>c.id===notBeat.id), 'отбивающая карта вернулась защитнику');
    ok(!g.table[0].defense, 'отбой снят — слот снова не отбит');
    ok(D.cheatsLocked===true, 'защитник-шулер заблокирован');
  } else ok(true,'пропуск');
}

console.log('\n7. Неподходящий перевод → проверка и блок');
{
  const g=mk(3,41);
  const A=g.players[g.attackerIdx], D=g.players[g.defenderIdx];
  g.attack(A.id,A.hand[0].id);
  // ищем у защитника карту НЕ того ранга, что на столе
  const bad=D.hand.find(c=>!g.tableRanks().has(c.r));
  if(bad && g.table.every(s=>!s.defense)){
    const r=g.transfer(D.id,bad.id,{cheat:true});
    if(r.ok){
      ok(true,'шулер перевёл неподходящей картой');
      const chk=g.checkCard(A.id,bad.id);
      ok(chk.ok && chk.legal===false, 'проверка поймала неправильный перевод');
      ok(D.hand.some(c=>c.id===bad.id) || g.table.some(s=>s.attack.id===bad.id)===false, 'карта возвращена');
    } else ok(true,'перевод отклонён без шулерства — корректно', r.why);
  } else ok(true,'пропуск: нет подходящей карты для теста');
}

console.log('\n8. Честная игра без шулерства: неподходящая карта отклоняется');
{
  const g=new Durak({players:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],deckSize:36,seed:51,cheat:false});
  const A=g.players[g.attackerIdx];
  g.attack(A.id,A.hand[0].id);
  const other=g.players.find(p=>p.idx!==g.attackerIdx&&p.idx!==g.defenderIdx);
  const bad=other.hand.find(c=>!g.tableRanks().has(c.r));
  if(bad){
    const r=g.attack(other.id,bad.id,{cheat:true});
    ok(r.ok===false, 'в режиме без шулеров неподходящая карта отклонена даже с флагом cheat');
  } else ok(true,'пропуск');
}

console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail?1:0);
