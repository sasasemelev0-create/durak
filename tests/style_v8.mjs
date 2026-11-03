import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=3901, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:''},cwd:new URL('..',import.meta.url).pathname.replace(/\/$/,''),stdio:['ignore','ignore','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv]'+d));
await sleep(1300);
const browser=await chromium.launch();
async function mk(id,vw,vh){
  const c=await browser.newContext({viewport:{width:vw,height:vh},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  const p=await c.newPage();
  p.on('pageerror',e=>console.log('[JS-ERROR]',e.message));
  await p.addInitScript(([i])=>localStorage.setItem('devId',i),[id+Math.random().toString(36).slice(2,6)]);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'});
  await sleep(450); return p;
}
const A=await mk('sa',400,860), B=await mk('sb',400,860);
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

console.log('\nЦвета мастей');
const colors = await A.evaluate(()=>{
  const out={red:[],black:[]};
  for(const c of document.querySelectorAll('#hand .card')){
    const t=c.textContent;
    const isRedSuit = t.includes('♥')||t.includes('♦');
    const col=getComputedStyle(c).color;
    (isRedSuit?out.red:out.black).push(col);
  }
  return out;
});
const redOK = colors.red.every(c=>/198, 40, 40|211, 47, 47/.test(c));
const blackOK = colors.black.every(c=>/17, 24, 32|27, 39, 51/.test(c));
ok(colors.red.length>0||colors.black.length>0,'карты в руке', JSON.stringify(colors));
ok(redOK,'красные масти — красные', colors.red[0]||'нет');
ok(blackOK,'пики/трефы — чёрные', colors.black[0]||'нет');

console.log('\nКолода и отбой');
const pile = await A.evaluate(()=>{
  const deck=document.getElementById('deck-pile');
  const backs=[...deck.querySelectorAll('.back-card')];
  const trump=document.getElementById('trump-card');
  const tb=trump.getBoundingClientRect();
  const disc=document.getElementById('discard-count');
  return {
    backs: backs.length,
    backBg: backs.length?getComputedStyle(backs[0]).backgroundImage.slice(0,40):null,
    trumpDisplay: getComputedStyle(trump).display,
    trumpLeft: Math.round(tb.left),
    trumpVisible: tb.width>0,
    discText: disc.textContent,
    discIsText: disc.tagName,
  };
});
ok(pile.backs>=3,'колода из карт рубашкой вверх ('+pile.backs+')');
ok(/gradient/.test(pile.backBg||''),'рубашка — полосатая заливка', (pile.backBg||'').slice(0,30));
ok(pile.trumpVisible,'козырь виден');
ok(pile.trumpLeft>=0,'козырь не вылезает влево', String(pile.trumpLeft));
ok(pile.discIsText==='DIV','счётчик отбоя — плашка, не голый текст');

console.log('\nПоле и карты на столе');
const field = await A.evaluate(()=>{
  const f=document.getElementById('field').getBoundingClientRect();
  const d=document.getElementById('deck-pile').getBoundingClientRect();
  const disc=document.getElementById('discard-pile').getBoundingClientRect();
  const bf=document.getElementById('battlefield').getBoundingClientRect();
  return {
    fieldH: Math.round(f.height),
    deckLeftOfField: d.right<=bf.left+2,
    discRightOfField: disc.left>=bf.right-2,
    bfWidth: Math.round(bf.width),
  };
});
ok(field.deckLeftOfField,'колода слева от поля');
ok(field.discRightOfField,'отбой справа от поля');
ok(field.bfWidth>50,'у поля есть ширина для карт', String(field.bfWidth));

console.log('\nРука и белый блок');
const hand = await A.evaluate(()=>{
  const h=document.getElementById('hand').getBoundingClientRect();
  const bar=document.querySelector('.player-bar').getBoundingClientRect();
  const cards=[...document.querySelectorAll('#hand .card')].map(c=>c.getBoundingClientRect());
  return {
    handBottom: Math.round(h.bottom), barTop: Math.round(bar.top),
    cardsInside: cards.every(c=>c.left>=-1 && c.right<=innerWidth+1 && c.top>=-1),
    cardCount: cards.length,
    firstTop: cards.length?Math.round(cards[0].top):0,
    barBottom: Math.round(bar.bottom), vh: innerHeight,
  };
});
ok(hand.handBottom<=hand.barTop+2,'рука над белым блоком',`${hand.handBottom}<=${hand.barTop}`);
ok(hand.cardsInside,'все карты в экране');
ok(hand.barBottom>=hand.vh-2,'белый блок внизу',`${hand.barBottom}/${hand.vh}`);
ok(hand.cardCount>0,'карты отрисованы', String(hand.cardCount));

console.log('\nКнопки');
const btns = await A.evaluate(()=>[...document.querySelectorAll('#bar-btns .pill-btn, #bar-btns .bar-hint')].map(b=>b.textContent.trim()));
ok(!btns.some(t=>/выложить|Готов|Подкинуть/i.test(t)),'нет кнопки «выложить»', btns.join(' | '));

console.log('\nПрофиль → возврат в игру');
await A.evaluate(()=>document.querySelector('#seats .seat')?.click());
await sleep(700);
ok(await A.evaluate(()=>document.getElementById('other-profile-screen').classList.contains('on')),'профиль открылся');
await A.evaluate(()=>document.getElementById('other-back').click());
await sleep(700);
const back=await A.evaluate(()=>({table:document.getElementById('table-screen').classList.contains('on')}));
ok(back.table,'вернулись на стол');

await browser.close(); srv.kill();
console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail?1:0);
