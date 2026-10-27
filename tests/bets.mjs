// Проверка схемы выплат: первый вышел — половина банка, второй — четверть...
import { Durak } from '../server/engine.js';

let pass=0, fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};

// эмулируем settleRoom без сервера
function settle(bet, players, exitOrder, losers) {
  const pot = bet * losers.length;
  const winners = players.filter(id=>!losers.includes(id));
  const exited = exitOrder.filter(id=>!losers.includes(id));
  let weights;
  if (exited.length) {
    weights = exited.map((id,i)=>({id,w:1/Math.pow(2,i+1)}));
    const missing = winners.filter(id=>!exited.includes(id));
    const lastW = weights.length ? weights[weights.length-1].w/2 : 1;
    for (const id of missing) weights.push({id,w:lastW});
  } else {
    weights = winners.map(id=>({id,w:1}));
  }
  const totalW = weights.reduce((s,x)=>s+x.w,0)||1;
  let dist=0;
  for (const w of weights){ w.share=Math.floor((w.w/totalW)*pot); dist+=w.share; }
  const rest = pot-dist;
  if (rest>0 && weights.length) weights[0].share += rest;
  const res={};
  for (const id of players) {
    res[id] = losers.includes(id) ? -bet : (weights.find(x=>x.id===id)?.share||0);
  }
  return res;
}

console.log('\nДвое игроков, проиграл B');
let r = settle(100, ['A','B'], ['A'], ['B']);
ok(r.A === 100, 'победитель получает весь банк (100)', 'A='+r.A);
ok(r.B === -100, 'проигравший теряет ставку', 'B='+r.B);

console.log('\nТрое: первым вышел A, вторым B, проиграл C');
r = settle(100, ['A','B','C'], ['A','B'], ['C']);
// банк 100, A: 1/2 -> 50, B: 1/4 -> 25, остаток 25 идёт первому
ok(r.A === 75, 'первый вышедший забирает половину + остаток (75)', 'A='+r.A);
ok(r.B === 25, 'второй вышедший забирает четверть (25)', 'B='+r.B);
ok(r.C === -100, 'проигравший отдал ставку', 'C='+r.C);
ok(r.A + r.B === 100, 'сумма выплат = банк', `${r.A}+${r.B}`);

console.log('\nЧетверо: A, B, C вышли, D проиграл');
r = settle(100, ['A','B','C','D'], ['A','B','C'], ['D']);
const total = r.A+r.B+r.C;
ok(total === 100, 'сумма долей = банк', `${r.A}+${r.B}+${r.C}=${total}`);
ok(r.A > r.B && r.B > r.C, 'доли убывают по порядку выхода', `${r.A}>${r.B}>${r.C}`);
ok(r.D === -100, 'проигравший отдал ставку', 'D='+r.D);

console.log('\nНичья: двое проиграли из четырёх');
r = settle(100, ['A','B','C','D'], ['A','B'], ['C','D']);
ok(r.C === -100 && r.D === -100, 'оба проигравших отдали ставку');
ok(r.A+r.B === 200, 'банк 200 разделён между вышедшими', `${r.A}+${r.B}`);

console.log('\nВсе проиграли (возврат)');
r = settle(100, ['A','B'], [], ['A','B']);
ok(r.A === 0 && r.B === 0 || (r.A===undefined), 'ставки возвращаются');

console.log('\nПорядок выхода из движка');
const g = new Durak({players:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}], deckSize:36, seed:42});
ok(Array.isArray(g.exitOrder) && g.exitOrder.length===0, 'порядок выхода пуст в начале');
g.players[0].hand = []; g.markOut(g.players[0]);
g.players[1].hand = []; g.markOut(g.players[1]);
ok(g.exitOrder.join(',')==='a,b', 'порядок выхода записывается', g.exitOrder.join(','));
const view = g.publicState('c');
ok(Array.isArray(view.exitOrder), 'порядок выхода отдаётся клиенту');

console.log(`\n──────────────\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail?1:0);
