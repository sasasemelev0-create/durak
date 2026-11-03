// Подсветка хода: ровно у одного игрока, и именно у того, чей ход
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=4201, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:''},cwd:new URL('..',import.meta.url).pathname.replace(/\/$/,''),stdio:['ignore','ignore','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv]'+d));
await sleep(1300);
const browser=await chromium.launch();
async function mk(tag){
  const id=tag+Math.random().toString(36).slice(2,7);
  const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  const p=await c.newPage();
  p.on('pageerror',e=>console.log('[JS]',e.message));
  await p.addInitScript(i=>localStorage.setItem('devId',i),id);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'});
  await sleep(450); return p;
}
const A=await mk('t'), B=await mk('t');
await A.click('button[data-tab="create"]'); await sleep(300);
await A.click('#seg-players button[data-v="2"]'); await sleep(150);
await A.click('#do-create'); await sleep(700);
const rid=(await A.textContent('#room-title')).replace('Лобби ','').trim();
await B.click('button[data-tab="list"]'); await sleep(500);
await B.waitForSelector('.room',{timeout:6000});
await B.evaluate(r=>{const e=[...document.querySelectorAll('.room')].find(x=>x.dataset.id===r); e&&e.click();},rid);
await A.waitForFunction(()=>{const b=document.getElementById('start-game'); return b&&!b.disabled;},{timeout:8000});
await A.click('#start-game'); await sleep(200);
await B.click('#start-game'); await sleep(1600);

const probe = (p) => p.evaluate(() => ({
  handMine: document.getElementById('hand').classList.contains('my-turn'),
  id: window.__durak.state.game.you.id,
  isAtt: window.__durak.state.game.you.isAttacker,
  isDef: window.__durak.state.game.you.isDefender,
  seatTurn: [...document.querySelectorAll('#seats .seat')].filter(s=>s.classList.contains('turn')).map(s=>s.dataset.profile),
  banner: document.getElementById('turn-banner').textContent.trim(),
  table: window.__durak.state.game.table.length,
}));

console.log('\nСостояние 1: стол пуст, ждём атакующего');
let a = await probe(A), b = await probe(B);
const attacker = a.isAtt ? A : B;
const defender = a.isAtt ? B : A;
const ap = await probe(attacker), dp = await probe(defender);
ok(ap.handMine === true, 'у атакующего рука подсвечена');
ok(dp.handMine === false, 'у защитника рука НЕ подсвечена', String(dp.handMine));
ok(ap.handMine !== dp.handMine, 'подсветка ровно у одного игрока');

console.log('\nСостояние 2: карта на столе, ждём защитника');
const card = await attacker.evaluate(()=>{const e=document.querySelector('#hand .card'); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};});
const cdp = await attacker.context().newCDPSession(attacker);
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:card.x,y:card.y}]});
for(let i=1;i<=8;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:card.x,y:card.y-i*20}]}); await sleep(12);}
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await sleep(900);
const ap2 = await probe(attacker), dp2 = await probe(defender);
ok(dp2.table >= 1 || ap2.table >= 1, 'карта выложена');
ok(dp2.handMine === true, 'теперь подсвечен защитник', `таблица=${dp2.table}`);
ok(ap2.handMine === false, 'у атакующего подсветка снята');
ok(/отбивайтесь|берите/i.test(dp2.banner), 'у защитника текст «отбивайтесь или берите»', dp2.banner);

console.log('\nСостояние 3: защитник взял → ждём его подтверждения');
const takeBtn = await defender.$('#bar-btns .pill-btn.take');
if (takeBtn) {
  await takeBtn.click(); await sleep(800);
  const dp3 = await probe(defender), ap3 = await probe(attacker);
  ok(dp3.handMine === true, 'во время взятия подсвечен защитник');
  ok(ap3.handMine === false, 'у атакующего подсветки нет');
}

console.log('\nСостояние 4: подсветка соперников в шапке');
const seatTurn = await attacker.evaluate(()=>[...document.querySelectorAll('#seats .seat')].filter(s=>s.classList.contains('turn')).map(s=>s.dataset.profile));
ok(seatTurn.length <= 1, 'в шапке подсвечен не более одного', JSON.stringify(seatTurn));

await browser.close(); srv.kill();
console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail?1:0);
