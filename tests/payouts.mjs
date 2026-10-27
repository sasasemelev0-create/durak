process.env.NO_LISTEN = '1';
// tests/payouts.mjs — правила ставок
import { computePayouts } from '../server/index.js';
let pass=0,fail=0; const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+JSON.stringify(e):'')));};
const sum=o=>Object.values(o).reduce((a,b)=>a+b,0);

console.log('Ставки');
// 3 игрока, C проиграл, A вышел первым, B вторым. ставка 100 → банк 100
let r=computePayouts({bet:100,players:['A','B','C'],losers:['C'],exitOrder:['A','B']});
ok(r.payouts.A===50 && r.payouts.B===50 && r.payouts.C===0, 'банк 100: A=50, B=50 (остаток последнему)', r.payouts);

// 4 игрока: A вышел 1-м, B 2-м, C 3-м, D проиграл. банк 100
r=computePayouts({bet:100,players:['A','B','C','D'],losers:['D'],exitOrder:['A','B','C']});
ok(r.payouts.A===50 && r.payouts.B===25 && r.payouts.C===25, 'половина, четверть, остаток', r.payouts);

// 4 игрока: двое проиграли (ничья) → банк 200
r=computePayouts({bet:100,players:['A','B','C','D'],losers:['C','D'],exitOrder:['A','B']});
ok(r.payouts.A===100 && r.payouts.B===100, 'ничья: банк 200 делится 100/100', r.payouts);

// сумма банка сохраняется (ни копейки не теряется)
r=computePayouts({bet:333,players:['A','B','C','D','E'],losers:['E'],exitOrder:['A','B','C','D']});
ok(sum(r.payouts)===333, 'сумма выплат = банку (333)', sum(r.payouts));

// нечётный банк — остаток не теряется
r=computePayouts({bet:7,players:['A','B','C'],losers:['C'],exitOrder:['A','B']});
ok(sum(r.payouts)===7, 'нечётный банк сходится', r.payouts);

// все проиграли → возврат
r=computePayouts({bet:100,players:['A','B'],losers:['A','B'],exitOrder:[]});
ok(r.refund===true, 'все проиграли → возврат ставок');

// никто не проиграл → возврат
r=computePayouts({bet:100,players:['A','B'],losers:[],exitOrder:[]});
ok(r.refund===true, 'никто не проиграл → возврат ставок');

console.log(`\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail?1:0);
