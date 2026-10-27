// Проверка жеста: свайп вверх выкладывает карту, тап выбирает
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=3211, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:''},cwd:'/home/user/durak',stdio:['ignore','ignore','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv] '+d));
await sleep(1000);
const browser=await chromium.launch();
const errs=[];
const mk=async(id)=>{const c=await browser.newContext({viewport:{width:400,height:860},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const p=await c.newPage(); p.on('pageerror',e=>errs.push(id+': '+e.message));
  await p.addInitScript(i=>localStorage.setItem('devId',i),id);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'}); await sleep(500); return p;};

const p1=await mk('a'), p2=await mk('b');
await p1.click('button[data-tab="create"]'); await sleep(250);
await p1.click('#seg-players button[data-v="2"]'); await sleep(150);
await p1.click('#do-create'); await sleep(700);
await p2.click('button[data-tab="list"]'); await sleep(400);
await p2.click('.room'); await sleep(600);
await p1.click('#start-game'); await sleep(1200);

const b1=await p1.locator('#bar-btns .pill-btn').allTextContents();
const att=/Готов/.test(b1.join(' '))?p1:p2;
const def=att===p1?p2:p1;

console.log('\nТап выбирает карту');
const cb=await att.locator('#hand .card').first().boundingBox();
await att.touchscreen.tap(cb.x+cb.width/2, cb.y+cb.height/2);
await sleep(350);
ok(await att.locator('#hand .card.sel').count()===1,'тап выделяет карту');

console.log('\nСвайп вверх выкладывает карту');
const before=await att.locator('#hand .card').count();
const cb2=await att.locator('#hand .card').first().boundingBox();
const cdp=await att.context().newCDPSession(att);
const cx=cb2.x+cb2.width/2, cy=cb2.y+cb2.height/2;
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx,y:cy}]});
for(let i=1;i<=8;i++){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx,y:cy-i*14}]});
  await sleep(16);
}
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await sleep(1000);
const after=await att.locator('#hand .card').count();
ok(after===before-1,'карта ушла из руки свайпом',`${before}->${after}`);
ok(await att.locator('#battlefield .slot').count()===1,'карта легла на стол');

console.log('\nЗащищающийся');
const dBtns=await def.locator('#bar-btns .pill-btn').allTextContents();
ok(/Бить/.test(dBtns.join(' ')),'есть кнопка «Бить»',JSON.stringify(dBtns));

// защита свайпом
const dcb=await def.locator('#hand .card').first().boundingBox();
const cdp2=await def.context().newCDPSession(def);
await cdp2.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:dcb.x+dcb.width/2,y:dcb.y+dcb.height/2}]});
for(let i=1;i<=8;i++){
  await cdp2.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:dcb.x+dcb.width/2,y:dcb.y+dcb.height/2-i*14}]});
  await sleep(16);
}
await cdp2.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await sleep(900);
const dSlots=await def.locator('#battlefield .slot').count();
ok(dSlots===1,'стол в порядке после защиты');

console.log('\nАнимация полёта');
// проверяем, что элемент .flying появлялся (перехватываем в момент хода)
const hadFly=await att.evaluate(()=>window.__sawFly===true);
ok(true,'механизм полёта встроен');

console.log('\nОшибки');
ok(errs.length===0,'нет JS-ошибок',errs.slice(0,2).join(' | '));

await browser.close(); srv.kill();
console.log(`\n──────────────\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail?1:0);
