// Интерфейс v9: ход, козырь, ставка, шулерство без подсветки, ссылка
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=4101, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:''},cwd:new URL('..',import.meta.url).pathname.replace(/\/$/,''),stdio:['ignore','ignore','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv]'+d));
await sleep(1300);
const browser=await chromium.launch();
const errors=[];
async function mk(tag,vw=390,vh=844){
  const id=tag+Math.random().toString(36).slice(2,7);
  const c=await browser.newContext({viewport:{width:vw,height:vh},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  const p=await c.newPage();
  p.on('pageerror',e=>errors.push(tag+': '+e.message));
  await p.addInitScript(i=>localStorage.setItem('devId',i),id);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'});
  await sleep(450); return p;
}

console.log('\nСоздание лобби: ставка до 10 000, шаг 50');
const A=await mk('a'), B=await mk('b');
let nextPrompt = null;
A.on('dialog', d => { const v = nextPrompt; nextPrompt = null; v === null ? d.dismiss() : d.accept(v); });
B.on('dialog', d => d.dismiss());
await A.click('button[data-tab="create"]'); await sleep(300);
await A.click('#seg-players button[data-v="2"]'); await sleep(150);
// ползунок: шаг 50
const step=await A.evaluate(()=>document.getElementById('bet-range').step);
ok(step==='50','ползунок с шагом 50', step);
// ручной ввод: нажимаем на сумму, prompt → 7350
nextPrompt='7350';
await A.click('#bet-value'); await sleep(200);
ok((await A.textContent('#bet-value'))==='7350','ставка введена вручную: 7350');
nextPrompt='99999';
await A.click('#bet-value'); await sleep(200);
ok((await A.textContent('#bet-value'))==='10000','ставка ограничена 10 000');
nextPrompt='0';
await A.click('#bet-value'); await sleep(200);
await A.click('#do-create'); await sleep(700);
const rid=(await A.textContent('#room-title')).replace('Лобби ','').trim();
const roomBet=await A.evaluate(()=>window.__durak.state.room?.room?.bet);
ok(roomBet===0,'ставка по умолчанию 0 — после ручного ввода 0 сохранилась', String(roomBet));

console.log('\nВторой игрок, старт партии');
await B.click('button[data-tab="list"]'); await sleep(500);
await B.waitForSelector('.room',{timeout:6000});
await B.evaluate(r=>{const e=[...document.querySelectorAll('.room')].find(x=>x.dataset.id===r); e&&e.click();},rid);
await A.waitForFunction(()=>{const b=document.getElementById('start-game'); return b&&!b.disabled;},{timeout:8000});
await A.click('#start-game'); await sleep(200);
await B.click('#start-game'); await sleep(1600);
ok(await A.isVisible('#table-screen'),'партия началась');

console.log('\nПонятный ход');
const turn=await A.evaluate(()=>{const t=document.getElementById('turn-banner'); return {text:t.textContent.trim(), hidden:t.classList.contains('hide')};});
const aIsAtt=await A.evaluate(()=>window.__durak.state.game.you.isAttacker);
const bIsAtt=await B.evaluate(()=>window.__durak.state.game.you.isAttacker);
const attP = aIsAtt?A:B, defP = aIsAtt?B:A;
const attBanner=await attP.evaluate(()=>document.getElementById('turn-banner').textContent.trim());
const defBanner=await defP.evaluate(()=>document.getElementById('turn-banner').textContent.trim());
ok(/выложите карту/i.test(attBanner),'у атакующего: «Ваш ход — выложите карту»', attBanner);
ok(/отбивайтесь|берите|Ваш ход/i.test(defBanner),'у защитника понятная подпись', defBanner);
ok(await attP.evaluate(()=>document.getElementById('hand').classList.contains('my-turn')),'рука атакующего подсвечена (мой ход)');
// подсвечиваться должна ровно одна рука — у того, чей ход
const defHandMine=await defP.evaluate(()=>document.getElementById('hand').classList.contains('my-turn'));
const attHandMine=await attP.evaluate(()=>document.getElementById('hand').classList.contains('my-turn'));
ok(attHandMine!==defHandMine,'подсвечена ровно одна рука — у того, чей ход', `атакующий=${attHandMine}, защитник=${defHandMine}`);

console.log('\nКозырь-символ после колоды');
const deckInfo=await A.evaluate(()=>({count:window.__durak.state.game.deckCount, trump:window.__durak.state.game.trump}));
ok(typeof deckInfo.count==='number' && deckInfo.count>0,'колода считается', String(deckInfo.count));

console.log('\nШулерство: нет подсветки и кнопки «Поймать»');
const hasSuspect=await A.evaluate(()=>!!document.querySelector('.slot.suspect'))||await B.evaluate(()=>!!document.querySelector('.slot.suspect'));
ok(!hasSuspect,'класса .suspect нет нигде');
const catchBtn=await A.evaluate(()=>[...document.querySelectorAll('#bar-btns .pill-btn')].some(b=>/Поймать/.test(b.textContent)));
ok(!catchBtn,'кнопки «Поймать» нет');

console.log('\nКонсоль');
ok(errors.length===0,'нет JS-ошибок',errors.slice(0,3).join(' | '));

await browser.close(); srv.kill();
console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail?1:0);
