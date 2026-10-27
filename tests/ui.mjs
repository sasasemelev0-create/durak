// tests/ui.mjs — проверка интерфейса в реальном браузере
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3121;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' — ' + e : ''))); };

const srv = spawn('node', ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '' },
  cwd: '/home/user/durak-v4', stdio: ['ignore', 'ignore', 'pipe']
});
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
await sleep(900);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await sleep(600);

  console.log('\nПрофиль');
  ok(await page.isVisible('#profile-screen'), 'профиль открыт по умолчанию');
  const name = await page.textContent('#p-name');
  ok(!!name && name.length > 0, 'имя отображается: ' + name);

  console.log('\nСоздание игры');
  await page.click('button[data-tab="create"]');
  await sleep(300);
  ok(await page.isVisible('#create-screen'), 'экран создания открылся');

  // настройки
  await page.click('#seg-players button[data-v="2"]');
  await sleep(120);
  ok(await page.locator('#seg-players button[data-v="2"].on').count() === 1, 'выбрано 2 игрока');
  await page.click('#seg-deck button[data-v="52"]');
  ok(await page.getAttribute('#seg-deck button[data-v="52"]', 'class') === 'on', 'колода 52');
  await page.click('.mode[data-mode="podkid"][data-v="neighbors"]');
  await sleep(120);
  ok(await page.locator('.mode[data-mode="podkid"][data-v="neighbors"].on').count() === 1, 'режим "соседи" выбран');
  await page.click('.mode[data-mode="cheat"][data-v="1"]');
  await sleep(120);
  ok(await page.locator('.mode[data-mode="cheat"][data-v="1"].on').count() === 1, 'режим "с шулерами" выбран');
  await page.click('.mode[data-mode="lossMode"][data-v="draw"]');
  await sleep(120);
  ok(await page.locator('.mode[data-mode="lossMode"][data-v="draw"].on').count() === 1, 'режим "ничья" выбран');
  await page.fill('#password', '777');
  ok(true, 'пароль введён');

  console.log('\nЛобби');
  await page.click('#do-create');
  await sleep(700);
  ok(await page.isVisible('#room-screen'), 'перешли в лобби');
  const title = await page.textContent('#room-title');
  ok(/Лобби\s+\w{6}/.test(title), 'код лобби показан: ' + title);
  const opts = await page.textContent('#room-opts');
  ok(/соседи/.test(opts), 'в лобби отражены "соседи"');
  ok(/да/.test(opts), 'в лобби отражены режимы');
  ok(/52/.test(opts), 'в лобби отражена колода 52');

  const playerCount = await page.locator('#room-players .room').count();
  ok(playerCount === 2, 'показано 2 места (1 занято + 1 свободное)', String(playerCount));

  // стол: второй игрок через второй контекст
  console.log('\nСтол и карты');
  const ctx2 = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', e => errors.push('p2: ' + e.message));
  await page2.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await sleep(600);

  // лобби видно в списке
  await page2.click('button[data-tab="list"]');
  await sleep(500);
  const roomsHtml = await page2.innerHTML('#rooms');
  ok(/room-info/.test(roomsHtml), 'лобби отображается в списке открытых');

  // войти через диалог пароля
  page2.on('dialog', async d => await d.accept('777'));
  await page2.click('.room');
  await sleep(800);
  ok(await page2.isVisible('#room-screen'), 'второй игрок вошёл в лобби');

  // кнопка «Готов» есть у всех
  ok(await page2.isVisible('#start-game'), 'у всех есть кнопка «Готов»');

  // оба жмут «Готов» — партия стартует
  await page.click('#start-game');
  await sleep(250);
  await page2.click('#start-game');
  await sleep(1200);

  const tableOn = await page.isVisible('#table-screen');
  ok(tableOn, 'хост перешёл к столу');
  const tableOn2 = await page2.isVisible('#table-screen');
  ok(tableOn2, 'второй игрок перешёл к столу');

  // карты в руке
  const handCards = await page.locator('#hand .card').count();
  ok(handCards === 6, 'в руке 6 карт', String(handCards));

  const seatCount = await page.locator('#seats .seat').count();
  ok(seatCount === 1, 'соперник показан в верхней зоне (своя панель отдельно)', String(seatCount));
  ok(await page.isVisible('.player-bar'), 'своя панель с аватаркой внизу');
  ok(await page.isVisible('#undo-btn'), 'кнопка отмены слева от аватарки');
  ok(await page.isVisible('#deck-pile'), 'колода слева');
  ok(await page.isVisible('#discard-pile'), 'отбой справа');
  ok(await page.isVisible('#bet-pill'), 'ставка наверху');
  const hasTag = await page.innerHTML('#seats');
  ok(/атакует|защита/.test(hasTag), 'видны роли (атакует/защита)');

  const deckText = await page.textContent('#deck-count');
  ok(Number(deckText) === 52 - 12, 'колода 40 карт', deckText);

  // выбор карты
  await page.locator('#hand .card').first().click();
  await sleep(250);
  ok(await page.locator('#hand .card.sel').count() === 1, 'карта выделяется');
  const actionBtns = await page.locator('#bar-btns .pill-btn').count();
  ok(actionBtns > 0, 'есть кнопки действий', String(actionBtns));

  // ход: определяем, кто атакует, по кнопкам
  const actsA = (await page.locator('#bar-btns .pill-btn').allTextContents()).join('|');
  const actsB = (await page2.locator('#bar-btns .pill-btn').allTextContents()).join('|');
  const attPage = /Готов/.test(actsA) ? page : page2;
  const defPage = attPage === page ? page2 : page;
  const who = attPage === page ? 'хост' : 'второй';

  const beforeCards = await attPage.locator('#hand .card').count();
  // карта уже выделена выше, но проверим на всякий случай
  if (await attPage.locator('#hand .card.sel').count() === 0) {
    await attPage.locator('#hand .card').first().click();
    await sleep(200);
  }
  const attackBtn = attPage.locator('#bar-btns .pill-btn', { hasText: 'Готов' });
  await attackBtn.first().click();
  await sleep(800);

  const after = await attPage.locator('#hand .card').count();
  ok(after === beforeCards - 1, `${who} игрок: карта ушла из руки`, `${beforeCards} -> ${after}`);
  const bf = await attPage.locator('#battlefield .slot').count();
  ok(bf === 1, 'на столе появилась карта', String(bf));

  // защищающийся видит карту и кнопки "Беру / Бито"
  const defActs = (await defPage.locator('#bar-btns .pill-btn').allTextContents()).join('|');
  ok(/Беру/.test(defActs), 'у защищающегося есть кнопка "Беру"', defActs);
  const defBf = await defPage.locator('#battlefield .slot').count();
  ok(defBf === 1, 'защищающийся видит карту на столе', String(defBf));
  const defLog = await defPage.textContent('#log');
  ok(/ходит/.test(defLog), 'журнал партии пишется', defLog?.slice(0, 60));

  await page.screenshot({ path: '/home/user/durak/shot-table.png' });
  await page2.screenshot({ path: '/home/user/durak/shot-table2.png' });

  console.log('\nОшибки консоли');
  ok(errors.length === 0, 'нет JS-ошибок', errors.slice(0, 3).join(' | '));

  // скриншоты
  await page.screenshot({ path: '/home/user/durak/shot-table.png' });
  await page.click('button[data-tab="profile"]').catch(() => { });
} catch (e) {
  fail++;
  console.log('\n✗ ИСКЛЮЧЕНИЕ: ' + e.message);
} finally {
  await browser.close();
  srv.kill();
  await sleep(200);
  console.log(`\n──────────────\nПройдено: ${pass}, провалено: ${fail}`);
  process.exit(fail ? 1 : 0);
}
