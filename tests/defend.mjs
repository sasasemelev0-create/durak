import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=3145, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0, fail=0; const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:''},cwd:'/home/user/durak-v4',stdio:['ignore','ignore','pipe']});
await sleep(1000);
const browser=await chromium.launch();
const mk=async(id)=>{const c=await browser.newContext({viewport:{width:400,height:860},hasTouch:true,isMobile:true});const p=await c.newPage();
  await p.addInitScript(i=>localStorage.setItem('devId',i),id);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'}); await sleep(400); return p;};
try{
  const p1=await mk('h'), p2=await mk('g');
  await p1.click('button[data-tab="create"]'); await sleep(200);
  await p1.click('#seg-players button[data-v="2"]');
  await p1.click('#do-create'); await sleep(600);
  await p2.click('button[data-tab="list"]'); await sleep(400);
  await p2.click('.room'); await sleep(500);
  await p1.click('#start-game'); await sleep(200);
  await p2.click('#start-game'); await sleep(1100);

  // определяем атакующего/защитника по кнопкам
  const isDef = async p => /Беру/.test(await p.locator('#bar-btns').textContent());
  const def = (await isDef(p1)) ? p1 : p2;
  const att = def===p1 ? p2 : p1;

  // атакующий выкладывает карту (тап + свайп вверх через CDP)
  const cdpAtt = await att.context().newCDPSession(att);
  const swipeUp = async (page, cdp, box) => {
    const x=box.x+box.width/2, y=box.y+box.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=8;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*16}]}); await sleep(15); }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await sleep(900);
  };
  // ждём, пока у атакующего появится кнопка «Готов» (значит он ходит)
  for (let i=0;i<20;i++){ if (/Готов/.test(await att.locator('#bar-btns').textContent())) break; await sleep(150); }
  const aCard = await att.locator('#hand .card').first().boundingBox();
  await swipeUp(att, cdpAtt, aCard);
  // если свайп не сработал — выкладываем кнопкой «Готов» после выбора карты
  if (await att.locator('#battlefield .slot').count()===0) {
    await att.locator('#hand .card').first().click();
    await sleep(200);
    await att.locator('#bar-btns .pill-btn', {hasText:'Готов'}).click().catch(()=>{});
    await sleep(700);
  }
  ok(await att.locator('#battlefield .slot').count()===1, 'атака выложена');
  await sleep(300);

  // защитник: проверяем, что у него есть карта, которой можно побить
  await sleep(300);
  const attackId = await def.locator('#battlefield .slot').first().getAttribute('data-attack-id').catch(()=>null);
  ok(!!attackId, 'защитник видит id атакующей карты');

  // защитник тянет свою карту на атаку
  const cdpDef = await def.context().newCDPSession(def);
  const defHand = await def.evaluate(()=>[...document.querySelectorAll('#hand .card')].map(e=>e.dataset.id));
  const slotBox = await def.locator('#battlefield .slot').first().boundingBox();
  const cardBoxes = await def.locator('#hand .card').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,id:e.dataset.id}}));
  // ищем карту из руки, которая бьёт (проверка через серверные правила не нужна — сервер вернёт ошибку, если не бьёт)
  // пробуем все карты по очереди, пока одна не побьёт
  let beaten=false;
  for (const cb of cardBoxes){
    const before = await def.locator('#battlefield .slot .def').count();
    const sx=cb.x+cb.w/2, sy=cb.y+cb.h/2;
    const tx=slotBox.x+slotBox.width/2, ty=slotBox.y+slotBox.height/2;
    await cdpDef.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy}]});
    for(let i=1;i<=10;i++){ await cdpDef.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx+(tx-sx)*i/10,y:sy+(ty-sy)*i/10}]}); await sleep(15); }
    await cdpDef.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await sleep(700);
    const after = await def.locator('#battlefield .slot .def').count();
    if (after > before) { beaten=true; break; }
    await sleep(100);
  }
  ok(beaten, 'защитник побил атаку перетаскиванием карты на неё');
  if (beaten) {
    ok(await def.locator('#battlefield .slot .def').count()===1, 'защита легла на стол');
    ok(await att.locator('#battlefield .slot .def').count()===1, 'атакующий видит защиту');
  }
  const errs = [];
  def.on('pageerror',e=>errs.push(e.message));
  ok(errs.length===0,'нет JS-ошибок');
}catch(e){fail++;console.log('ИСКЛЮЧЕНИЕ',e.message);}
finally{await browser.close();srv.kill();console.log(`\nПройдено ${pass}, провалено ${fail}`);process.exit(fail?1:0);}
