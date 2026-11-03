// Высота интерфейса: сжатый старт (как по ссылке) и последующее раскрытие
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=4301, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:''},cwd:new URL('..',import.meta.url).pathname.replace(/\/$/,''),stdio:['ignore','ignore','pipe']});
await sleep(1300);
const browser=await chromium.launch();

for (const [w,h,label] of [[390,844,'iPhone 390x844'],[360,640,'средний 360x640'],[430,932,'большой 430x932'],[320,568,'малый 320x568']]) {
  const id='h'+Math.random().toString(36).slice(2,7);
  const c=await browser.newContext({viewport:{width:w,height:h},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  const p=await c.newPage();
  p.on('pageerror',e=>console.log('[JS]',e.message));
  await p.addInitScript(i=>localStorage.setItem('devId',i),id);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'});
  await sleep(500);
  const info = await p.evaluate(()=>{
    const app=document.getElementById('app');
    const r=app.getBoundingClientRect();
    return {appH:Math.round(r.height), vh:innerHeight, cssH:getComputedStyle(app).height,
            varH:getComputedStyle(document.documentElement).getPropertyValue('--app-h').trim()};
  });
  ok(Math.abs(info.appH-info.vh)<=2, `${label}: #app по высоте экрана`, `app=${info.appH} vh=${info.vh} var=${info.varH}`);
  // интерфейс не вылезает
  const overflow = await p.evaluate(()=>[...document.querySelectorAll('.screen.on *')].filter(e=>{
    const b=e.getBoundingClientRect(); return b.width>0 && b.bottom>innerHeight+2;
  }).slice(0,3).map(e=>e.id||e.className));
  ok(overflow.length===0, `${label}: ничего не выходит за низ`, overflow.join(','));
  await c.close();
}

// сжатый старт → раскрытие
console.log('\nСжатый старт, затем раскрытие окна');
{
  const id='hx'+Math.random().toString(36).slice(2,7);
  const c=await browser.newContext({viewport:{width:390,height:500},hasTouch:true,isMobile:true});
  const p=await c.newPage();
  await p.addInitScript(i=>localStorage.setItem('devId',i),id);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'});
  await sleep(400);
  const small=await p.evaluate(()=>Math.round(document.getElementById('app').getBoundingClientRect().height));
  await p.setViewportSize({width:390,height:844});
  await sleep(500);
  const big=await p.evaluate(()=>({app:Math.round(document.getElementById('app').getBoundingClientRect().height), vh:innerHeight}));
  ok(big.app>=big.vh-2, 'после раскрытия окна #app догнал высоту', `${small} → ${big.app}/${big.vh}`);
  await c.close();
}
await browser.close(); srv.kill();
console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail?1:0);
