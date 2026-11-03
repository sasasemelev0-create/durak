// Полноэкранный режим Telegram: шапка не под кнопкой, вкладки не обрезаны
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=4403, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:''},cwd:new URL('..',import.meta.url).pathname.replace(/\/$/,''),stdio:['ignore','ignore','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv]'+d));
await sleep(1400);
const browser=await chromium.launch();

// Библиотека Telegram перезаписывает window.Telegram, поэтому после загрузки
// страницы сами ставим нужные поля и просим приложение пересчитать отступы.
async function bootFullscreen(vw,vh,opts={}){
  const id='i'+Math.random().toString(36).slice(2,7);
  const c=await browser.newContext({viewport:{width:vw,height:vh},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  const p=await c.newPage();
  p.on('pageerror',e=>console.log('[JS]',e.message));
  await p.addInitScript(i=>localStorage.setItem('devId',i),id);
  const q = opts.plainBrowser
    ? ''
    : '?tgWebAppPlatform=android&tgWebAppVersion=7.0&tgWebAppData=stub';
  await p.goto(`http://127.0.0.1:${PORT}/${q}`,{waitUntil:'networkidle'});
  await sleep(600);
  if (opts.apiTop !== undefined) {
    await p.evaluate((o)=>{
      const t = window.Telegram?.WebApp;
      if (!t) return;
      t.contentSafeAreaInset = {top:o.apiTop, bottom:o.apiBottom||0};
      window.__durak.refreshInsets?.();
    }, opts);
    await sleep(250);
  }
  return p;
}

console.log('\nПолноэкранный режим без подсказок от клиента (старая библиотека)');
for (const [w,h,label] of [[390,844,'390x844'],[360,780,'360x780'],[430,932,'430x932']]) {
  const p = await bootFullscreen(w,h,{});
  const r = await p.evaluate(()=>{
    const title=document.querySelector('#profile-screen .title').getBoundingClientRect();
    const tabs=document.querySelector('.tabs').getBoundingClientRect();
    return {
      titleTop: Math.round(title.top),
      safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim(),
      tabsBottom: Math.round(tabs.bottom),
      tabsHeight: Math.round(tabs.height),
      vh: innerHeight,
    };
  });
  ok(r.titleTop >= 50, `${label}: заголовок ниже кнопки Telegram (${r.titleTop}px, отступ ${r.safeTop})`);
  ok(r.tabsBottom <= r.vh+1, `${label}: вкладки не обрезаны (${r.tabsBottom} ≤ ${r.vh})`);
  ok(r.tabsHeight >= 50, `${label}: панель вкладок видна целиком (${r.tabsHeight}px)`);
  await p.context().close();
}

console.log('\nКлиент сообщает инсеты (новый Telegram)');
{
  const p = await bootFullscreen(390,844,{apiTop:60, apiBottom:24, isFullscreen:true});
  const r = await p.evaluate(()=>({
    titleTop: Math.round(document.querySelector('#profile-screen .title').getBoundingClientRect().top),
    safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim(),
  }));
  ok(r.titleTop >= 55, `использован инсет клиента: отступ ${r.safeTop}, заголовок ${r.titleTop}px`);
  await p.context().close();
}

console.log('\nВне Telegram (platform unknown) — лишнего отступа нет');
{
  const p = await bootFullscreen(390,844,{plainBrowser:true});
  const r = await p.evaluate(()=>({
    safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim(),
    titleTop: Math.round(document.querySelector('#profile-screen .title').getBoundingClientRect().top),
  }));
  ok(r.titleTop < 55, `лишнего отступа нет (${r.titleTop}px)`, r.safeTop);
  await p.context().close();
}

console.log('\nОбычный браузер (Telegram нет)');
{
  const id='n'+Math.random().toString(36).slice(2,7);
  const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const p=await c.newPage();
  await p.addInitScript(i=>localStorage.setItem('devId',i),id);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'});
  await sleep(600);
  const r=await p.evaluate(()=>({
    tabs:Math.round(document.querySelector('.tabs').getBoundingClientRect().bottom),
    vh:innerHeight,
    app:Math.round(document.getElementById('app').getBoundingClientRect().height),
    safeTop:getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim(),
  }));
  ok(r.tabs<=r.vh+1,'вкладки в экране',`${r.tabs}≤${r.vh}`);
  ok(Math.abs(r.app-r.vh)<=2,'#app по высоте экрана',`${r.app}/${r.vh}`);
  await c.close();
}

console.log('\nСтол в полноэкранном режиме');
{
  async function mk(tag,opts){
    const id=tag+Math.random().toString(36).slice(2,7);
    const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
    const p=await c.newPage();
    await p.addInitScript(i=>localStorage.setItem('devId',i),id);
    await p.goto(`http://127.0.0.1:${PORT}/?tgWebAppPlatform=android&tgWebAppVersion=7.0&tgWebAppData=stub`,{waitUntil:'networkidle'});
    await sleep(600);
    return p;
  }
  const A=await mk('a',{}), B=await mk('b',{});
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
    return {headTop:Math.round(head.top), barBottom:Math.round(bar.bottom), handBottom:Math.round(hand.bottom), barTop:Math.round(bar.top), vh:innerHeight};
  });
  ok(st.headTop>=50,'стол: шапка ниже кнопки Telegram',String(st.headTop));
  ok(st.barBottom<=st.vh+1,'стол: белый блок в экране',`${st.barBottom}≤${st.vh}`);
  ok(st.handBottom<=st.barTop+2,'стол: рука над белым блоком',`${st.handBottom}≤${st.barTop}`);
  await A.context().close(); await B.context().close();
}

await browser.close(); srv.kill();
console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail?1:0);
