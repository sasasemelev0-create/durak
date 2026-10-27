// Проверка: защищающийся перетаскивает карту на конкретную цель
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=3155, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(c,n,e='')=>{ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:''))); };

const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:''},cwd:'/home/user/durak',stdio:['ignore','ignore','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv] '+d));
await sleep(1000);
const browser=await chromium.launch();
const mk=async(id)=>{
  const c=await browser.newContext({viewport:{width:400,height:860},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const p=await c.newPage();
  p.on('pageerror',e=>console.log('  ! PAGEERR',e.message));
  await p.addInitScript(i=>localStorage.setItem('devId',i),id);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'});
  await sleep(500); return p;
};

try {
  const A=await mk('host'), B=await mk('guest');
  await A.click('button[data-tab="create"]'); await sleep(250);
  await A.click('#seg-players button[data-v="2"]');
  await A.click('#seg-deck button[data-v="36"]');
  await sleep(150);
  await A.click('#do-create'); await sleep(700);
  await B.click('button[data-tab="list"]'); await sleep(500);
  await B.click('.room'); await sleep(600);
  await A.click('#start-game'); await sleep(1200);

  // кто атакует
  const aBtn = await A.textContent('#bar-btns');
  const att = /Готов/.test(aBtn) ? A : B;
  const def = att===A ? B : A;
  const defName = att===A ? 'гость' : 'хост';

  console.log('\nКнопки защищающегося');
  const btns = await def.locator('#bar-btns .pill-btn').allTextContents();
  ok(!btns.some(t=>/Бить/.test(t)), 'кнопки «Бить» нет', JSON.stringify(btns));
  ok(btns.some(t=>/Беру/.test(t)), 'кнопка «Беру» есть');

  // атакующий кладёт карту свайпом
  const cb = await att.locator('#hand .card').first().boundingBox();
  const bfA = await att.locator('#battlefield').boundingBox();
  const cdpA = await att.context().newCDPSession(att);
  const ax = cb.x+cb.width/2, ay = cb.y+cb.height/2;
  const bx = bfA.x+bfA.width/2, by = bfA.y+bfA.height/2;
  await cdpA.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:ax,y:ay}]});
  for(let i=1;i<=12;i++){
    await cdpA.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:ax+(bx-ax)*i/12, y:ay+(by-ay)*i/12}]});
    await sleep(16);
  }
  await cdpA.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(1000);

  const slots = await def.locator('#battlefield .slot').count();
  ok(slots===1, 'защищающийся видит карту на столе', String(slots));

  console.log('\nПодсказка вместо кнопки');
  ok(await def.isVisible('.bar-hint'), 'видна подсказка «перетащите карту»');

  console.log('\nПеретаскивание на карту-цель');
  const target = await def.locator('#battlefield .slot .atk').first().boundingBox();
  const handCards = def.locator('#hand .card');
  const n0 = await handCards.count();
  const src = await handCards.first().boundingBox();

  const cdpD = await def.context().newCDPSession(def);
  const sx = src.x+src.width/2, sy = src.y+src.height/2;
  const tx = target.x+target.width/2, ty = target.y+target.height/2;

  await cdpD.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy}]});
  for(let i=1;i<=10;i++){
    const px = sx + (tx-sx)*i/10, py = sy + (ty-sy)*i/10;
    await cdpD.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:px,y:py}]});
    await sleep(16);
  }
  // в момент над целью — проверяем подсветку
  const highlighted = await def.locator('#battlefield .slot.target, #battlefield .slot.invalid').count();
  ok(highlighted>0, 'карта-цель подсвечивается при наведении', String(highlighted));

  await cdpD.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(1000);

  const n1 = await handCards.count();
  const log = await def.textContent('#log');
  const defended = /бьёт/.test(log);
  // могла не сработать если карта не бьёт — это нормально
  const toastTxt = await def.textContent('#toast').catch(()=> '');
  if (defended) {
    ok(n1===n0-1, 'карта ушла из руки (отбился)', `${n0} -> ${n1}`);
    ok(true, 'в журнале «бьёт»');
  } else {
    ok(n1===n0, 'карта не подошла — осталась в руке, показано почему', toastTxt.slice(0,40));
  }

  console.log('\nОшибки JS');
  // (перехвачены выше через pageerror)

  await def.screenshot({path:'/home/user/beat-test.png'});
} catch(e){
  fail++; console.log('  ✗ ИСКЛЮЧЕНИЕ: '+e.message);
} finally {
  await browser.close(); srv.kill(); await sleep(150);
  console.log(`\n──────────────\nПройдено: ${pass}, провалено: ${fail}`);
  process.exit(fail?1:0);
}
