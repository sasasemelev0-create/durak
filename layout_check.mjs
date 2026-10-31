// Проверка раскладки руки на разных экранах
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 3601, sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '', NO_LISTEN: '' }, cwd: '/home/user/durak-v6', stdio: ['ignore', 'ignore', 'pipe'] });
await sleep(1200);
const browser = await chromium.launch();
let bad = 0;

for (const [vw, vh] of [[320,568],[360,640],[390,844],[400,860],[430,932],[412,1000]]) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem('devId', 'lc' + Math.random().toString(36).slice(2, 8)));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await sleep(400);
  await p.evaluate(() => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
    document.getElementById('table-screen').classList.add('on');
    document.getElementById('tabs').style.display = 'none';
  });
  for (const n of [6, 8, 10, 12, 15, 18]) {
    const r = await p.evaluate((count) => {
      const hand = document.getElementById('hand');
      hand.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const d = document.createElement('div');
        d.className = 'card';
        d.innerHTML = '<span class="corner">10<br>♠</span><span class="bottom corner">10<br>♠</span>';
        hand.appendChild(d);
      }
      window.__durak.layoutHand(hand, count);
      const cards = [...hand.querySelectorAll('.card')];
      const rects = cards.map(c => c.getBoundingClientRect());
      return {
        cardW: Math.round(rects[0].width),
        step: rects.length > 1 ? Math.round(rects[1].left - rects[0].left) : Math.round(rects[0].width),
        left: Math.round(rects[0].left),
        right: Math.round(rects[rects.length - 1].right),
        vw: innerWidth
      };
    }, n);
    const fits = r.left >= -1 && r.right <= r.vw + 1;
    const readable = r.step >= 14;
    if (!fits || !readable) bad++;
    if (!fits || !readable) console.log(`  ✗ ${vw}px / ${n} карт: ${r.left}..${r.right}/${r.vw}, шаг ${r.step}`);
  }
  console.log(`  ✓ ${vw}x${vh}: раскладка проверена`);
  await ctx.close();
}
await browser.close(); srv.kill();
console.log(bad === 0 ? '\nВСЁ ОК: раскладка помещается на всех экранах' : `\nПРОБЛЕМ: ${bad}`);
process.exit(bad ? 1 : 0);
