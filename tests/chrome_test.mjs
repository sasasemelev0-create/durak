import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=4501, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:''},cwd:new URL('..',import.meta.url).pathname.replace(/\/$/,''),stdio:['ignore','ignore','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv]'+d));
await sleep(1400);
const browser=await chromium.launch();
const Q='?tgWebAppPlatform=android&tgWebAppVersion=7.0&tgWebAppData=stub';
async function boot(vw,vh){
  const id='c'+Math.random().toString(36).slice(2,7);
  const c=await browser.newContext({viewport:{width:vw,height:vh},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  const p=await c.newPage();
  p.on('pageerror',e=>console.log('[JS]',e.message));
  await p.addInitScript(i=>localStorage.setItem('devId',i),id);
  await p.goto(`http://127.0.0.1:${PORT}/${Q}`,{waitUntil:'networkidle'});
  await sleep(700); return p;
}
const DEVICES=[[320,568,'SE 320x568'],[360,640,'Android 360x640'],[375,667,'iPhone8 375x667'],[390,844,'iPhone14 390x844'],[393,852,'Pixel 393x852'],[412,915,'Pixel7 412x915'],[430,932,'ProMax 430x932']];
console.log('\nШапка Telegram не перекрывает интерфейс');
const tops=[];
for (const [w,h,label] of DEVICES){
  const p=await boot(w,h);
  const r=await p.evaluate(()=>{
    const t=document.querySelector('#profile-screen .title').getBoundingClientRect();
    const tabs=document.querySelector('.tabs').getBoundingClientRect();
    return {titleTop:Math.round(t.top),
      top:Math.round(parseFloat(getComputedStyle(document.querySelector('#profile-screen')).paddingTop)),
      tabsBottom:Math.round(tabs.bottom), tabsTop:Math.round(tabs.top),
      vh:innerHeight, app:Math.round(document.getElementById('app').getBoundingClientRect().height)};
  });
  tops.push(r.top);
  ok(r.titleTop>=90,`${label}: заголовок ниже кнопки (${r.titleTop}px)`);
  ok(r.tabsBottom<=r.vh+1,`${label}: вкладки в экране`,`${r.tabsBottom}≤${r.vh}`);
  ok(Math.abs(r.app-r.vh)<=2,`${label}: приложение по высоте окна`,`${r.app}/${r.vh}`);
  await p.context().close();
}
ok(Math.max(...tops)-Math.min(...tops)<=8,'отступ сверху одинаковый на всех экранах',`${Math.min(...tops)}..${Math.max(...tops)}px`);
console.log('\nСтол на разных экранах');
for (const [w,h,label] of [[360,640,'360x640'],[390,844,'390x844'],[430,932,'430x932']]){
  async function mk(){
    const id='g'+Math.random().toString(36).slice(2,7);
    const c=await browser.newContext({viewport:{width:w,height:h},hasTouch:true,isMobile:true,deviceScaleFactor:2});
    const p=await c.newPage();
    await p.addInitScript(i=>localStorage.setItem('devId',i),id);
    await p.goto(`http://127.0.0.1:${PORT}/${Q}`,{waitUntil:'networkidle'});
    await sleep(600); return p;
  }
  const A=await mk(),B=await mk();
  await A.click('button[data-tab="create"]'); await sleep(350);
  await A.click('#seg-players button[data-v="2"]'); await sleep(150);
  await A.click('#do-create'); await sleep(700);
  const rid=(await A.textContent('#room-title')).replace('Лобби ','').trim();
  await B.click('button[data-tab="list"]'); await sleep(500);
  await B.waitForSelector('.room',{timeout:6000});
  await B.evaluate(r=>{const e=[...document.querySelectorAll('.room')].find(x=>x.dataset.id===r); e&&e.click();},rid);
  await A.waitForFunction(()=>{const b=document.getElementById('start-game'); return b&&!b.disabled;},{timeout:8000});
  await A.click('#start-game'); await sleep(200);
  await B.click('#start-game'); await sleep(1700);
  const st=await A.evaluate(()=>{
    const head=document.querySelector('.table-head').getBoundingClientRect();
    const bar=document.querySelector('.player-bar').getBoundingClientRect();
    const hand=document.getElementById('hand').getBoundingClientRect();
    return {headTop:Math.round(head.top),barBottom:Math.round(bar.bottom),handBottom:Math.round(hand.bottom),barTop:Math.round(bar.top),vh:innerHeight};
  });
  ok(st.headTop>=90,`${label}: шапка стола ниже кнопки`,String(st.headTop));
  ok(st.barBottom<=st.vh+1,`${label}: белый блок в экране`,`${st.barBottom}≤${st.vh}`);
  ok(st.handBottom<=st.barTop+2,`${label}: рука над блоком`);
  await A.context().close(); await B.context().close();
}
await browser.close(); srv.kill();
console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail?1:0);
