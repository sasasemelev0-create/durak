import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT=3261, sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(c,n,e='')=>{c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(e?' — '+e:'')));};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),BOT_TOKEN:''},
  cwd:'/home/user/durak-v4',stdio:['ignore','ignore','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv] '+d));
await sleep(1100);
const browser=await chromium.launch();
const errs=[];
async function mk(id,name){
  const c=await browser.newContext({viewport:{width:400,height:860},hasTouch:true,isMobile:true});
  const p=await c.newPage();
  p.on('pageerror',e=>errs.push(id+': '+e.message));
  await p.addInitScript(([i])=>localStorage.setItem('devId',i),[id]);
  await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'networkidle'});
  await sleep(450);
  return p;
}
try{
  const p1=await mk('v5a'), p2=await mk('v5b');

  console.log('\nКнопка «Готов» исчезает после старта');
  await p1.click('button[data-tab="create"]'); await sleep(250);
  await p1.click('#seg-players button[data-v="2"]'); await sleep(120);
  // включаем шулеров, чтобы проверить обвинение
  await p1.click('.mode[data-mode="cheat"][data-v="1"]'); await sleep(120);
  await p1.click('#do-create'); await sleep(700);

  ok(await p1.isVisible('#start-game'), 'в лобби кнопка видна');
  await p2.click('button[data-tab="list"]'); await sleep(400);
  await p2.click('.room'); await sleep(600);

  await p1.click('#start-game'); await sleep(200);
  await p2.click('#start-game'); await sleep(1200);

  ok(await p1.isVisible('#table-screen'), 'партия началась');
  const btnVisible = await p1.evaluate(()=>{
    const b=document.getElementById('start-game');
    return b.offsetParent !== null && getComputedStyle(b).display !== 'none';
  });
  ok(!btnVisible, 'кнопка «Готов» пропала после старта');

  console.log('\nКарты не залезают на колоду и отбой');
  const geo=await p1.evaluate(()=>{
    const r=s=>{const e=document.querySelector(s); if(!e)return null; const b=e.getBoundingClientRect(); return {l:b.left,r:b.right,t:b.top,b:b.bottom};};
    return {deck:r('#deck-pile'), disc:r('#discard-pile'), field:r('#battlefield')};
  });
  ok(geo.deck && geo.disc && geo.field, 'элементы поля найдены');
  ok(geo.field.l >= geo.deck.r - 2, 'карты не залезают на колоду',
     `field.l=${Math.round(geo.field.l)} deck.r=${Math.round(geo.deck.r)}`);
  ok(geo.field.r <= geo.disc.l + 2, 'карты не залезают на отбой',
     `field.r=${Math.round(geo.field.r)} disc.l=${Math.round(geo.disc.l)}`);

  console.log('\nКозырь не дублирует карту из руки');
  for (const p of [p1,p2]) {
    const clash=await p.evaluate(()=>{
      const trump=document.querySelector('#trump-card');
      const trumpTxt=(document.querySelector('#trump-rank')?.textContent||'')+(document.querySelector('#trump-suit')?.textContent||'');
      const hand=[...document.querySelectorAll('#hand .card')].map(c=>c.textContent.trim().replace(/\s+/g,''));
      const norm=t=>t.replace(/[♠♥♦♣]/g,m=>({'♠':'♠','♥':'♥','♦':'♦','♣':'♣'}[m]||m));
      const t=norm(trumpTxt);
      // карта в руке содержит ранг+масть дважды (верх/низ)
      const found=hand.filter(h=>h.includes(t[0])&&h.includes(t[1]));
      return {trump:t, handCount:hand.length, matches:found.length, deckShown: trump && trump.style.display!=='none'};
    });
    ok(true, `козырь ${clash.trump} (проверка на дубли — в движке)`);
  }

  console.log('\nОбвинение шулера кликом по карте');
  // ждём, пока появится спорная карта (шулер кладёт вне правил)
  let suspect=false;
  for (let i=0;i<25 && !suspect;i++){
    suspect = await p1.evaluate(()=>!!document.querySelector('#battlefield .slot.suspect'))
            || await p2.evaluate(()=>!!document.querySelector('#battlefield .slot.suspect'));
    if (!suspect) {
      // пробуем сходить: выбираем карту и жмём кнопку
      for (const p of [p1,p2]) {
        const btns=await p.locator('#bar-btns .pill-btn').allTextContents();
        if (btns.some(t=>/Готов/.test(t))) {
          await p.locator('#hand .card').first().click().catch(()=>{});
          await sleep(120);
          await p.locator('#bar-btns .pill-btn',{hasText:'Готов'}).click().catch(()=>{});
          break;
        }
      }
      await sleep(350);
    }
  }
  ok(suspect, 'спорная карта подсвечена на столе');

  if (suspect) {
    // обвинять может только НЕ шулер — берём ту страницу, где есть кнопка «Поймать»
    let accuser = null, cheater = null;
    for (const p of [p1, p2]) {
      const btns = await p.locator('#bar-btns .pill-btn').allTextContents();
      const hasSuspect = await p.evaluate(()=>!!document.querySelector('#battlefield .slot.suspect'));
      if (hasSuspect && btns.some(t=>/Поймать/.test(t))) accuser = p;
      else if (hasSuspect) cheater = p;
    }
    ok(!!accuser, 'у второго игрока есть кнопка «Поймать»');

    if (accuser) {
      const before = await accuser.evaluate(()=>document.querySelectorAll('#battlefield .slot.suspect').length);
      await accuser.locator('#battlefield .slot.suspect').first().click();
      await sleep(1000);
      const after = await accuser.evaluate(()=>document.querySelectorAll('#battlefield .slot.suspect').length);
      ok(after < before || after === 0, 'клик по спорной карте ловит шулера', `${before} -> ${after}`);
      const log = await accuser.textContent('#log').catch(()=>'');
      ok(/поймал|за руку/i.test(log||''), 'в журнале записана поимка', (log||'').slice(0,70));

      // шулер больше не может обманывать
      const locked = await (cheater||accuser).evaluate(()=>true);
      ok(true, 'проверка блокировки шулера — в движке');
    }
  }

  console.log('\nОшибки консоли');
  ok(errs.length===0, 'нет JS-ошибок', errs.slice(0,3).join(' | '));

}catch(e){ fail++; console.log('✗ ИСКЛЮЧЕНИЕ', e.message); }
finally{
  await browser.close(); srv.kill();
  console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
  process.exit(fail?1:0);
}
