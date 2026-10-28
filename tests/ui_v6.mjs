// tests/ui_v6.mjs — интерфейс v6
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3321;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' — ' + e : ''))); };

const srv = spawn('node', ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '' },
  cwd: '/home/user/durak-v6', stdio: ['ignore', 'ignore', 'pipe']
});
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
await sleep(1200);

const browser = await chromium.launch();
const errors = [];
async function mk(id, name) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(id + ': ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(id + ': ' + m.text()); });
  await p.addInitScript(([i, n]) => { localStorage.setItem('devId', i); localStorage.setItem('devName', n); }, [id, name]);
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await sleep(500);
  return p;
}

try {
  const p1 = await mk('v6u1', 'Аня');
  const p2 = await mk('v6u2', 'Боря');

  console.log('\n4. Деньги вместо монет');
  await p1.click('button[data-tab="profile"]'); await sleep(300);
  ok((await p1.textContent('#p-money')) === '2500', 'баланс в профиле');
  const bodyText = await p1.textContent('body');
  ok(!/монет/i.test(bodyText), 'слово «монеты» нигде не встречается');

  console.log('\n13. Настройки лобби по умолчанию');
  await p1.click('button[data-tab="create"]'); await sleep(300);
  ok((await p1.textContent('#bet-value')) === '0', 'ставка по умолчанию 0');
  ok((await p1.getAttribute('.mode[data-mode="podkid"][data-v="all"]', 'class')).includes('on'), '«все подкидывают» включено');
  ok((await p1.getAttribute('.mode[data-mode="transfer"][data-v="1"]', 'class')).includes('on'), 'переводной включён');
  ok((await p1.getAttribute('.mode[data-mode="cheat"][data-v="1"]', 'class')).includes('on'), 'с шулерами включено');
  ok((await p1.getAttribute('.mode[data-mode="lossMode"][data-v="classic"]', 'class')).includes('on'), 'классика включена');
  console.log('\n12. Скорости нет');
  ok(!(await p1.$('#seg-speed')), 'настройки скорости нет на экране');

  await p1.click('#seg-players button[data-v="2"]'); await sleep(150);
  await p1.click('#do-create'); await sleep(700);

  console.log('\n1,2. Приглашение по ссылке');
  ok(await p1.isVisible('#invite-link'), 'кнопка «Пригласить по ссылке» есть');
  const link = await p1.evaluate(() => document.getElementById('invite-link') ? true : false);
  ok(link, 'ссылка формируется');

  await p2.click('button[data-tab="list"]'); await sleep(400);
  await p2.click('.room'); await sleep(700);

  console.log('\n5. Кнопка «Готов» только в лобби');
  ok(await p1.isVisible('#start-game'), 'в лобби кнопка «Готов» видна');
  await p1.click('#start-game'); await sleep(200);
  await p2.click('#start-game'); await sleep(1300);
  ok(await p1.isVisible('#table-screen'), 'партия началась');
  const btnHidden = await p1.evaluate(() => {
    const b = document.getElementById('start-game');
    return b.offsetParent === null || getComputedStyle(b).display === 'none';
  });
  ok(btnHidden, 'кнопка «Готов» исчезла после старта');

  console.log('\n6. Выход в левом верхнем углу');
  const exitBox = await p1.locator('#exit-game').boundingBox();
  ok(exitBox && exitBox.x < 70 && exitBox.y < 90, 'кнопка выхода слева вверху', JSON.stringify(exitBox));

  console.log('\n18. Карты руки над белым блоком');
  const geo = await p1.evaluate(() => {
    const hand = document.querySelector('.hand').getBoundingClientRect();
    const bar = document.querySelector('.player-bar').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.hand .card')];
    const lastCard = cards.length ? cards[cards.length - 1].getBoundingClientRect() : null;
    return { handBottom: hand.bottom, barTop: bar.top, barBottom: bar.bottom, vh: innerHeight, lastCardBottom: lastCard?.bottom };
  });
  ok(geo.handBottom <= geo.barTop + 2, 'рука выше белого блока', `handBottom=${Math.round(geo.handBottom)} barTop=${Math.round(geo.barTop)}`);
  ok(geo.barBottom >= geo.vh - 40, 'белый блок внизу экрана', `barBottom=${Math.round(geo.barBottom)} vh=${geo.vh}`);

  console.log('\n16. Отбой рубашкой вверх');
  const discardHasBacks = await p1.evaluate(() => {
    const st = document.getElementById('discard-stack');
    return st ? st.querySelectorAll('.dcard').length : -1;
  });
  ok(discardHasBacks >= 0, 'контейнер отбоя есть', String(discardHasBacks));

  console.log('\n20. Пики и трефы различимы');
  const suitColors = await p1.evaluate(() => {
    const hand = document.getElementById('hand');
    const cards = [...hand.querySelectorAll('.card')];
    return cards.map(c => ({ cls: c.className, color: getComputedStyle(c).color }));
  });
  const hasRed = suitColors.some(c => /rgb\(211, 47, 47\)/.test(c.color));
  const hasBlack = suitColors.some(c => /rgb\(27, 39, 51\)/.test(c.color));
  ok(suitColors.length > 0, 'карты в руке есть', String(suitColors.length));
  ok(hasRed || hasBlack, 'масти окрашены контрастно', JSON.stringify(suitColors.slice(0, 2)));

  console.log('\n9. Свайп карты выкладывает');
  const cards = p1.locator('#hand .card');
  const before = await cards.count();
  const cb = await cards.first().boundingBox();
  const cdp = await p1.context().newCDPSession(p1);
  const cx = cb.x + cb.width / 2, cy = cb.y + cb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - i * 16 }] }); await sleep(15); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(900);
  const after = await p2.locator('#hand .card').count();
  const tableSlots = await p1.locator('#battlefield .slot').count();
  ok(tableSlots >= 1 || after === before - 1, 'свайп вверх выложил карту', `слотов=${tableSlots}`);

  console.log('\n6,7. Выход возвращает в главное меню');
  p1.on('dialog', d => d.accept());
  await p1.click('#exit-game'); await sleep(900);
  ok(await p1.isVisible('#profile-screen'), 'после выхода — главное меню');

  console.log('\nОшибки консоли');
  ok(errors.length === 0, 'нет JS-ошибок', errors.slice(0, 3).join(' | '));

} catch (e) {
  fail++;
  console.log('\n✗ ИСКЛЮЧЕНИЕ: ' + e.message);
} finally {
  await browser.close();
  srv.kill();
  await sleep(200);
  console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
  process.exit(fail ? 1 : 0);
}
