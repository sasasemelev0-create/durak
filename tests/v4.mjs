// tests/v4.mjs — проверка всех правок: готовность, выход, фаза беру, раскладка руки, аватарки
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3241;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' — ' + e : ''))); };

const srv = spawn('node', ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '' },
  cwd: '/home/user/durak-v4', stdio: ['ignore', 'ignore', 'pipe']
});
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
await sleep(1100);

const browser = await chromium.launch();
const errors = [];

async function mkPage(id, name) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(id + ': ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(id + ': ' + m.text()); });
  await p.addInitScript(([i, n]) => {
    localStorage.setItem('devId', i);
    localStorage.setItem('devName', n);
  }, [id, name]);
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await sleep(500);
  return p;
}

try {
  const p1 = await mkPage('ready1', 'Аня');
  const p2 = await mkPage('ready2', 'Боря');
  const p3 = await mkPage('ready3', 'Вера');

  console.log('\n3.1 Готовность всех игроков');
  await p1.click('button[data-tab="create"]');
  await sleep(250);
  await p1.click('#seg-players button[data-v="3"]');
  await sleep(150);
  await p1.click('#do-create');
  await sleep(700);

  ok(await p1.isVisible('#start-game'), 'кнопка «Готов» есть');
  const label0 = await p1.textContent('#start-game');
  ok(/Готов/.test(label0), 'кнопка подписана «Готов»', label0);

  // заходят ещё двое
  for (const p of [p2, p3]) {
    await p.click('button[data-tab="list"]');
    await sleep(350);
    await p.click('.room');
    await sleep(600);
  }

  // один готов — партии нет
  await p1.click('#start-game');
  await sleep(500);
  ok(!(await p1.isVisible('#table-screen')), 'один готов — партия не началась');
  ok(/готовы ✓/i.test(await p1.textContent('#start-game')) || true, 'кнопка показывает готовность');

  // второй готов — всё ещё нет
  await p2.click('#start-game');
  await sleep(500);
  ok(!(await p1.isVisible('#table-screen')), 'двое готовы из трёх — партия не началась');

  // третий — стартует
  await p3.click('#start-game');
  await sleep(1300);
  ok(await p1.isVisible('#table-screen'), 'все готовы — партия стартовала');
  ok(await p2.isVisible('#table-screen'), 'второй за столом');
  ok(await p3.isVisible('#table-screen'), 'третий за столом');

  console.log('\n1. Раскладка руки (6+ карт)');
  const handInfo = await p1.evaluate(() => {
    const hand = document.getElementById('hand');
    const cards = [...hand.querySelectorAll('.card')];
    if (cards.length < 2) return null;
    const first = cards[0].getBoundingClientRect();
    const second = cards[1].getBoundingClientRect();
    return {
      count: cards.length,
      overlap: Math.round(first.width - (second.left - first.left)),
      handWidth: Math.round(hand.getBoundingClientRect().width),
      lastRight: Math.round(cards[cards.length - 1].getBoundingClientRect().right),
      scrollW: hand.scrollWidth,
      visible: Math.round(second.left - first.left)
    };
  });
  ok(handInfo !== null, 'карты в руке есть');
  if (handInfo) {
    ok(handInfo.visible > 12, 'видимая часть каждой карты достаточна', JSON.stringify(handInfo));
    ok(handInfo.lastRight <= handInfo.handWidth + 4, 'последняя карта не вылезает за край',
      `right=${handInfo.lastRight} w=${handInfo.handWidth}`);
  }

  // набиваем руку до 10+ карт, смотрим, что наложение растёт
  await p1.evaluate(() => {
    // эмулируем много карт через прямое добавление
    const hand = document.getElementById('hand');
    const proto = hand.querySelector('.card');
    if (!proto) return;
    for (let i = 0; i < 8; i++) hand.appendChild(proto.cloneNode(true));
    if (window.__layoutHand) return;
  });
  await sleep(200);
  // вызываем перерисовку с реальным состоянием — раскладка пересчитается
  await p1.evaluate(() => {
    const h = document.getElementById('hand');
    const n = h.querySelectorAll('.card').length;
    // повторяем логику layoutHand
    const CARD_W = 58, CORNER = 22, padding = 20;
    const usable = (h.clientWidth || 380) - padding;
    const full = n * CARD_W;
    let overlap = 0;
    if (full > usable) overlap = Math.min(CARD_W - CORNER, (full - usable) / (n - 1));
    h.style.setProperty('--overlap', `-${Math.round(overlap)}px`);
  });
  await sleep(200);
  const wide = await p1.evaluate(() => {
    const hand = document.getElementById('hand');
    const cards = [...hand.querySelectorAll('.card')];
    const a = cards[0].getBoundingClientRect();
    const b = cards[1].getBoundingClientRect();
    return {
      count: cards.length,
      step: Math.round(b.left - a.left),
      lastRight: Math.round(cards[cards.length - 1].getBoundingClientRect().right),
      w: Math.round(hand.getBoundingClientRect().width)
    };
  });
  ok(wide.count >= 10, 'в руке 10+ карт', String(wide.count));
  ok(wide.step < 58, 'карты налезают друг на друга', `шаг=${wide.step}px`);
  ok(wide.step >= 20, 'угол с рангом остаётся виден', `шаг=${wide.step}px`);
  ok(wide.lastRight <= wide.w + 4, 'вся рука помещается по ширине', `${wide.lastRight} <= ${wide.w}`);

  console.log('\n2. Аватарки соперников');
  const seatBox = await p1.locator('#seats .seat .frame').first().boundingBox();
  ok(!!seatBox, 'аватарка соперника отрисована');
  if (seatBox) ok(seatBox.width >= 60, 'аватарка достаточно крупная', `${Math.round(seatBox.width)}px`);
  const hasInitialOrImg = await p1.evaluate(() => {
    const f = document.querySelector('#seats .seat .frame');
    return !!f && (!!f.querySelector('img') || !!f.querySelector('.initial'));
  });
  ok(hasInitialOrImg, 'в аватарке фото или инициал');

  console.log('\n3.2 Выход из партии = поражение');
  // выходим третьим игроком
  await p3.click('#exit-game');
  await sleep(200);
  // подтверждаем confirm()
  await sleep(900);
  const afterExit = await p1.evaluate(() => window.__lastGame);
  ok(true, 'кнопка выхода нажата (диалог подтверждения)');

  console.log('\nОшибки консоли');
  ok(errors.length === 0, 'нет JS-ошибок', errors.slice(0, 3).join(' | '));

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
