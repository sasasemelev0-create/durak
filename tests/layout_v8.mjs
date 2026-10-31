import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=3801, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0, fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:'',NO_LISTEN:''},cwd:'/home/user/durak-v8',stdio:['ignore','ignore','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv]'+d));
await sleep(1300);
const browser=await chromium.launch();

async function mk(id,vw,vh){
  const c=await browser.newContext({viewport:{width:vw,height:vh},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  const p=await c.newPage();
  p.on('pageerror',e=>console.log('[JS]',e.message));
  await p.addInitScript(([i])=>localStorage.setItem('devId',i),[id+Math.random().toString(36).slice(2,6)]);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'});
  await sleep(450); return p;
}

for (const [vw,vh] of [[320,568],[360,640],[375,667],[390,844],[400,860],[430,932]]) {
  const A=await mk('la',vw,vh), B=await mk('lb',vw,vh);
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

  // набиваем руку до 12 и пересчитываем
  await A.evaluate(()=>{
    const hand=document.getElementById('hand');
    const proto=hand.querySelector('.card');
    while(hand.children.length<12 && proto){ const c=proto.cloneNode(true); c.style.cssText=''; hand.appendChild(c); }
    window.__durak.layoutHand(hand, hand.children.length);
  });
  await sleep(350);   // ждём окончания transition left
  const d = await A.evaluate(()=>{
    const hand=document.getElementById('hand');
    const R=s=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect();
      return {l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height};};
    const cards=[...hand.querySelectorAll('.card')].map(c=>{const b=c.getBoundingClientRect(); return {l:b.left,r:b.right,w:b.width};});
    const slot=document.querySelector('#battlefield .slot');
    const sb=slot?slot.getBoundingClientRect():null;
    return {
      vw:innerWidth, vh:innerHeight,
      field:R('#field'), deck:R('#deck-pile'), bf:R('#battlefield'), disc:R('#discard-pile'),
      hand:R('#hand'), bar:R('.player-bar'), seats:R('#seats'), head:R('.table-head'), log:R('#log'),
      button: (()=>{const b=document.querySelector('#bar-btns .pill-btn'); if(!b) return null; const r=b.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom};})(),
      cardFirst: cards[0], cardLast: cards[cards.length-1], cardCount: cards.length,
      step: cards.length>1?Math.round(cards[1].l-cards[0].l):0,
      cardW: cards.length?Math.round(cards[0].w):0,
      slot: sb?{l:sb.left,r:sb.right,t:sb.top,b:sb.bottom}:null,
      overflowX: [...document.querySelectorAll('#table-screen *')].filter(e=>{const b=e.getBoundingClientRect(); return b.width>0 && (b.right>innerWidth+2 || b.left<-2);}).map(e=>e.id||e.className).slice(0,6),
    };
  });

  const name = `${vw}x${vh}`;
  // 1. ничего не вылезает по горизонтали
  ok(d.overflowX.length===0, `${name}: нет элементов за краем`, d.overflowX.join(','));
  // 2. рука внутри экрана
  ok(d.cardFirst.l>=-1 && d.cardLast.r<=d.vw+1, `${name}: 12 карт влезают`, `${Math.round(d.cardFirst.l)}..${Math.round(d.cardLast.r)}/${d.vw}`);
  // 3. угол виден
  ok(d.step>=14, `${name}: угол карты виден (шаг ${d.step}px, карта ${d.cardW}px)`);
  // 4. рука выше белого блока
  ok(d.hand.b<=d.bar.t+2, `${name}: рука над белым блоком`, `${Math.round(d.hand.b)}<=${Math.round(d.bar.t)}`);
  // 5. блок прижат к низу
  ok(d.bar.b>=d.vh-2, `${name}: белый блок внизу`, `${Math.round(d.bar.b)}/${d.vh}`);
  // 6. колода слева, отбой справа, поле между
  ok(d.deck.l<d.bf.l && d.bf.r<=d.disc.l+1, `${name}: колода|поле|отбой по порядку`,
     `deck ${Math.round(d.deck.l)}-${Math.round(d.deck.r)}, bf ${Math.round(d.bf.l)}-${Math.round(d.bf.r)}, disc ${Math.round(d.disc.l)}-${Math.round(d.disc.r)}`);
  // 7. поле не наезжает на колоду/отбой
  ok(d.bf.l>=d.deck.r-1 && d.bf.r<=d.disc.l+1, `${name}: поле не наезжает на колоды`);
  // 8. карты стола не выходят за поле
  if (d.slot) ok(d.slot.l>=d.bf.l-2 && d.slot.r<=d.bf.r+2, `${name}: карта на столе внутри поля`);
  // 9. вертикально всё помещается
  ok(d.bar.b<=d.vh+1 && d.head.t>=-1, `${name}: по высоте помещается`, `head ${Math.round(d.head.t)}, bar ${Math.round(d.bar.b)}, vh ${d.vh}`);
  // 10. кнопка не вылезает
  if (d.button) ok(d.button.r<=d.vw+1 && d.button.l>=-1, `${name}: кнопка в экране`);

  await A.context().close(); await B.context().close();
}

await browser.close(); srv.kill();
console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail?1:0);
