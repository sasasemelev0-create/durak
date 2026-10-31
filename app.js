// web/app.js — клиент Mini App «Дурак» (v6)
const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();
tg?.setHeaderColor?.('#2a5a7a');
tg?.setBackgroundColor?.('#2a5a7a');
tg?.disableVerticalSwipes?.();

const $ = (id) => document.getElementById(id);
const SUIT = ['♠', '♥', '♦', '♣'];
const RANK = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };
const isRed = (s) => s === 1 || s === 2;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BOT = 'durak132_game_bot';

const state = {
  me: null,            // свой профиль
  room: null,          // последнее состояние лобби/партии
  game: null,          // состояние партии (publicState)
  selected: null,      // выбранная карта (id)
  devId: localStorage.getItem('devId') || ('dev-' + Math.random().toString(36).slice(2, 8)),
  devName: localStorage.getItem('devName') || 'Игрок',
  createOpts: { maxPlayers: 6, deckSize: 36, podkid: 'all', cheat: true, transfer: true, lossMode: 'classic', bet: 0 },
  friends: [], requests: [],
  pendingJoinId: null,
};
localStorage.setItem('devId', state.devId);

// ---------- WebSocket ----------
let ws = null, reconnectTimer = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      t: 'auth',
      initData: tg?.initData || '',
      devId: state.devId,
      name: tg?.initDataUnsafe?.user?.first_name || state.devName,
    }));
  };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    handle(m);
  };
  ws.onclose = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  };
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
      if (state.pendingJoinId) {
        const id = state.pendingJoinId; state.pendingJoinId = null;
        send({ t: 'join', roomId: id });
      }
      break;
    case 'auth_fail': toast('Ошибка входа: ' + m.why); break;
    case 'lobby_list': renderRooms(m.rooms); break;
    case 'room':
      state.room = m;
      state.game = m.game;
      if (m.me) {
        const mine = m.players?.find(p => p.id === m.me);
        if (mine) state.me = { ...state.me, ...mine.profile, balance: mine.coins };
      }
      renderRoom(m);
      break;
    case 'left':
      // вышли из лобби или партии — в главное меню
      state.room = null; state.game = null; state.selected = null;
      overShown = false;
      $('overlay').classList.remove('on');
      showTab('profile');
      if (m.reason) toast(m.reason);
      send({ t: 'lobby_list' });
      break;
    case 'friends':
      state.friends = m.friends || [];
      state.requests = m.requests || state.requests;
      renderFriends();
      break;
    case 'friend_request':
      state.requests = [...state.requests.filter(r => r.id !== m.from.id), m.from];
      toast(`${m.from.name} хочет добавить вас в друзья`);
      renderFriends();
      break;
    case 'invite': showInvite(m); break;
    case 'profile':
      // открываем профиль ПОВЕРХ текущего экрана, чтобы вернуться в игру
      state.prevScreen = SCREENS.find(id => $(id).classList.contains('on')) || 'profile-screen';
      renderOtherProfile(m.profile);
      break;
    case 'notice': toast(m.text); break;
    case 'error': toast(m.why || 'Ошибка'); break;
  }
}

// ---------- навигация ----------
const SCREENS = ['profile-screen', 'friends-screen', 'list-screen', 'create-screen', 'room-screen', 'table-screen', 'other-profile-screen'];
function showScreen(id) {
  SCREENS.forEach(s => $(s).classList.toggle('on', s === id));
  const inTable = id === 'table-screen';
  $('tabs').style.display = inTable ? 'none' : 'flex';
  // запоминаем экран, чтобы профиль игрока мог вернуть обратно
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

// ---------- профиль ----------
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

// ---------- друзья ----------
function renderFriends() {
  const req = $('req-box');
  req.innerHTML = state.requests.length
    ? `<div class="section-title">Заявки</div>` + state.requests.map(r => `
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
  }));

  const list = $('friends-list');
  if (!state.friends.length) {
    list.innerHTML = '<div class="empty-note">Пока нет друзей.<br>Откройте профиль игрока за столом и отправьте заявку, или поделитесь ссылкой приглашения.</div>';
  } else {
    list.innerHTML = state.friends.map(f => `
      <div class="person" data-profile="${esc(f.id)}">
        <div class="av">${f.photo ? `<img src="${esc(f.photo)}" alt="">` : esc((f.name || '?')[0].toUpperCase())}</div>
        <div class="pn">${esc(f.name)}</div>
        <span class="ps"><span class="dot ${f.online ? 'on' : ''}"></span>${f.online ? 'в сети' : 'не в сети'}</span>
      </div>`).join('');
    list.querySelectorAll('[data-profile]').forEach(el => el.addEventListener('click', () => send({ t: 'profile', playerId: el.dataset.profile })));
  }

  // пригласить друзей в текущее лобби
  const inRoom = !!state.room?.room && !state.room.room.closed;
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

function showInvite(m) {
  // приглашение от друга — подтверждение входа
  const ok = confirm(`${m.from.name} приглашает вас в лобби ${m.roomId}. Войти?`);
  if (ok) send({ t: 'join', roomId: m.roomId });
}

// ---------- чужой профиль ----------
function renderOtherProfile(p) {
  if (!p) return;
  $('o-name').textContent = p.name;
  $('o-stats').textContent = `${p.online ? 'в сети' : 'не в сети'}`;
  $('o-wins').textContent = p.wins;
  $('o-loss').textContent = p.losses;
  $('o-games').textContent = p.games;
  avatarInto($('o-avatar'), p.photo, p.name);
  const box = $('o-actions');
  if (p.isMe) {
    box.innerHTML = '';
  } else if (p.isFriend) {
    box.innerHTML = '<div class="empty-note" style="padding:8px">Вы друзья</div>';
  } else {
    box.innerHTML = '<button class="btn btn-primary" id="o-add">Добавить в друзья</button>';
    $('o-add').onclick = () => { send({ t: 'friend_invite', playerId: p.id }); };
  }
  showScreen('other-profile-screen');
}
$('other-back').addEventListener('click', () => {
  const back = state.prevScreen;
  // если мы были в партии — возвращаемся на стол, а не в меню
  if (back === 'table-screen' && state.game && state.game.phase !== 'over') {
    showScreen('table-screen');
    renderTable(state.game, state.room);
    return;
  }
  if (back === 'room-screen' && state.room) { showScreen('room-screen'); return; }
  showTab('profile');
});

// ---------- список лобби ----------
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
          ${r.players}/${r.maxPlayers} игроков · колода ${r.deckSize} ·
          ${r.podkid === 'all' ? 'все подкидывают' : 'только соседи'}
          ${r.transfer ? ' · переводной' : ''}${r.cheat ? ' · с шулерами' : ''}
          ${r.bet ? ` · ставка <span class="bet-note">${r.bet} ₽</span>` : ''}
        </div>
      </div>
      <button class="btn btn-ghost btn-small" ${r.inGame ? 'disabled' : ''}>${r.inGame ? 'идёт' : 'войти'}</button>
    </div>`).join('');

  box.querySelectorAll('.room').forEach(el => {
    el.addEventListener('click', () => {
      const r = list.find(x => x.id === el.dataset.id);
      if (r?.inGame) return toast('Игра уже идёт');
      let pw = null;
      if (r.locked) { pw = prompt('Пароль лобби:'); if (pw === null) return; }
      send({ t: 'join', roomId: el.dataset.id, password: pw });
    });
  });
}
$('refresh').addEventListener('click', () => send({ t: 'lobby_list' }));

// ---------- создание лобби ----------
function selSeg(sel, btn) {
  document.querySelectorAll(sel + ' button').forEach(x => x.classList.toggle('on', x === btn));
}
document.querySelectorAll('#seg-players button').forEach(b => b.addEventListener('click', () => {
  state.createOpts.maxPlayers = Number(b.dataset.v); selSeg('#seg-players', b);
}));
document.querySelectorAll('#seg-deck button').forEach(b => b.addEventListener('click', () => {
  state.createOpts.deckSize = Number(b.dataset.v); selSeg('#seg-deck', b);
}));
document.querySelectorAll('.mode').forEach(btn => btn.addEventListener('click', () => {
  const mode = btn.dataset.mode, v = btn.dataset.v;
  document.querySelectorAll(`.mode[data-mode="${mode}"]`).forEach(x => x.classList.toggle('on', x === btn));
  if (mode === 'podkid') state.createOpts.podkid = v;
  if (mode === 'cheat') state.createOpts.cheat = v === '1';
  if (mode === 'transfer') state.createOpts.transfer = v === '1';
  if (mode === 'lossMode') state.createOpts.lossMode = v;
}));

const betRange = $('bet-range');
function syncBet() {
  const v = Number(betRange.value);
  $('bet-value').textContent = v;
  state.createOpts.bet = v;
  betRange.style.setProperty('--p', (v / Number(betRange.max)) * 100 + '%');
}
betRange.addEventListener('input', syncBet);
syncBet();

$('do-create').addEventListener('click', () => {
  send({ t: 'create', opts: state.createOpts, password: $('password').value.trim() || null });
});

// ---------- лобби ----------
$('leave-room').addEventListener('click', () => send({ t: 'leave' }));

function inviteLinkFor(roomId) {
  return `https://t.me/${BOT}?startapp=lobby_${roomId}`;
}
$('invite-link').addEventListener('click', () => {
  const id = state.room?.room?.id;
  if (!id) return;
  const link = inviteLinkFor(id);
  if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Заходи в дурака')}`);
  else navigator.clipboard?.writeText(link).then(() => toast('Ссылка скопирована'));
});
$('copy-room').addEventListener('click', () => {
  const id = state.room?.room?.id;
  if (!id) return;
  navigator.clipboard?.writeText(inviteLinkFor(id)).then(() => toast('Ссылка скопирована'));
});

// «Готов» — только в лобби
$('start-game').addEventListener('click', () => send({ t: 'ready' }));

function renderRoom(m) {
  if (!m) return;
  const r = m.room;
  const inGame = !!m.game && m.game.phase !== 'over';

  // Если игрок открыл чужой профиль — не выдёргиваем его оттуда,
  // а просто обновляем данные стола в фоне
  const viewingOther = $('other-profile-screen').classList.contains('on');

  // партия идёт — показываем стол
  if (inGame) {
    if (!viewingOther) showScreen('table-screen');
    renderTable(m.game, m);
    return;
  }
  // иначе — лобби (и итог прошлой партии)
  if (m.game && m.game.phase === 'over') {
    showOverOnce(m.game, m);
  }
  if (viewingOther) return;   // остаёмся в профиле игрока
  if (!$('table-screen').classList.contains('on') || !m.game) {
    if (!$('overlay').classList.contains('on')) showScreen('room-screen');
  }

  $('room-title').textContent = 'Лобби ' + r.id;
  $('room-players').innerHTML = m.players.map(p => `
    <div class="room" style="padding:10px">
      <div class="room-info">
        <div class="room-id" style="letter-spacing:0;font-size:14px">
          ${esc(p.name)} ${p.id === m.hostId ? '<span class="badge">хост</span>' : ''}
          ${p.id === m.me ? '<span class="badge gray">вы</span>' : ''}
          ${p.online ? '' : '<span class="badge gray">офлайн</span>'}
          ${p.ready ? '<span class="badge">готов ✓</span>' : ''}
        </div>
        <div class="room-meta">₽ ${p.coins ?? 0}</div>
      </div>
    </div>`).join('') +
    Array.from({ length: Math.max(0, r.maxPlayers - m.players.length) })
      .map(() => `<div class="room" style="padding:10px;opacity:.4"><div class="room-info"><div class="room-id" style="letter-spacing:0;font-size:14px">свободное место</div></div></div>`).join('');

  $('room-opts').innerHTML = `
    Игроков: <b>${r.players}/${r.maxPlayers}</b> · Колода: <b>${r.deckSize}</b><br>
    Подкидывание: <b>${r.podkid === 'all' ? 'все' : 'соседи'}</b> · Перевод: <b>${r.transfer ? 'да' : 'нет'}</b><br>
    Шулеры: <b>${r.cheat ? 'да' : 'нет'}</b> · Конец: <b>${r.lossMode === 'classic' ? 'классика' : 'ничья'}</b><br>
    Ставка: <b class="bet-note">${r.bet || 0} ₽</b>`;

  // кнопка «Готов» — до старта
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

// ---------- карта ----------
function cardEl(card, { selected = false, dim = false, back = false } = {}) {
  const d = document.createElement('div');
  if (back) { d.className = 'card back'; return d; }
  const red = isRed(card.s);
  d.className = 'card ' + (red ? 'red' : 'black') + (selected ? ' sel' : '') + (dim ? ' dim' : '');
  d.innerHTML = `<span class="corner">${RANK[card.r]}<br>${SUIT[card.s]}</span>
                 <span class="bottom corner">${RANK[card.r]}<br>${SUIT[card.s]}</span>`;
  d.dataset.id = card.id;
  return d;
}

// ---------- стол ----------
let prevHandCount = null;
let prevTableSig = '';
let prevDeckCount = null;
let overShown = false;

function renderTable(g, roomMsg) {
  if (!g) return;
  state.game = g;
  const me = g.you;
  const myPlayer = g.players.find(p => p.id === me?.id);

  // верх: ставка и баланс
  $('bet-val').textContent = g.bet || 0;
  const money = roomMsg?.players?.find(p => p.id === me?.id)?.coins ?? state.me?.balance ?? 0;
  $('my-money-top').textContent = money;
  $('my-money').textContent = money;

  // места соперников (без себя)
  $('seats').innerHTML = g.players.filter(p => p.id !== me?.id).map(p => {
    const tag = p.out ? 'вышел'
      : p.passed ? 'пас'
      : p.id === g.attackerId ? 'атакует'
      : p.id === g.defenderId ? 'защита' : '';
    const photo = p.photo ? `<img src="${esc(p.photo)}" alt="" onerror="this.remove()">`
                          : `<span class="initial">${esc((p.name || '?')[0].toUpperCase())}</span>`;
    return `<div class="seat ${p.id === g.attackerId ? 'turn' : ''} ${p.id === g.defenderId ? 'defender' : ''} ${p.out ? 'out' : ''}" data-profile="${esc(p.id)}">
      <div class="frame">${photo}</div>
      <div class="scount">${p.count}</div>
      <div class="sname">${esc(p.name)}</div>
      <div class="stag">${tag || '&nbsp;'}</div>
      ${p.passed ? '<div class="passed-tag">ПАС</div>' : ''}
    </div>`;
  }).join('');
  $('seats').querySelectorAll('[data-profile]').forEach(el => el.addEventListener('click', () => send({ t: 'profile', playerId: el.dataset.profile })));

  // колода и козырь (рубашкой вверх; козырь торчит снизу)
  $('deck-count').textContent = g.deckCount;
  $('deck-pile').classList.toggle('empty', g.deckCount === 0);
  if (g.deckCount > 0 && g.trumpCard) {
    $('trump-card').style.display = 'flex';
    $('trump-rank').textContent = RANK[g.trumpCard.r];
    $('trump-suit').textContent = SUIT[g.trumpCard.s];
    $('trump-card').style.color = isRed(g.trumpCard.s) ? 'var(--red)' : 'var(--black)';
  } else {
    $('trump-card').style.display = 'none';
  }

  // отбой: небрежно лежащие карты рубашкой вверх
  const ds = $('discard-stack');
  const dn = Math.min(g.discardCount, 8);
  if (ds.childElementCount !== dn) {
    ds.innerHTML = Array.from({ length: dn }, (_, i) => {
      const dx = ((i * 37) % 9) - 4, dy = ((i * 53) % 7) - 3, rot = ((i * 29) % 13) - 6;
      return `<div class="dcard" style="left:${3 + dx}px;top:${3 + dy}px;transform:rotate(${rot}deg)"></div>`;
    }).join('');
  }
  $('discard-count').textContent = g.discardCount;

  // поле: карты на столе
  const bf = $('battlefield');
  const sig = JSON.stringify(g.table.map(s => [s.attack.id, s.defense?.id]));
  if (sig !== prevTableSig) {
    bf.innerHTML = '';
    const suspicion = g.pendingCheat?.cardId || null;
    g.table.forEach(slot => {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.attackId = slot.attack.id;
      if (suspicion && slot.attack.id === suspicion) {
        s.classList.add('suspect');
        s.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (g.you?.id === g.pendingCheat.playerId) return toast('Себя обвинять нельзя');
          send({ t: 'act', action: 'accuse', targetId: g.pendingCheat.playerId });
        });
      }
      const a = cardEl(slot.attack, { dim: !!slot.defense });
      a.classList.add('atk');
      s.appendChild(a);
      if (slot.defense) { const df = cardEl(slot.defense); df.classList.add('def'); s.appendChild(df); }
      bf.appendChild(s);
    });
    prevTableSig = sig;
  }

  // зона перевода — рядом с картой, которой на вас ходят (пока не отбито)
  const oldZone = bf.querySelector('.transfer-zone');
  if (oldZone) oldZone.remove();
  if (me?.canTransfer && g.table.length) {
    const z = document.createElement('div');
    z.className = 'transfer-zone';
    z.id = 'transfer-zone';
    z.innerHTML = 'ПЕРЕВОД';
    bf.appendChild(z);
  }

  // баннер фазы
  const banner = $('phase-banner');
  const defName = g.players.find(x => x.id === g.defenderId)?.name || '';
  if (g.takePhase?.active) {
    banner.innerHTML = g.takePhase.allPassed
      ? (me?.canConfirmTake ? 'Все сказали <b>пас</b> — забирайте карты' : `Ждём, пока <b>${esc(defName)}</b> заберёт`)
      : me?.isDefender
        ? `Вы берёте. Ждём подкидывания:<br><b>${esc(g.takePhase.waitingFor.join(', '))}</b>`
        : `<b>${esc(defName)}</b> берёт. Подкиньте или <b>пас</b>`;
    banner.classList.remove('hide');
  } else if (g.podkidPhase?.active) {
    banner.innerHTML = g.podkidPhase.allPassed
      ? 'Все спасовали — карты уходят в отбой'
      : `Бито. Подкиньте карту или <b>пас</b><br><b>${esc(g.podkidPhase.waitingFor.join(', '))}</b>`;
    banner.classList.remove('hide');
  } else {
    banner.classList.add('hide');
  }

  // журнал
  $('log').innerHTML = (g.log || []).slice(-2).map(l => esc(l.text)).join('<br>');

  // свой блок
  const av = $('my-avatar');
  avatarInto(av, myPlayer?.photo || state.me?.photo, myPlayer?.name || state.me?.name);
  $('my-count').textContent = me?.hand?.length ?? 0;
  $('my-name').textContent = myPlayer?.name || 'Вы';
  $('me-wrap').classList.toggle('turn', !!me?.isAttacker);
  $('me-wrap').classList.toggle('defend', !!me?.isDefender);

  // кнопка отмены
  const canUndo = !!me?.recallable && (me.recallsLeft ?? 0) > 0;
  $('undo-btn').disabled = !canUndo;
  $('undo-left').textContent = me?.recallsLeft ?? 0;

  // рука — раскладка, затем кнопки
  renderHand(g, me);
  renderBar(g);
}

// ---------- рука ----------
// Раскладка руки.
// Каждая карта позиционируется АБСОЛЮТНО: left = startX + i * step.
// Это исключает любые конфликты с CSS-правилами и гарантирует, что
// рука никогда не вылезает за экран, а левый угол каждой карты виден.
const CARD_BASE_W = 52;   // ширина карты по умолчанию
const CARD_MIN_W  = 30;   // меньше — нечитаемо
const MIN_VISIBLE = 24;   // минимум видимой части карты (ранг + масть)

function layoutHand(handEl, count) {
  const cards = [...handEl.querySelectorAll('.card')];
  if (!cards.length) return;

  const n = cards.length;
  const containerW = handEl.clientWidth || handEl.getBoundingClientRect().width || window.innerWidth;
  const PAD = 8;
  const avail = Math.max(120, containerW - PAD * 2);

  // 1. Подбираем ширину карты так, чтобы каждой досталось MIN_VISIBLE
  let cardW = CARD_BASE_W;
  if (n > 1) {
    const needW = CARD_BASE_W + (n - 1) * MIN_VISIBLE;
    if (needW > avail) {
      cardW = Math.floor(avail - (n - 1) * MIN_VISIBLE);
      cardW = Math.max(CARD_MIN_W, Math.min(CARD_BASE_W, cardW));
    }
  }

  // 2. Шаг между картами (видимая часть)
  let step = cardW;
  if (n > 1) {
    step = (avail - cardW) / (n - 1);
    step = Math.max(1, Math.min(cardW, step));
  }

  const totalW = cardW + (n - 1) * step;
  const startX = PAD + Math.max(0, (avail - totalW) / 2);
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
    c.style.marginLeft = '0';
  });
}

function renderHand(g, me) {
  const hand = $('hand');
  const cards = me?.hand || [];
  const prev = prevHandCount;
  // раздача/добор: анимация для новых карт
  const fresh = prev !== null && cards.length > prev;
  hand.innerHTML = '';
  cards.forEach((c, i) => {
    const el = cardEl(c, { selected: state.selected === c.id });
    el.classList.add('in-hand');
    attachGesture(el, c, g);
    hand.appendChild(el);
    if (fresh && i >= prev) el.animate([{ transform: 'translate(0,-20px)', opacity: 0 }, { transform: 'translate(0,0)', opacity: 1 }], { duration: 260, easing: 'ease-out', delay: (i - prev) * 90 });
  });
  prevHandCount = cards.length;
  layoutHand(hand, cards.length);
  if (fresh) dealAnimation(cards.length - prev);
}

// анимация раздачи/добора: рубашки летят из колоды к руке
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
    c.animate([
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: `translate(${dx}px, ${dy}px) rotate(${(i - 2) * 6}deg)` }
    ], { duration: 420, delay: i * 110, easing: 'ease-out', fill: 'forwards' })
      .onfinish = () => c.remove();
  }
}

// ---------- отбой / «Бито» / «Беру» / пасы ----------
function renderBar(g) {
  const me = g.you;
  const box = $('bar-btns');
  box.innerHTML = '';
  if (!me || g.phase === 'over') return;

  const table = g.table || [];
  const undefended = table.filter(s => !s.defense);
  const hasSel = !!state.selected;

  const addBtn = (cls, label, sub, icon, fn, disabled = false) => {
    const b = document.createElement('button');
    b.className = 'pill-btn ' + cls;
    b.innerHTML = `${icon || ''}<span>${label}</span>${sub ? `<span class="sub">${sub}</span>` : ''}`;
    b.disabled = disabled;
    b.onclick = fn;
    box.appendChild(b);
    return b;
  };

  // спорная карта — «Поймать»
  if (g.pendingCheat && g.pendingCheat.playerId !== me.id) {
    addBtn('take', 'Поймать', esc(g.pendingCheat.playerName), ICONS.take, () => {
      send({ t: 'act', action: 'accuse', targetId: g.pendingCheat.playerId });
    });
  }

  // фаза «беру» — окно подкидывания
  if (g.takePhase?.active) {
    if (me.isDefender) {
      // если пас не нужен (на двоих) — кнопка сразу активна
      addBtn('take', 'Забрать', me.canConfirmTake ? 'готово' : 'ждём', ICONS.take,
        () => send({ t: 'act', action: 'confirmTake' }), !me.canConfirmTake);
      return;
    }
    if (me.passed) { hint(box, 'Вы сказали <b>пас</b>'); return; }
    // подкидывание — свайпом карты на стол, кнопки «выложить» нет
    hint(box, 'Свайпните карту<br>на стол или <b>пас</b>');
    addBtn('pass', 'Пас', 'больше нет', ICONS.pass, () => send({ t: 'act', action: 'passPodkid' }));
    return;
  }

  // окно подкидывания после «Бито»
  if (g.podkidPhase?.active) {
    if (me.passed) { hint(box, 'Вы сказали <b>пас</b>'); return; }
    if (me.isDefender) { hint(box, 'Ждём, пока подкинут или спасуют'); return; }
    hint(box, 'Свайпните карту<br>на стол или <b>пас</b>');
    addBtn('pass', 'Пас', 'больше нет', ICONS.pass, () => send({ t: 'act', action: 'passPodkid' }));
    return;
  }

  if (me.isDefender) {
    if (me.canTransfer) {
      hint(box, 'Перетащите карту<br>в зону <b>ПЕРЕВОД</b>');
    } else if (undefended.length) {
      hint(box, 'Перетащите карту<br>на нужную ⇢');
    }
    addBtn('take', 'Беру', 'себе', ICONS.take, () => { send({ t: 'act', action: 'take' }); state.selected = null; });
    return;
  }

  // атакующие
  if (table.length === 0 && me.isAttacker) {
    hint(box, 'Выложите карту<br>свайпом на стол');
  } else if (me.canPodkid) {
    hint(box, 'Подкиньте карту<br>свайпом на стол');
  }
  // «Бито» — только первый атакующий и только когда всё отбито
  if (me.isAttacker && table.length > 0 && undefended.length === 0) {
    addBtn('pass', 'Бито', 'закрыть', ICONS.pass, () => { send({ t: 'act', action: 'endBout' }); state.selected = null; });
  }
}

function hint(box, html) {
  const h = document.createElement('div');
  h.className = 'bar-hint';
  h.innerHTML = html;
  box.appendChild(h);
}

const ICONS = {
  take: '<svg viewBox="0 0 24 24"><path d="M17 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-7 4v6l4-3z"/></svg>',
  pass: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  ready: '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>',
};

// ---------- жесты: свайп карты на стол, перевод, защита ----------
let dragCtx = null;
let lastTouchAt = 0;

function hitElementAt(x, y, selector) {
  const els = document.querySelectorAll(selector);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (x >= r.left - 10 && x <= r.right + 10 && y >= r.top - 10 && y <= r.bottom + 10) return el;
  }
  return null;
}

function attachGesture(el, card, g) {
  let sx = 0, sy = 0, st = 0, moved = false, ghost = null;
  const point = (e) => (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;

  const onStart = (e) => {
    if (e.type === 'mousedown' && Date.now() - lastTouchAt < 700) return;
    if (e.type === 'touchstart') lastTouchAt = Date.now();
    const t = point(e);
    sx = t.clientX; sy = t.clientY; st = Date.now(); moved = false;
  };

  const takeGhost = (x, y) => {
    ghost = el.cloneNode(true);
    ghost.className = 'card drag-ghost ' + (isRed(card.s) ? 'red' : 'black');
    ghost.style.left = x + 'px';
    ghost.style.top = y + 'px';
    document.body.appendChild(ghost);
    el.style.opacity = '0.3';
    tg?.HapticFeedback?.impactOccurred?.('light');
  };

  const onMove = (e) => {
    if (e.type === 'mousemove' && Date.now() - lastTouchAt < 700) return;
    const t = point(e);
    if (!t) return;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (!moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      moved = true;
      // тянем карту: свайп вверх или в сторону стола
      if (dy < -6) takeGhost(t.clientX, t.clientY);
    }
    if (!ghost) return;
    ghost.style.left = t.clientX + 'px';
    ghost.style.top = t.clientY + 'px';
    if (e.cancelable) e.preventDefault();
    // подсветка цели под пальцем
    document.querySelectorAll('.slot.target,.slot.invalid,.transfer-zone.hot').forEach(x => x.classList.remove('target', 'invalid', 'hot'));
    const z = hitElementAt(t.clientX, t.clientY, '#transfer-zone');
    if (z && g.you?.isDefender) { z.classList.add('hot'); return; }
    const slot = hitElementAt(t.clientX, t.clientY, '#battlefield .slot');
    if (slot && g.you?.isDefender && !g.takePhase && !g.podkidPhase) {
      const entry = g.table.find(s => s.attack.id === slot.dataset.attackId);
      const ok = entry && !entry.defense && beatsLocal(card, entry.attack, g.trump);
      slot.classList.add(ok ? 'target' : 'invalid');
    }
  };

  const onEnd = (e) => {
    if (e.type === 'mouseup' && Date.now() - lastTouchAt < 700) return;
    const t = point(e) || { clientX: sx, clientY: sy };
    const dt = Date.now() - st;
    if (ghost) { ghost.remove(); ghost = null; }
    el.style.opacity = '';
    document.querySelectorAll('.slot.target,.slot.invalid,.transfer-zone.hot').forEach(x => x.classList.remove('target', 'invalid', 'hot'));

    // короткий тап — выбор
    if (!moved && dt < 500) {
      state.selected = state.selected === card.id ? null : card.id;
      renderTable(state.game, state.room);
      tg?.HapticFeedback?.selectionChanged?.();
      return;
    }
    if (!moved) { renderTable(state.game, state.room); return; }

    const me = g.you;
    if (!me) return renderTable(state.game, state.room);

    // перевод: зона рядом с картой защитника
    if (me.isDefender && me.canTransfer && hitElementAt(t.clientX, t.clientY, '#transfer-zone')) {
      send({ t: 'act', action: 'transfer', cardId: card.id });
      state.selected = null;
      return;
    }

    // защита: бросили на конкретную карту атаки
    if (me.isDefender) {
      const slot = hitElementAt(t.clientX, t.clientY, '#battlefield .slot');
      if (!slot) { toast('Перетащите карту на ту, которую хотите побить'); return renderTable(state.game, state.room); }
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

    // атака/подкидывание: отпустили над полем стола
    const field = $('field').getBoundingClientRect();
    const overField = t.clientY < field.bottom + 40 && t.clientY > field.top - 80;
    if (overField && (me.isAttacker || me.canPodkid || g.takePhase?.active || g.podkidPhase?.active)) {
      send({ t: 'act', action: 'attack', cardId: card.id, cheat: !!g.opts?.cheat });
      state.selected = null;
      tg?.HapticFeedback?.impactOccurred?.('medium');
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

function beatsLocal(card, target, trump) {
  if (!card || !target) return false;
  if (card.s === target.s) return card.r > target.r;
  return card.s === trump && target.s !== trump;
}

// ---------- отмена последней карты ----------
$('undo-btn').addEventListener('click', () => {
  const id = state.game?.you?.recallable;
  if (!id) return toast('Нечего возвращать');
  send({ t: 'act', action: 'recall', cardId: id });
  tg?.HapticFeedback?.impactOccurred?.('light');
});

// ---------- выход из партии → главное меню ----------
$('exit-game').addEventListener('click', () => {
  const g = state.game;
  if (!g || g.phase === 'over') { send({ t: 'leave' }); return; }
  if (!confirm('Выйти из партии? Вам засчитается поражение, ставка уйдёт игрокам.')) return;
  send({ t: 'surrender' });
});

// ---------- итог партии ----------
function showOverOnce(g, roomMsg) {
  if (overShown) return;
  overShown = true;
  const iLost = g.losers?.includes(g.you?.id);
  const pay = g.payouts?.[g.you?.id];
  const bet = g.bet || 0;
  $('over-title').textContent = iLost ? 'Вы проиграли' : 'Победа!';
  const lines = [];
  if (g.losers?.length) {
    const names = g.players.filter(p => g.losers.includes(p.id)).map(p => p.name);
    lines.push(names.length === 1 ? `Дурак: ${names[0]}` : `Проигравшие: ${names.join(', ')}`);
  }
  $('over-text').innerHTML = lines.join('<br>');
  $('over-money').textContent = bet > 0
    ? (pay > 0 ? `+${pay} ₽` : (pay < 0 || iLost ? `−${bet} ₽` : '0 ₽'))
    : '';
  $('overlay').classList.add('on');
  tg?.HapticFeedback?.notificationOccurred?.(iLost ? 'error' : 'success');
}

$('over-close').addEventListener('click', () => {
  // после партии остаёмся в лобби для новой игры (кнопка «Готов»)
  $('overlay').classList.remove('on');
  overShown = false;
  showScreen('room-screen');
});

// ---------- приглашения по ссылке ----------
function parseStartParam() {
  const sp = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('tgWebAppStartParam') || '';
  const m = /lobby_([A-Za-z0-9]+)/.exec(sp);
  return m ? m[1].toUpperCase() : null;
}

// ---------- утилиты ----------
let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
  tg?.HapticFeedback?.notificationOccurred?.('warning');
}

window.addEventListener('resize', () => {
  if (state.game) layoutHand($('hand'), state.game.you?.hand?.length || 0);
});

state.pendingJoinId = parseStartParam();
showTab('profile');
connect();

// хук для автотестов (не влияет на работу приложения)
window.__durak = { layoutHand, state, get screen() { return SCREENS.find(id => $(id).classList.contains('on')); } };
