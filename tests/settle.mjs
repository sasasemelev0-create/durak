// Проверка расчёта ставок: ½, ¼, ⅛ по порядку выхода
import { Durak } from '../server/engine.js';

let pass=0, fail=0;
const ok=(c,n,e='')=>{ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:''))); };

// формула как в settleRoom: половина, четверть, восьмая, последний — остаток
function split(winnersOrder, pot){
  const weights=[]; let left=pot;
  for(let i=0;i<winnersOrder.length;i++){
    const isLast = i===winnersOrder.length-1;
    const share = isLast ? left : Math.floor(left/2);
    weights.push({id:winnersOrder[i], share});
    left -= share;
    if(left<=0) break;
  }
  return weights;
}

console.log('\nДележ по порядку выхода');
let r = split(['A','B'], 1000);
ok(r[0].share===500, 'двое: первый 500', String(r[0].share));
ok(r[1].share===500, 'двое: второй 500', String(r[1].share));

r = split(['A','B','C'], 1000);
ok(r[0].share===500, 'трое: первый 500 (половина)', String(r[0].share));
ok(r[1].share===250, 'трое: второй 250 (четверть)', String(r[1].share));
ok(r[2].share===250, 'трое: третий забирает остаток', String(r[2].share));
ok(r[0].share+r[1].share+r[2].share===1000, 'сумма ровно 1000', String(r[0].share+r[1].share+r[2].share));

r = split(['A','B','C','D','E'], 500);
ok(r.reduce((a,x)=>a+x.share,0)===500, 'пятеро: сумма ровно 500');
ok(r[0].share > r[1].share && r[1].share > r[2].share, 'доли убывают');
ok(r[0].share===250, 'пятеро: первый ровно половина', String(r[0].share));
ok(r[1].share===125, 'пятеро: второй четверть', String(r[1].share));

console.log('\nПорядок выхода из движка');
const g = new Durak({players:['a','b','c'].map(id=>({id,name:id.toUpperCase()})),deckSize:24,seed:5});
ok(Array.isArray(g.exitOrder), 'exitOrder есть');
ok(g.exitOrder.length===0, 'в начале пусто');
// имитируем выход
g.markOut(g.players[2]);
g.markOut(g.players[0]);
ok(g.exitOrder[0]==='c', 'первым записан c', JSON.stringify(g.exitOrder));
ok(g.exitOrder[1]==='a', 'вторым записан a', JSON.stringify(g.exitOrder));

console.log(`\n──────────────\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail?1:0);
