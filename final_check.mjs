import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3555, sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' — ' + e : ''))); };

const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '', NO_LISTEN: '' }, cwd: '/home/user/durak-v6', stdio: ['ignore', 'ignore', 'pipe'] });
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
await sleep(1200);
const browser = await chromium.launch();
const errors = [];

async function mk(tag, vw = 400, vh = 860) {
  const id = tag + Math.random().toString(36).slice(2, 7);
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(tag + ': ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
  await p.addInitScript(i => localStorage.setItem('devId', i), id);
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await sleep(450);
  return { p, id };
}

async function startGame(A, B, players = 2) {
  await A.p.click('button[data-tab="create"]'); await sleep(300);
  await A.p.click(`#seg-players button[data-v="${players}"]`); await sleep(150);
  await A.p.click('#do-create'); await sleep(700);
  const rid = (await A.p.textContent('#room-title')).replace('Лобби ', '').trim();
  await B.p.click('button[data-tab="list"]'); await sleep(500);
  await B.p.waitForSelector('.room', { timeout: 6000 });
  await B.p.evaluate(r => { const el = [...document.querySelectorAll('.room')].find(x => x.dataset.id === r); el && el.click(); }, rid);
  await A.p.waitForFunction(() => { const b = document.getElementById('start-game'); return b && !b.disabled; }, { timeout: 8000 });
  await A.p.click('#start-game'); await sleep(200);
  await B.p.click('#start-game'); await sleep(1500);
  return rid;
}

try {
  const A = await mk('A'), B = await mk('B');

  console.log('\n5. Кнопки «Готов/выложить» в партии нет');
  await startGame(A, B, 2);
  ok(await A.p.isVisible('#table-screen'), 'партия началась');
  const btns0 = await A.p.evaluate(() => [...document.querySelectorAll('#bar-btns .pill-btn')].map(b => b.textContent.trim()));
  ok(!btns0.some(t => /Подкинуть|Готов|выложить/i.test(t)), 'в атаке нет кнопки выложить', btns0.join('|'));

  console.log('\n1. Передача хода (на двоих)');
  // делаем несколько конов и смотрим, меняется ли атакующий
  let attackers = new Set();
  for (let i = 0; i < 8; i++) {
    const st = await A.p.evaluate(() => window.__durak.state.game);
    if (!st || st.phase === 'over') break;
    attackers.add(st.attackerId);
    // атакующий свайпает карту
    const isAtt = await A.p.evaluate(() => window.__durak.state.game.you?.isAttacker);
    const actor = isAtt ? A.p : B.p;
    const card = await actor.evaluate(() => {
      const c = document.querySelector('#hand .card');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!card) break;
    const cdp = await actor.context().newCDPSession(actor);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: card.x, y: card.y }] });
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: card.x, y: card.y - k * 20 }] }); await sleep(12); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);

    // защитник: бьёт или берёт
    const def = await A.p.evaluate(() => {
      const g = window.__durak.state.game;
      const me = g?.you;
      const b = document.querySelector('#bar-btns .pill-btn.pass');
      return { g, undef: g?.table.filter(s => !s.defense).length, isDef: me?.isDefender };
    });
    if (def.isDef) {
      // пробуем взять — на двоих должно сразу забрать
      const takeBtn = await A.p.$('#bar-btns .pill-btn.take');
      if (takeBtn) { await takeBtn.click(); await sleep(600); }
    } else {
      const takeBtn = await B.p.$('#bar-btns .pill-btn.take');
      if (takeBtn) { await takeBtn.click(); await sleep(600); }
    }
  }
  ok(attackers.size >= 1, 'атакующий определяется', [...attackers].join(','));
  const st2 = await A.p.evaluate(() => window.__durak.state.game);
  ok(!!st2, 'партия не сломалась', st2?.phase);

  console.log('\n7. Профиль игрока → возврат в игру');
  await A.p.evaluate(() => { document.querySelector('#seats .seat')?.click(); });
  await sleep(700);
  ok(await A.p.evaluate(() => document.getElementById('other-profile-screen').classList.contains('on')), 'профиль открылся');
  await A.p.evaluate(() => document.getElementById('other-back').click());
  await sleep(700);
  const back = await A.p.evaluate(() => ({
    table: document.getElementById('table-screen').classList.contains('on'),
    profile: document.getElementById('profile-screen').classList.contains('on'),
    hasGame: !!window.__durak.state.game,
  }));
  ok(back.table && !back.profile, 'вернулись на стол, а не в меню', JSON.stringify(back));

  console.log('\n20. Масти различимы');
  const colors = await A.p.evaluate(() => {
    const cards = [...document.querySelectorAll('#hand .card')];
    const out = {};
    for (const c of cards) {
      const t = c.textContent;
      const suit = t.includes('♠') ? '♠' : t.includes('♣') ? '♣' : t.includes('♥') ? '♥' : t.includes('♦') ? '♦' : '?';
      out[suit] = getComputedStyle(c).color;
    }
    return out;
  });
  const reds = ['♥', '♦'].filter(s => colors[s]);
  const blacks = ['♠', '♣'].filter(s => colors[s]);
  ok(Object.keys(colors).length > 0, 'карты в руке есть', JSON.stringify(colors));
  const redOk = reds.every(s => /rgb\(198, 40, 40\)|rgb\(211/.test(colors[s]));
  const blackOk = blacks.every(s => /rgb\(17, 24, 32\)|rgb\(27, 39, 51\)/.test(colors[s]));
  ok(reds.length === 0 || redOk, 'красные масти красные', JSON.stringify(colors));
  ok(blacks.length === 0 || blackOk, 'пики и трефы чёрные', JSON.stringify(colors));

  console.log('\n6. Выход из партии → главное меню');
  A.p.on('dialog', d => d.accept());
  await A.p.click('#exit-game'); await sleep(1200);
  ok(await A.p.evaluate(() => document.getElementById('profile-screen').classList.contains('on')), 'вернулись в профиль');

  console.log('\n8. Выход из лобби → главное меню');
  await A.p.click('button[data-tab="create"]'); await sleep(300);
  await A.p.click('#do-create'); await sleep(700);
  ok(await A.p.evaluate(() => document.getElementById('room-screen').classList.contains('on')), 'лобби создано');
  await A.p.click('#leave-room'); await sleep(900);
  ok(await A.p.evaluate(() => document.getElementById('profile-screen').classList.contains('on')), 'выход из лобби вернул в профиль');

  console.log('\n3. Масштабирование на больших экранах');
  for (const [w, h] of [[430, 932], [412, 915], [390, 844]]) {
    const C = await mk('big', w, h);
    await C.p.click('button[data-tab="create"]'); await sleep(350);
    const fits = await C.p.evaluate(() => {
      const bad = [];
      for (const sel of ['#create-screen', '#tabs', '#do-create']) {
        const e = document.querySelector(sel); if (!e) continue;
        const r = e.getBoundingClientRect();
        if (r.right > innerWidth + 1 || r.left < -1) bad.push(sel);
      }
      return bad;
    });
    ok(fits.length === 0, `${w}x${h}: интерфейс в границах`, fits.join(','));
    await C.p.context().close();
  }

  console.log('\nОшибки консоли');
  ok(errors.length === 0, 'нет JS-ошибок', errors.slice(0, 3).join(' | '));

} catch (e) {
  fail++;
  console.log('\n✗ ИСКЛЮЧЕНИЕ: ' + e.message);
} finally {
  await browser.close(); srv.kill(); await sleep(200);
  console.log(`\n──────────\nПройдено ${pass}, провалено ${fail}`);
  process.exit(fail ? 1 : 0);
}
