// web/app.js — клиент Mini App «Дурак» v8
const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();

// Высота приложения: берём реальную высоту видимой области Telegram.
// 100vh в мини-приложении при запуске по ссылке не совпадает с экраном (особенно до expand),
// поэтому высоту задаём переменной и обновляем при каждом изменении viewport.
function applyViewportHeight() {
  const h = tg?.viewportStableHeight || tg?.viewportHeight || window.innerHeight;
  document.documentElement.style.setProperty('--app-h', h + 'px');
  if (state?.game) layoutHand($('hand'), state.game.you?.hand?.length || 0);
}
tg?.onEvent?.('viewportChanged', applyViewportHeight);
window.addEventListener('resize', applyViewportHeight);

const $ = (id) => document.getElementById(id);
const SUIT = ['♠', '♥', '♦', '♣'];
const RANK = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };
const isRed = (s) => s === 1 || s === 2;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BOT = 'durak132_game_bot';

const state = {
  me: null, room: null, game: null, selected: null,
  devId: localStorage.getItem('devId') || ('dev-' + Math.random().toString(36).slice(2, 8)),
  createOpts: { maxPlayers: 6, deckSize: 36, podkid: 'all', cheat: true, transfer: true, lossMode: 'classic', bet: 0 },
  friends: [], requests: [],
  pendingJoinId: null, prevScreen: 'profile-screen',
};
localStorage.setItem('devId', state.devId);

// ---------------- WebSocket ----------------
let ws = null, reconnectTimer = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      t: 'auth',
      initData: tg?.initData || '',
      devId: state.devId,
      name: tg?.initDataUnsafe?.user?.first_name || 'Игрок',
    }));
  };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
  ws.onclose = () => { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1500); };
}

function send(obj) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
  else toast('Нет соединения');
}

function handle(m) {
  switch (m.t) {
    case 'auth_ok':
      state.me = m.profile;
      renderProfile(m.profile);
      send({ t: 'lobby_list' });
      send({ t: 'friends' });
      if (state.pendingJoinId) { const id = state.pendingJoinId; state.pendingJoinId = null; send({ t: 'join', roomId: id }); }
      break;
    case 'auth_fail': toast('Ошибка входа: ' + m.why); break;
    case 'lobby_list': renderRooms(m.rooms); break;
    case 'room':
      state.room = m;
      state.game = m.game;
      if (m.me) {
        const mine = m.players?.find(p => p.id === m.me);
        if (mine?.profile) state.me = { ...state.me, ...mine.profile, balance: mine.coins };
      }
      renderRoom(m);
      break;
    case 'left':
      state.room = null; state.game = null; state.selected = null;
      overShown = false;
      $('overlay').classList.remove('on');
      showTab('profile');
      if (m.reason) toast(m.reason);
      send({ t: 'lobby_list' });
      break;
    case 'friends':
      state.friends = m.friends || [];
      if (m.requests) state.requests = m.requests;
      renderFriends();
      break;
    case 'friend_request':
      state.requests = [...state.requests.filter(r => r.id !== m.from.id), m.from];
      toast(`${m.from.name} хочет добавить вас в друзья`);
      renderFriends();
      break;
    case 'invite':
      if (confirm(`${m.from.name} приглашает вас в лобби ${m.roomId}. Войти?`)) send({ t: 'join', roomId: m.roomId });
      break;
    case 'profile':
      state.prevScreen = SCREENS.find(id => $(id).classList.contains('on')) || 'profile-screen';
      renderOtherProfile(m.profile);
      break;
    case 'notice': toast(m.text); break;
    case 'error': toast(m.why || 'Ошибка'); break;
  }
}

// ---------------- навигация ----------------
const SCREENS = ['profile-screen', 'friends-screen', 'list-screen', 'create-screen', 'room-screen', 'table-screen', 'other-profile-screen'];

function showScreen(id) {
  SCREENS.forEach(s => $(s).classList.toggle('on', s === id));
  $('tabs').style.display = id === 'table-screen' ? 'none' : 'flex';
  if (id !== 'other-profile-screen') state.prevScreen = id;
}

function showTab(tab) {
  [...$('tabs').children].forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
  if (tab === 'profile') showScreen('profile-screen');
  if (tab === 'friends') { showScreen('friends-screen'); send({ t: 'friends' }); }
  if (tab === 'list') { showScreen('list-screen'); send({ t: 'lobby_list' }); }
  if (tab === 'create') showScreen('create-screen');
}

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});

// ---------------- профиль ----------------
function renderProfile(p) {
  if (!p) return;
  $('p-name').textContent = p.name;
  $('p-stats').textContent = `${p.wins} побед · ${p.losses} поражений`;
  $('p-wins').textContent = p.wins;
  $('p-loss').textContent = p.losses;
  $('p-games').textContent = p.games;
  $('p-money').textContent = p.balance ?? 0;
  avatarInto($('p-avatar'), p.photo, p.name);
}

function avatarInto(el, photo, name) {
  if (photo) el.innerHTML = `<img src="${esc(photo)}" alt="" onerror="this.remove()">`;
  else el.innerHTML = `<span class="initial">${esc((name || '?')[0].toUpperCase())}</span>`;
}

// ---------------- друзья ----------------
function renderFriends() {
  const req = $('req-box');
  req.innerHTML = state.requests.length
    ? '<div class="section-title">Заявки</div>' + state.requests.map(r => `
        <div class="person">
          <div class="av">${esc((r.name || '?')[0].toUpperCase())}</div>
          <div class="pn">${esc(r.name)}</div>
          <button class="btn btn-primary btn-small" data-accept="${esc(r.id)}">Принять</button>
        </div>`).join('')
    : '';
  req.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    send({ t: 'friend_accept', playerId: b.dataset.accept });
    state.requests = state.requests.filter(r => r.id !== b.dataset.accept);
    renderFriends();
  }));

  const list = $('friends-list');
  if (!state.friends.length) {
    list.innerHTML = '<div class="empty-note">Пока нет друзей.<br>Нажмите на аватар игрока за столом и отправьте заявку.</div>';
  } else {
    list.innerHTML = state.friends.map(f => `
      <div class="person" data-profile="${esc(f.id)}">
        <div class="av">${f.photo ? `<img src="${esc(f.photo)}" alt="">` : esc((f.name || '?')[0].toUpperCase())}</div>
        <div class="pn">${esc(f.name)}</div>
        <span class="ps"><span class="dot ${f.online ? 'on' : ''}"></span>${f.online ? 'в сети' : 'офлайн'}</span>
      </div>`).join('');
    list.querySelectorAll('[data-profile]').forEach(el => el.addEventListener('click', () => send({ t: 'profile', playerId: el.dataset.profile })));
  }

  const inRoom = !!state.room?.room;
  $('invite-title').style.display = inRoom ? 'block' : 'none';
  $('invite-box').innerHTML = inRoom
    ? state.friends.map(f => `
        <div class="person">
          <div class="av">${esc((f.name || '?')[0].toUpperCase())}</div>
          <div class="pn">${esc(f.name)}</div>
          <button class="btn btn-primary btn-small" data-invite="${esc(f.id)}">Позвать</button>
        </div>`).join('')
    : '';
  $('invite-box').querySelectorAll('[data-invite]').forEach(b => b.addEventListener('click', () => {
    send({ t: 'invite_friend', playerId: b.dataset.invite });
  }));
}

// ---------------- чужой профиль ----------------
function renderOtherProfile(p) {
  if (!p) return;
  $('o-name').textContent = p.name;
  $('o-stats').textContent = p.online ? 'в сети' : 'не в сети';
  $('o-wins').textContent = p.wins;
  $('o-loss').textContent = p.losses;
  $('o-games').textContent = p.games;
  avatarInto($('o-avatar'), p.photo, p.name);

  const box = $('o-actions');
  if (p.isMe) box.innerHTML = '';
  else if (p.isFriend) box.innerHTML = '<div class="empty-note" style="padding:8px">Вы друзья</div>';
  else {
    box.innerHTML = '<button class="btn btn-primary" id="o-add">Добавить в друзья</button>';
    $('o-add').onclick = () => send({ t: 'friend_invite', playerId: p.id });
  }
  showScreen('other-profile-screen');
}

$('other-back').addEventListener('click', () => {
  // если были в игре — возвращаемся на стол, а не в меню
  if (state.prevScreen === 'table-screen' && state.game && state.game.phase !== 'over') {
    showScreen('table-screen');
    renderTable(state.game, state.room);
    return;
  }
  if (state.prevScreen === 'room-screen' && state.room) { showScreen('room-screen'); return; }
  showTab('profile');
});

// ---------------- список столов ----------------
function renderRooms(list) {
  const box = $('rooms');
  if (!list?.length) {
    box.innerHTML = '<div class="empty-note">Открытых столов нет.<br>Создайте свой — вкладка «Создать».</div>';
    return;
  }
  box.innerHTML = list.map(r => `
    <div class="room" data-id="${esc(r.id)}">
      <div class="room-info">
        <div class="room-id">${esc(r.id)} ${r.locked ? '<span class="badge gray">🔒</span>' : ''}</div>
        <div class="room-meta">
          ${r.players}/${r.maxPlayers} · колода ${r.deckSize} ·
          ${r.podkid === 'all' ? 'все подкидывают' : 'соседи'}
          ${r.transfer ? ' · переводной' : ''}${r.cheat ? ' · шулеры' : ''}
          ${r.bet ? ` · <span class="bet-note">${r.bet} ₽</span>` : ''}
        </div>
      </div>
      <button class="btn btn-ghost btn-small" ${r.inGame ? 'disabled' : ''}>${r.inGame ? 'идёт' : 'войти'}</button>
    </div>`).join('');

  box.querySelectorAll('.room').forEach(el => el.addEventListener('click', () => {
    const r = list.find(x => x.id === el.dataset.id);
    if (r?.inGame) return toast('Игра уже идёт');
    let pw = null;
    if (r.locked) { pw = prompt('Пароль лобби:'); if (pw === null) return; }
    send({ t: 'join', roomId: el.dataset.id, password: pw });
  }));
}

$('refresh').addEventListener('click', () => send({ t: 'lobby_list' }));

// ---------------- создание ----------------
document.querySelectorAll('#seg-players button').forEach(b => b.addEventListener('click', () => {
  state.createOpts.maxPlayers = Number(b.dataset.v);
  document.querySelectorAll('#seg-players button').forEach(x => x.classList.toggle('on', x === b));
}));
document.querySelectorAll('#seg-deck button').forEach(b => b.addEventListener('click', () => {
  state.createOpts.deckSize = Number(b.dataset.v);
  document.querySelectorAll('#seg-deck button').forEach(x => x.classList.toggle('on', x === b));
}));
document.querySelectorAll('.mode').forEach(btn => btn.addEventListener('click', () => {
  const { mode, v } = btn.dataset;
  document.querySelectorAll(`.mode[data-mode="${mode}"]`).forEach(x => x.classList.toggle('on', x === btn));
  if (mode === 'podkid') state.createOpts.podkid = v;
  if (mode === 'cheat') state.createOpts.cheat = v === '1';
  if (mode === 'transfer') state.createOpts.transfer = v === '1';
  if (mode === 'lossMode') state.createOpts.lossMode = v;
}));

const betRange = $('bet-range');
const BET_MAX = 10000;

function setBet(v) {
  v = Math.max(0, Math.min(BET_MAX, Math.round(Number(v) || 0)));
  state.createOpts.bet = v;
  $('bet-value').textContent = v;
  // ползунок показывает значение, если оно ≤ 2500; выше — ползунок на максимуме
  betRange.value = String(Math.min(2500, v - (v % 50)));
  betRange.style.setProperty('--p', (Math.min(v, 2500) / 2500 * 100) + '%');
}

betRange.addEventListener('input', () => setBet(Number(betRange.value)));

// ручной ввод: нажали на сумму — появилось поле
$('bet-value').addEventListener('click', () => {
  const v = prompt('Введите ставку (от 0 до 10000 ₽, кратно 50):', String(state.createOpts.bet));
  if (v === null) return;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return toast('Введите число от 0 до 10000');
  if (n > BET_MAX) { toast('Максимальная ставка 10000 ₽'); return setBet(BET_MAX); }
  setBet(n);
});

$('do-create').addEventListener('click', () => {
  send({ t: 'create', opts: state.createOpts, password: $('password').value.trim() || null });
});

// ---------------- лобби ----------------
$('leave-room').addEventListener('click', () => send({ t: 'leave' }));

function inviteLinkFor(id) { return `https://t.me/${BOT}?startapp=lobby_${id}`; }

$('invite-link').addEventListener('click', () => {
  const id = state.room?.room?.id; if (!id) return;
  const link = inviteLinkFor(id);
  if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Заходи в дурака')}`);
  else navigator.clipboard?.writeText(link).then(() => toast('Ссылка скопирована'));
});
$('copy-room').addEventListener('click', () => {
  const id = state.room?.room?.id; if (!id) return;
  navigator.clipboard?.writeText(inviteLinkFor(id)).then(() => toast('Ссылка скопирована'));
});
$('start-game').addEventListener('click', () => send({ t: 'ready' }));

function renderRoom(m) {
  if (!m) return;
  const r = m.room;
  const inGame = !!m.game && m.game.phase !== 'over';
  const viewingOther = $('other-profile-screen').classList.contains('on');

  if (inGame) {
    if (!viewingOther) showScreen('table-screen');
    renderTable(m.game, m);
    return;
  }

  if (m.game && m.game.phase === 'over') showOverOnce(m.game, m);
  if (viewingOther) return;
  if (!$('overlay').classList.contains('on')) showScreen('room-screen');

  $('room-title').textContent = 'Лобби ' + r.id;
  $('room-players').innerHTML = m.players.map(p => `
    <div class="room" style="padding:10px">
      <div class="room-info">
        <div class="room-id" style="letter-spacing:0;font-size:14px">
          ${esc(p.name)}
          ${p.id === m.hostId ? '<span class="badge">хост</span>' : ''}
          ${p.id === m.me ? '<span class="badge gray">вы</span>' : ''}
          ${p.online ? '' : '<span class="badge gray">офлайн</span>'}
          ${p.ready ? '<span class="badge">готов ✓</span>' : ''}
        </div>
        <div class="room-meta">₽ ${p.coins ?? 0}</div>
      </div>
    </div>`).join('') +
    Array.from({ length: Math.max(0, r.maxPlayers - m.players.length) })
      .map(() => '<div class="room" style="padding:10px;opacity:.4"><div class="room-info"><div class="room-id" style="letter-spacing:0;font-size:14px">свободное место</div></div></div>').join('');

  $('room-opts').innerHTML = `
    Игроков: <b>${r.players}/${r.maxPlayers}</b> · Колода: <b>${r.deckSize}</b><br>
    Подкидывание: <b>${r.podkid === 'all' ? 'все' : 'соседи'}</b> · Перевод: <b>${r.transfer ? 'да' : 'нет'}</b><br>
    Шулеры: <b>${r.cheat ? 'да' : 'нет'}</b> · Конец: <b>${r.lossMode === 'classic' ? 'классика' : 'ничья'}</b><br>
    Ставка: <b class="bet-note">${r.bet || 0} ₽</b>`;

  const btn = $('start-game');
  const meP = m.players.find(p => p.id === m.me);
  const iAmReady = !!meP?.ready;
  btn.style.display = m.showReady === false ? 'none' : 'block';
  btn.disabled = m.players.length < 2;
  btn.textContent = iAmReady ? 'Вы готовы ✓' : 'Готов';
  btn.style.background = iAmReady ? 'linear-gradient(180deg,#7bc043,#5aa32e)' : 'linear-gradient(180deg,#fff,#e9e4d8)';
  btn.style.color = iAmReady ? '#fff' : '#7a2f2b';

  const readyCount = m.players.filter(p => p.ready).length;
  $('ready-hint').textContent = m.players.length < 2
    ? 'Нужно минимум 2 игрока'
    : `Готовы: ${readyCount} из ${m.players.length}`;
}

// ---------------- карта ----------------
function cardEl(card, { selected = false, dim = false, back = false } = {}) {
  const d = document.createElement('div');
  if (back) { d.className = 'card back'; return d; }
  d.className = 'card ' + (isRed(card.s) ? 'red' : 'black') + (selected ? ' sel' : '') + (dim ? ' dim' : '');
  const face = `${RANK[card.r]}<br>${SUIT[card.s]}`;
  d.innerHTML = `<span class="corner">${face}</span><span class="corner bottom">${face}</span>`;
  d.dataset.id = card.id;
  return d;
}

// ---------------- стол ----------------
let prevHandCount = null;
let prevTableSig = '';
let overShown = false;

function renderTable(g, roomMsg) {
  if (!g) return;
  state.game = g;
  const me = g.you;
  const myPlayer = g.players.find(p => p.id === me?.id);
  const money = roomMsg?.players?.find(p => p.id === me?.id)?.coins ?? state.me?.balance ?? 0;

  $('bet-val').textContent = g.bet || 0;
  $('my-money-top').textContent = money;
  $('my-money').textContent = money;

  // соперники
  $('seats').innerHTML = g.players.filter(p => p.id !== me?.id).map(p => {
    const tag = p.out ? 'вышел'
      : p.passed ? 'пас'
      : p.id === g.attackerId ? 'атакует'
      : p.id === g.defenderId ? 'защита' : '';
    const photo = p.photo
      ? `<img src="${esc(p.photo)}" alt="" onerror="this.remove()">`
      : `<span class="initial">${esc((p.name || '?')[0].toUpperCase())}</span>`;
    return `<div class="seat ${p.id === g.attackerId ? 'turn' : ''} ${p.id === g.defenderId ? 'defender' : ''} ${p.out ? 'out' : ''}" data-profile="${esc(p.id)}">
      <div class="frame">${photo}</div>
      <div class="scount">${p.count}</div>
      <div class="sname">${esc(p.name)}</div>
      <div class="stag">${tag || '&nbsp;'}</div>
      ${p.passed ? '<div class="passed-tag">ПАС</div>' : ''}
    </div>`;
  }).join('');
  $('seats').querySelectorAll('[data-profile]').forEach(el =>
    el.addEventListener('click', () => send({ t: 'profile', playerId: el.dataset.profile })));

  // колода
  $('deck-count').textContent = g.deckCount;
  $('deck-pile').classList.toggle('empty', g.deckCount === 0);
  // козырь: пока есть колода — карта под ней; когда колода кончилась — только символ масти
  const tc = $('trump-card');
  const tcColor = isRed(g.trump) ? 'var(--suit-red)' : 'var(--ink)';
  if (g.deckCount > 0 && g.trumpCard) {
    tc.style.display = 'flex';
    tc.classList.remove('suit-only');
    $('trump-rank').textContent = RANK[g.trumpCard.r];
    $('trump-suit').textContent = SUIT[g.trumpCard.s];
    tc.style.color = tcColor;
  } else {
    tc.style.display = 'flex';
    tc.classList.add('suit-only');
    $('trump-rank').textContent = '';
    $('trump-suit').textContent = SUIT[g.trump];
    tc.style.color = tcColor;
  }

  // отбой
  const ds = $('discard-stack');
  const dn = Math.min(g.discardCount, 8);
  if (ds.childElementCount !== dn) {
    ds.innerHTML = Array.from({ length: dn }, (_, i) => {
      const dx = ((i * 37) % 9) - 4, dy = ((i * 53) % 7) - 3, rot = ((i * 29) % 13) - 6;
      return `<div class="dcard" style="left:${2 + dx}px;top:${2 + dy}px;transform:rotate(${rot}deg)"></div>`;
    }).join('');
  }
  $('discard-count').textContent = g.discardCount;

  // карты на столе
  const bf = $('battlefield');
  const sig = JSON.stringify([g.table.map(s => [s.attack.id, s.defense?.id]), g.you?.canTransfer]);
  if (sig !== prevTableSig) {
    bf.innerHTML = '';
    g.table.forEach(slot => {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.attackId = slot.attack.id;
      // шулерская карта ничем не выделена: проверка доступна по нажатию на ЛЮБУЮ карту на столе
      const a = cardEl(slot.attack, { dim: !!slot.defense });
      a.classList.add('atk');
      a.addEventListener('click', (ev) => { ev.stopPropagation(); checkTableCard(slot.attack.id); });
      s.appendChild(a);
      if (slot.defense) {
        const df = cardEl(slot.defense);
        df.classList.add('def');
        df.addEventListener('click', (ev) => { ev.stopPropagation(); checkTableCard(slot.defense.id); });
        s.appendChild(df);
      }
      bf.appendChild(s);
    });
    // зона перевода — только пока защитник и ничего не отбито
    if (me?.canTransfer) {
      const z = document.createElement('div');
      z.className = 'transfer-zone';
      z.id = 'transfer-zone';
      z.textContent = 'ПЕРЕВОД';
      bf.appendChild(z);
    }
    prevTableSig = sig;
  }

  // баннер фазы
  const banner = $('phase-banner');
  const defName = g.players.find(x => x.id === g.defenderId)?.name || '';
  if (g.takePhase?.active) {
    banner.innerHTML = g.takePhase.allPassed
      ? (me?.canConfirmTake ? 'Все сказали <b>пас</b> — забирайте' : `Ждём, пока <b>${esc(defName)}</b> заберёт`)
      : me?.isDefender
        ? `Вы берёте. Ждём:<br><b>${esc(g.takePhase.waitingFor.join(', ') || '—')}</b>`
        : `<b>${esc(defName)}</b> берёт. Подкиньте или <b>пас</b>`;
    banner.classList.remove('hide');
  } else if (g.podkidPhase?.active) {
    banner.innerHTML = `Бито. Подкиньте карту или <b>пас</b>`;
    banner.classList.remove('hide');
  } else {
    banner.classList.add('hide');
  }

  $('log').innerHTML = (g.log || []).slice(-2).map(l => esc(l.text)).join('<br>');

  // свой блок
  avatarInto($('my-avatar'), myPlayer?.photo || state.me?.photo, myPlayer?.name || state.me?.name);
  $('my-count').textContent = me?.hand?.length ?? 0;
  $('my-name').textContent = myPlayer?.name || 'Вы';
  $('me-wrap').classList.toggle('turn', !!me?.isAttacker);
  $('me-wrap').classList.toggle('defend', !!me?.isDefender);

  const canUndo = !!me?.recallable && (me.recallsLeft ?? 0) > 0;
  $('undo-btn').disabled = !canUndo;
  $('undo-left').textContent = me?.recallsLeft ?? 0;

  renderHand(g, me);
  renderBar(g);
}

// ---------------- рука ----------------
// Каждая карта позиционируется абсолютно внутри .hand (position:relative).
// left = startX + i*step. Гарантирует: рука не вылезает за экран, угол виден.
const CARD_W = 52;
const CARD_MIN_W = 30;
const MIN_VISIBLE = 24;

function layoutHand(handEl, count) {
  const cards = [...handEl.querySelectorAll('.card')];
  const n = cards.length;
  if (!n) return;

  const pad = 6;
  const avail = Math.max(120, (handEl.clientWidth || window.innerWidth) - pad * 2);

  let cardW = CARD_W;
  if (n > 1 && CARD_W + (n - 1) * MIN_VISIBLE > avail) {
    cardW = Math.max(CARD_MIN_W, Math.floor(avail - (n - 1) * MIN_VISIBLE));
  }

  let step = cardW;
  if (n > 1) step = Math.max(1, Math.min(cardW, (avail - cardW) / (n - 1)));

  const totalW = cardW + (n - 1) * step;
  const startX = pad + Math.max(0, (avail - totalW) / 2);
  const cardH = Math.round(cardW * 1.42);

  handEl.style.height = cardH + 'px';

  cards.forEach((c, i) => {
    c.style.position = 'absolute';
    c.style.bottom = '0';
    c.style.left = Math.round(startX + i * step) + 'px';
    c.style.width = cardW + 'px';
    c.style.height = cardH + 'px';
    c.style.fontSize = Math.max(10, Math.round(cardW * 0.31)) + 'px';
    c.style.zIndex = String(i + 1);
  });
}

function renderHand(g, me) {
  const hand = $('hand');
  const cards = me?.hand || [];
  const prev = prevHandCount;
  const fresh = prev !== null && cards.length > prev;

  hand.innerHTML = '';
  cards.forEach((c) => {
    const el = cardEl(c, { selected: state.selected === c.id });
    el.classList.add('in-hand');
    attachGesture(el, c, g);
    hand.appendChild(el);
  });
  prevHandCount = cards.length;
  layoutHand(hand, cards.length);
  if (fresh) dealAnimation(cards.length - prev);
}

function dealAnimation(n) {
  const deck = $('deck-pile').getBoundingClientRect();
  const hand = $('hand').getBoundingClientRect();
  for (let i = 0; i < Math.min(n, 6); i++) {
    const c = document.createElement('div');
    c.className = 'card back flying';
    c.style.width = '50px'; c.style.height = '72px';
    c.style.left = deck.left + 'px'; c.style.top = deck.top + 'px';
    document.body.appendChild(c);
    const dx = hand.left + hand.width / 2 - deck.left - 25;
    const dy = hand.top - deck.top;
    const anim = c.animate(
      [{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${dx}px,${dy}px) rotate(${(i - 2) * 6}deg)` }],
      { duration: 400, delay: i * 100, easing: 'ease-out', fill: 'forwards' }
    );
    anim.onfinish = () => c.remove();
  }
}

// ---------------- проверка карт на столе ----------------
// Любой игрок (не владелец карты) может проверить любую карту на столе, сколько угодно раз.
// Сервер сам решает: нарушение — карта уходит шулеру; по правилам — ничего не происходит.
function checkTableCard(cardId) {
  const g = state.game;
  if (!g || !g.table.length) return;
  if (!g.opts?.cheat) return;            // в режиме без шулеров проверки нет
  send({ t: 'act', action: 'checkCard', cardId });
}

// ---------------- кнопки ----------------
const ICONS = {
  take: '<svg viewBox="0 0 24 24"><path d="M17 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-7 4v6l4-3z"/></svg>',
  pass: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
};

function hint(box, html) {
  const h = document.createElement('div');
  h.className = 'bar-hint';
  h.innerHTML = html;
  box.appendChild(h);
}

// Понятный ход: кто ходит — подсвечен; свой ход — плашка и пульс руки
function markTurn(g) {
  const me = g.you;
  const myTurn = !!me && (me.isAttacker || me.isDefender || me.canPodkid || me.canTransfer
    || (g.takePhase?.active && !me.isDefender && !me.passed)
    || (g.podkidPhase?.active && !me.isDefender && !me.passed));
  $('hand').classList.toggle('my-turn', myTurn);
  $('me-wrap').classList.toggle('turn', !!me?.isAttacker);

  let text = '';
  if (g.phase === 'over') text = '';
  else if (g.takePhase?.active) {
    text = me?.isDefender ? 'Вы берёте — ждём подкидывания'
      : (me?.passed ? 'Вы сказали пас' : 'Подкиньте карту или скажите пас');
  } else if (g.podkidPhase?.active) {
    text = me?.isDefender ? 'Ждём подкидывания'
      : (me?.passed ? 'Вы сказали пас' : 'Бито — подкиньте карту или пас');
  } else if (me?.isDefender) text = 'Ваш ход — отбивайтесь или берите';
  else if (me?.isAttacker && g.table.length === 0) text = 'Ваш ход — выложите карту';
  else if (me?.isAttacker) text = 'Подкиньте карту или нажмите «Бито»';
  else if (me?.canPodkid) text = 'Можно подкинуть карту';

  const turnBox = $('turn-banner');
  turnBox.textContent = text;
  turnBox.classList.toggle('hide', !text);
  turnBox.classList.toggle('mine', myTurn);

  // подсветка аватарок соперников: тот, чей сейчас ход
  document.querySelectorAll('#seats .seat').forEach(el => {
    const id = el.dataset.profile;
    el.classList.toggle('turn', id === g.attackerId && !g.takePhase && !g.podkidPhase);
    el.classList.toggle('defender', id === g.defenderId);
  });
}

function renderBar(g) {
  const me = g.you;
  const box = $('bar-btns');
  box.innerHTML = '';
  markTurn(g);
  if (!me || g.phase === 'over') return;

  const table = g.table || [];
  const undefended = table.filter(s => !s.defense);

  const addBtn = (cls, label, sub, icon, fn, disabled = false) => {
    const b = document.createElement('button');
    b.className = 'pill-btn ' + cls;
    b.innerHTML = `${icon || ''}<span>${label}</span>${sub ? `<span class="sub">${sub}</span>` : ''}`;
    b.disabled = disabled;
    b.onclick = fn;
    box.appendChild(b);
    return b;
  };

  // фаза «беру»
  if (g.takePhase?.active) {
    if (me.isDefender) {
      addBtn('take', 'Забрать', me.canConfirmTake ? 'готово' : 'ждём', ICONS.take,
        () => send({ t: 'act', action: 'confirmTake' }), !me.canConfirmTake);
      return;
    }
    if (me.passed) { hint(box, 'Вы сказали <b>пас</b>'); return; }
    hint(box, 'Свайп на стол<br>или <b>пас</b>');
    addBtn('pass', 'Пас', 'больше нет', ICONS.pass, () => send({ t: 'act', action: 'passPodkid' }));
    return;
  }

  // после «Бито»
  if (g.podkidPhase?.active) {
    if (me.passed) { hint(box, 'Вы сказали <b>пас</b>'); return; }
    if (me.isDefender) { hint(box, 'Ждём подкидывания'); return; }
    hint(box, 'Свайп на стол<br>или <b>пас</b>');
    addBtn('pass', 'Пас', 'больше нет', ICONS.pass, () => send({ t: 'act', action: 'passPodkid' }));
    return;
  }

  if (me.isDefender) {
    hint(box, me.canTransfer ? 'Карту в зону<br><b>ПЕРЕВОД</b>' : 'Карту на нужную ⇢');
    addBtn('take', 'Беру', 'себе', ICONS.take, () => { send({ t: 'act', action: 'take' }); state.selected = null; });
    return;
  }

  // атакующие
  if (me.isAttacker || me.canPodkid) hint(box, 'Свайп карты<br>на стол');
  if (me.isAttacker && table.length > 0 && undefended.length === 0) {
    addBtn('pass', 'Бито', 'закрыть', ICONS.pass, () => send({ t: 'act', action: 'endBout' }));
  }
}

// ---------------- жесты ----------------
let lastTouchAt = 0;

function beatsLocal(card, target, trump) {
  if (!card || !target) return false;
  if (card.s === target.s) return card.r > target.r;
  return card.s === trump && target.s !== trump;
}

function hitElementAt(x, y, selector) {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 12 && y <= r.bottom + 12) return el;
  }
  return null;
}

function attachGesture(el, card, g) {
  let sx = 0, sy = 0, st = 0, moved = false, ghost = null;
  const pt = (e) => (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;

  const onStart = (e) => {
    if (e.type === 'mousedown' && Date.now() - lastTouchAt < 700) return;
    if (e.type === 'touchstart') lastTouchAt = Date.now();
    const t = pt(e); sx = t.clientX; sy = t.clientY; st = Date.now(); moved = false;
  };

  const onMove = (e) => {
    if (e.type === 'mousemove' && Date.now() - lastTouchAt < 700) return;
    const t = pt(e); if (!t) return;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (!moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      moved = true;
      if (dy < -6 || Math.abs(dx) > 12) {
        ghost = el.cloneNode(true);
        ghost.className = 'card drag-ghost ' + (isRed(card.s) ? 'red' : 'black');
        ghost.style.width = el.offsetWidth + 'px';
        ghost.style.height = el.offsetHeight + 'px';
        document.body.appendChild(ghost);
        el.style.opacity = '0.25';
      }
    }
    if (!ghost) return;
    ghost.style.left = t.clientX + 'px';
    ghost.style.top = t.clientY + 'px';
    if (e.cancelable) e.preventDefault();

    document.querySelectorAll('.slot.target,.slot.invalid,.transfer-zone.hot').forEach(x =>
      x.classList.remove('target', 'invalid', 'hot'));
    const z = hitElementAt(t.clientX, t.clientY, '#transfer-zone');
    if (z && g.you?.canTransfer) { z.classList.add('hot'); return; }
    const slot = hitElementAt(t.clientX, t.clientY, '#battlefield .slot');
    if (slot && g.you?.isDefender && !g.takePhase && !g.podkidPhase) {
      const entry = g.table.find(s => s.attack.id === slot.dataset.attackId);
      const ok = entry && !entry.defense && beatsLocal(card, entry.attack, g.trump);
      slot.classList.add(ok ? 'target' : 'invalid');
    }
  };

  const onEnd = (e) => {
    if (e.type === 'mouseup' && Date.now() - lastTouchAt < 700) return;
    const t = pt(e) || { clientX: sx, clientY: sy };
    const dt = Date.now() - st;
    if (ghost) { ghost.remove(); ghost = null; }
    el.style.opacity = '';
    document.querySelectorAll('.slot.target,.slot.invalid,.transfer-zone.hot').forEach(x =>
      x.classList.remove('target', 'invalid', 'hot'));

    if (!moved && dt < 600) {
      state.selected = state.selected === card.id ? null : card.id;
      renderTable(state.game, state.room);
      return;
    }
    if (!moved) return renderTable(state.game, state.room);

    const me = g.you;
    if (!me) return renderTable(state.game, state.room);

    // перевод
    if (me.canTransfer && hitElementAt(t.clientX, t.clientY, '#transfer-zone')) {
      send({ t: 'act', action: 'transfer', cardId: card.id });
      state.selected = null;
      return;
    }

    // защита: бросили на карту
    if (me.isDefender) {
      const slot = hitElementAt(t.clientX, t.clientY, '#battlefield .slot');
      if (!slot) { toast('Перетащите карту на ту, которую бьёте'); return renderTable(state.game, state.room); }
      const entry = g.table.find(s => s.attack.id === slot.dataset.attackId);
      if (!entry || entry.defense) return renderTable(state.game, state.room);
      if (!beatsLocal(card, entry.attack, g.trump)) {
        toast(`${RANK[card.r]}${SUIT[card.s]} не бьёт ${RANK[entry.attack.r]}${SUIT[entry.attack.s]}`);
        return renderTable(state.game, state.room);
      }
      send({ t: 'act', action: 'defend', cardId: card.id, targetCardId: entry.attack.id });
      state.selected = null;
      return;
    }

    // атака/подкидывание
    const field = $('field').getBoundingClientRect();
    const overField = t.clientY < field.bottom + 50 && t.clientY > field.top - 90;
    if (overField && (me.isAttacker || me.canPodkid || g.takePhase?.active || g.podkidPhase?.active)) {
      send({ t: 'act', action: 'attack', cardId: card.id, cheat: !!g.opts?.cheat });
      state.selected = null;
      return;
    }
    renderTable(state.game, state.room);
  };

  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: false });
  el.addEventListener('touchend', onEnd);
  el.addEventListener('touchcancel', onEnd);
  el.addEventListener('mousedown', onStart);
  el.addEventListener('mousemove', onMove);
  el.addEventListener('mouseup', onEnd);
}

$('undo-btn').addEventListener('click', () => {
  const id = state.game?.you?.recallable;
  if (!id) return toast('Нечего возвращать');
  send({ t: 'act', action: 'recall', cardId: id });
});

$('exit-game').addEventListener('click', () => {
  const g = state.game;
  if (!g || g.phase === 'over') { send({ t: 'leave' }); return; }
  if (!confirm('Выйти из партии? Вам засчитается поражение, ставка уйдёт игрокам.')) return;
  send({ t: 'surrender' });
});

// ---------------- итог ----------------
function showOverOnce(g, roomMsg) {
  if (overShown) return;
  overShown = true;
  const iLost = g.losers?.includes(g.you?.id);
  const pay = g.payouts?.[g.you?.id];
  const bet = g.bet || 0;
  $('over-title').textContent = iLost ? 'Вы проиграли' : 'Победа!';
  const names = g.players.filter(p => g.losers?.includes(p.id)).map(p => p.name);
  $('over-text').innerHTML = names.length
    ? (names.length === 1 ? `Дурак: ${esc(names[0])}` : `Проигравшие: ${esc(names.join(', '))}`)
    : '';
  $('over-money').textContent = bet > 0 ? (pay > 0 ? `+${pay} ₽` : (iLost ? `−${bet} ₽` : '')) : '';
  $('overlay').classList.add('on');
}

$('over-close').addEventListener('click', () => {
  $('overlay').classList.remove('on');
  overShown = false;
  showScreen('room-screen');
});

// ---------------- утилиты ----------------
let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
}

window.addEventListener('resize', () => {
  if (state.game) layoutHand($('hand'), state.game.you?.hand?.length || 0);
});
window.addEventListener('orientationchange', () => setTimeout(() => {
  if (state.game) layoutHand($('hand'), state.game.you?.hand?.length || 0);
}, 250));

function parseStartParam() {
  const sp = tg?.initDataUnsafe?.start_param
    || new URLSearchParams(location.search).get('tgWebAppStartParam') || '';
  const m = /lobby_([A-Za-z0-9]+)/.exec(sp);
  return m ? m[1].toUpperCase() : null;
}

// хук для автотестов
window.__durak = { layoutHand, state, get screen() { return SCREENS.find(id => $(id).classList.contains('on')); } };

state.pendingJoinId = parseStartParam();
applyViewportHeight();
setTimeout(applyViewportHeight, 300);
showTab('profile');
connect();
