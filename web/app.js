// web/app.js — клиент Mini App
const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();
tg?.setHeaderColor?.('#1e2a38');
tg?.setBackgroundColor?.('#1e2a38');

const $ = (id) => document.getElementById(id);
const SUIT = ['♠', '♥', '♦', '♣'];
const RANK = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'В',12:'Д',13:'К',14:'Т' };

const state = {
  me: null, room: null, game: null,
  selected: null,        // id выбранной карты
  devId: localStorage.getItem('devId') || ('dev-' + Math.random().toString(36).slice(2, 8)),
  createOpts: { maxPlayers: 6, deckSize: 36, speed: 'normal', podkid: 'all', cheat: false, transfer: false, lossMode: 'classic' }
};
localStorage.setItem('devId', state.devId);

// ---------- WebSocket ----------
let ws = null, reconnectTimer = null, authed = false;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    authed = false;
    ws.send(JSON.stringify({
      t: 'auth',
      initData: tg?.initData || '',
      devId: state.devId,
      name: tg?.initDataUnsafe?.user?.first_name || 'Игрок'
    }));
  };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    handle(m);
  };
  ws.onclose = () => {
    authed = false;
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
      authed = true; state.me = m.profile;
      state.myName = m.profile?.name || 'Игрок';
      state.myPhoto = m.profile?.photo || null;
      renderProfile(m.profile);
      send({ t: 'lobby_list' });
      break;
    case 'auth_fail':
      toast('Ошибка входа: ' + m.why); break;
    case 'lobby_list':
      renderRooms(m.rooms); break;
    case 'room':
      state.room = m;
      state.game = m.game;
      {
        const minePlayer = m.players?.find(p => p.id === m.me);
        if (minePlayer?.profile) state.me = { ...state.me, ...minePlayer.profile };
        if (minePlayer) { state.myName = minePlayer.name; state.myPhoto = minePlayer.photo; }
      }
      renderRoom(m);
      break;
    case 'error':
      toast(m.why || 'Ошибка'); break;
  }
}

// ---------- навигация ----------
const screens = ['profile-screen', 'list-screen', 'create-screen', 'room-screen', 'table-screen'];
function show(id) {
  screens.forEach(s => $(s).classList.toggle('on', s === id));
  $('tabs').style.display = (id === 'table-screen') ? 'none' : 'flex';
  if (id === 'profile-screen') $('tabs').style.display = 'flex';
}

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  [...$('tabs').children].forEach(x => x.classList.toggle('on', x === b));
  const tab = b.dataset.tab;
  if (tab === 'profile') show('profile-screen');
  if (tab === 'list') { show('list-screen'); send({ t: 'lobby_list' }); }
  if (tab === 'create') show('create-screen');
});

// ---------- профиль ----------
function renderProfile(p) {
  if (!p) return;
  $('p-name').textContent = p.name;
  $('p-stats').textContent = `${p.wins} побед · ${p.losses} поражений`;
  $('p-wins').textContent = p.wins;
  $('p-loss').textContent = p.losses;
  $('p-games').textContent = p.games;
  $('p-balance').textContent = p.balance ?? 0;
  state.me = p;
  const av = $('p-avatar');
  if (p.photo) av.innerHTML = `<img src="${p.photo}" alt="">`;
  else av.textContent = (p.name || '?')[0].toUpperCase();
}

// ---------- список лобби ----------
function renderRooms(list) {
  const box = $('rooms');
  if (!list?.length) {
    box.innerHTML = '<div class="empty-note">Открытых столов нет.<br>Создай свой — вкладка «Создать игру».</div>';
    return;
  }
  box.innerHTML = list.map(r => `
    <div class="room" data-id="${r.id}">
      <div class="room-info">
        <div class="room-id">${r.id} ${r.locked ? '<span class="badge gray">🔒</span>' : ''}</div>
        <div class="room-meta">
          ${r.players}/${r.maxPlayers} игроков · колода ${r.deckSize} ·
          ${r.podkid === 'all' ? 'все подкидывают' : 'только соседи'} ·
          ${r.transfer ? 'переводной' : 'без перевода'}
          ${r.cheat ? ' · с шулерами' : ''}
          ${r.bet ? ` · ставка <b style="color:var(--gold)">${r.bet}</b>` : ''}
        </div>
      </div>
      <button class="btn btn-ghost" style="width:auto;padding:9px 16px;font-size:14px"
        ${r.inGame ? 'disabled' : ''}>${r.inGame ? 'идёт' : 'войти'}</button>
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

// ---------- создание ----------
document.querySelectorAll('#seg-players button').forEach(b => {
  b.addEventListener('click', () => {
    state.createOpts.maxPlayers = Number(b.dataset.v);
    selSeg('#seg-players', b);
  });
});
document.querySelectorAll('#seg-deck button').forEach(b => {
  b.addEventListener('click', () => {
    state.createOpts.deckSize = Number(b.dataset.v);
    selSeg('#seg-deck', b);
  });
});
document.querySelectorAll('#seg-speed button').forEach(b => {
  b.addEventListener('click', () => {
    state.createOpts.speed = b.dataset.v;
    selSeg('#seg-speed', b);
  });
});

function selSeg(sel, btn) {
  document.querySelectorAll(sel + ' button').forEach(x => x.classList.toggle('on', x === btn));
}

document.querySelectorAll('.mode').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode, v = btn.dataset.v;
    // внутри одной группы — один активный
    document.querySelectorAll(`.mode[data-mode="${mode}"]`).forEach(x => x.classList.toggle('on', x === btn));
    if (mode === 'podkid') state.createOpts.podkid = v;
    if (mode === 'cheat') state.createOpts.cheat = v === '1';
    if (mode === 'transfer') state.createOpts.transfer = v === '1';
    if (mode === 'lossMode') state.createOpts.lossMode = v;
  });
});

// слайдер ставки
const betRange = $('bet-range');
function syncBet() {
  const v = Number(betRange.value);
  $('bet-value').textContent = v;
  state.createOpts.bet = v;
  const pct = (v / Number(betRange.max)) * 100;
  betRange.style.setProperty('--p', pct + '%');
}
betRange.addEventListener('input', syncBet);
syncBet();

$('do-create').addEventListener('click', () => {
  send({ t: 'create', opts: state.createOpts, password: $('password').value.trim() || null });
});

// ---------- лобби ----------
$('leave-room').addEventListener('click', () => {
  send({ t: 'leave' });
  state.room = null; state.game = null;
  show('list-screen');
  send({ t: 'lobby_list' });
});

$('copy-room').addEventListener('click', () => {
  const id = state.room?.room?.id;
  if (!id) return;
  navigator.clipboard?.writeText(id).then(() => toast('Код лобби скопирован: ' + id));
});

$('start-game').addEventListener('click', () => send({ t: 'ready' }));

function renderRoom(m) {
  if (!m) return;
  const r = m.room;
  $('room-title').textContent = 'Лобби ' + r.id;

  $('room-players').innerHTML = m.players.map(p => `
    <div class="room" style="padding:12px">
      <div class="room-info">
        <div class="room-id" style="letter-spacing:0;font-size:14px">
          ${esc(p.name)} ${p.id === m.hostId ? '<span class="badge">хост</span>' : ''}
          ${p.id === m.me ? '<span class="badge gray">вы</span>' : ''}
          ${p.online ? '' : '<span class="badge gray">офлайн</span>'}
          ${p.ready ? '<span class="badge">готов ✓</span>' : ''}
        </div>
        <div class="room-meta">${p.profile ? `${p.profile.wins}П / ${p.profile.losses}Пр` : ''}</div>
      </div>
    </div>`).join('') +
    Array.from({ length: Math.max(0, r.maxPlayers - m.players.length) })
      .map(() => `<div class="room" style="padding:12px;opacity:.45"><div class="room-info">
        <div class="room-id" style="letter-spacing:0;font-size:14px">свободное место</div></div></div>`).join('');

  $('room-opts').innerHTML = `
    Игроков: <b>${r.players}/${r.maxPlayers}</b><br>
    Колода: <b>${r.deckSize}</b> · Подкидывание: <b>${r.podkid === 'all' ? 'все' : 'соседи'}</b><br>
    Перевод: <b>${r.transfer ? 'да' : 'нет'}</b> · Шулеры: <b>${r.cheat ? 'да' : 'нет'}</b><br>
    Конец: <b>${r.lossMode === 'classic' ? 'классика' : 'ничья'}</b> · Пароль: <b>${r.locked ? 'да' : 'нет'}</b><br>
    Ставка: <b style="color:var(--gold)">${r.bet || 0}</b> · Ваш баланс: <b style="color:var(--gold)">${state.me?.balance ?? 0}</b>`;

  const isHost = m.hostId === m.me;
  // Кнопка «Готов» живёт ТОЛЬКО в лобби и исчезает, как только партия началась
  const btn = $('start-game');
  const inGameNow = !!m.game && m.game.phase !== 'over';
  const meP = m.players.find(p => p.id === m.me);
  const iAmReady = !!meP?.ready;

  btn.style.display = inGameNow ? 'none' : 'block';
  btn.disabled = m.players.length < 2;
  btn.textContent = iAmReady ? 'Вы готовы ✓' : 'Готов';
  btn.style.background = iAmReady
    ? 'linear-gradient(180deg,#7bc043,#5aa32e)'
    : 'linear-gradient(180deg,#fff,#e9e4d8)';
  btn.style.color = iAmReady ? '#fff' : '#7a2f2b';

  const readyCount = m.players.filter(p => p.ready).length;
  $('ready-hint').textContent = inGameNow ? ''
    : m.players.length < 2
      ? 'Нужно минимум 2 игрока'
      : `Готовы: ${readyCount} из ${m.players.length}. Партия начнётся, когда готовы все`;

  // переход к столу
  if (m.game && m.game.phase !== 'over') {
    show('table-screen');
    renderTable(m.game);
  } else if (m.game && m.game.phase === 'over') {
    show('table-screen');
    renderTable(m.game);
    showGameOver(m.game);
  } else {
    if ($('table-screen').classList.contains('on')) show('room-screen');
    else if ($('profile-screen').classList.contains('on')) show('room-screen');
    else show('room-screen');
  }
}

// ---------- карта ----------
function cardEl(card, { selected = false, dim = false, back = false } = {}) {
  const d = document.createElement('div');
  if (back) { d.className = 'card back'; return d; }
  const red = card.s === 1 || card.s === 2;
  d.className = 'card' + (red ? ' red' : '') + (selected ? ' sel' : '') + (dim ? ' dim' : '');
  d.innerHTML = `<span>${RANK[card.r]}${SUIT[card.s]}</span>
                 <span class="bottom">${RANK[card.r]}${SUIT[card.s]}</span>`;
  d.dataset.id = card.id;
  return d;
}

// ---------- стол ----------
let dragState = null;
let prevTableSig = '';   // чтобы понимать, какая карта только что легла на стол

// Летящая карта из руки на стол — по дуге
function flyCard(fromEl, card, slotIndex) {
  const bf = $('battlefield');
  if (!bf) return;
  const target = bf.children[slotIndex];
  const to = (target || bf).getBoundingClientRect();
  const from = fromEl && fromEl.getBoundingClientRect
    ? fromEl.getBoundingClientRect()
    : { left: to.left, top: to.top + 220, width: 56, height: 80 };

  const fly = cardEl(card);
  fly.classList.add('flying');
  fly.style.left = from.left + 'px';
  fly.style.top = from.top + 'px';
  fly.style.width = from.width + 'px';
  fly.style.height = from.height + 'px';
  document.body.appendChild(fly);

  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const scale = (to.width || 54) / (from.width || 56);

  // дуга: поднимаем карту над прямой линией в середине пути
  const lift = Math.min(120, Math.abs(dy) * 0.25 + 40);
  const midX = dx * 0.5;
  const midY = dy * 0.5 - lift;

  fly.animate([
    { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
    { transform: `translate(${midX}px, ${midY}px) scale(${(1 + scale) / 2 * 1.12}) rotate(-8deg)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(4deg)`, opacity: 1, offset: 1 }
  ], {
    duration: 340,
    easing: 'cubic-bezier(.32,.72,.35,1)',
    fill: 'forwards'
  });

  setTimeout(() => fly.remove(), 360);
}

function renderTable(g) {
  if (!g) return;
  state.game = g;
  const me = g.you;

  // ---- верх: ставка ----
  $('bet-val').textContent = g.bet || 0;
  $('my-balance').textContent = state.me?.balance ?? 0;
  $('my-balance-2').textContent = state.me?.balance ?? 0;

  // ---- места соперников (все, кроме меня) ----
  const others = g.players.filter(p => p.id !== me?.id);
  $('seats').innerHTML = others.map(p => {
    const tag = p.out ? 'вышел'
      : p.passed ? 'пас'
      : p.id === g.attackerId ? 'атакует'
      : p.id === g.defenderId ? 'защита' : '';
    const photo = p.photo
      ? `<img src="${esc(p.photo)}" alt="" onerror="this.style.display='none'">`
      : `<span class="initial">${esc((p.name || '?')[0].toUpperCase())}</span>`;
    return `<div class="seat ${p.id === g.attackerId ? 'turn' : ''} ${p.id === g.defenderId ? 'defender' : ''} ${p.out ? 'out' : ''}">
      <div class="frame">${photo}</div>
      <div class="scount">${p.count}</div>
      <div class="sname">${esc(p.name)}</div>
      <div class="stag">${tag || '&nbsp;'}</div>
      ${p.passed ? '<div class="passed-tag">ПАС</div>' : ''}
    </div>`;
  }).join('');

  // ---- своя панель ----
  if (me) {
    const myPlayer = g.players.find(p => p.id === me.id);
    const av = $('my-avatar');
    const ph = myPlayer?.photo || state.myPhoto || state.me?.photo;
    av.innerHTML = ph
      ? `<img src="${esc(ph)}" alt="">`
      : `<span class="initial">${esc((myPlayer?.name || '?')[0].toUpperCase())}</span>`;
    $('my-count').textContent = me.hand?.length ?? 0;
    $('my-name').textContent = myPlayer?.name || 'Вы';

    const wrap = document.querySelector('.avatar-wrap');
    if (wrap) {
      wrap.classList.toggle('turn', g.attackerId === me.id);
      wrap.classList.toggle('defend', g.defenderId === me.id);
    }
  }

  // ---- колода и козырь ----
  $('deck-count').textContent = g.deckCount;
  $('deck-pile').classList.toggle('empty', g.deckCount === 0);
  const tr = g.trumpCard;
  // козырь показываем только пока он реально лежит под колодой
  const showTrump = g.deckCount > 0 && !!tr;
  $('trump-card').style.display = showTrump ? 'flex' : 'none';
  if (showTrump) {
    $('trump-rank').textContent = RANK[tr.r];
    $('trump-suit').textContent = SUIT[tr.s];
    const red = tr.s === 1 || tr.s === 2;
    $('trump-card').style.color = red ? '#d4352f' : '#1b2733';
  }
  $('discard-count').textContent = g.discardCount;

  // ---- кнопка отмены (слева от аватарки) ----
  const canUndo = !!me?.recallable && (me.recallsLeft ?? 0) > 0;
  $('undo-btn').disabled = !canUndo;
  $('undo-left').textContent = me?.recallsLeft ?? 0;

  // ---- карты на столе ----
  const bf = $('battlefield');
  const prevCount = bf.children.length;
  const oldEls = [...bf.children].map(el => el.querySelector('.atk'));
  bf.innerHTML = '';
  const suspicion = g.pendingCheat?.cardId || null;
  (g.table || []).forEach(slot => {
    const s = document.createElement('div');
    s.className = 'slot';
    s.dataset.attackId = slot.attack.id;
    s.dataset.defended = slot.defense ? '1' : '0';

    // спорная (шулерская) карта — подсвечиваем и делаем кликабельной
    const isSuspect = suspicion && slot.attack.id === suspicion;
    if (isSuspect) {
      s.classList.add('suspect');
      s.addEventListener('click', (ev) => {
        ev.stopPropagation();
        send({ t: 'act', action: 'accuse', targetId: g.pendingCheat.playerId });
        toast('Пойман за руку: ' + g.pendingCheat.playerName);
      });
    }

    const a = cardEl(slot.attack, { dim: !!slot.defense });
    a.classList.add('atk'); s.appendChild(a);
    if (slot.defense) { const df = cardEl(slot.defense); df.classList.add('def'); s.appendChild(df); }
    bf.appendChild(s);
  });

  // новую карту прилетает анимировать
  const slotsNow = bf.children.length;
  if (slotsNow > prevCount && state.pendingCard) {
    flyCard(state.pendingFrom, state.pendingCard, slotsNow - 1);
    state.pendingCard = null;
    state.pendingFrom = null;
  }

  // ---- баннер фазы «беру» ----
  const banner = $('take-banner');
  if (g.takePhase?.active) {
    const waiting = g.takePhase.waitingFor || [];
    const defName = g.players.find(x => x.id === g.takePhase.defenderId)?.name || '';
    if (g.takePhase.allPassed) {
      banner.innerHTML = g.you?.canConfirmTake
        ? 'Все сказали <b>пас</b> — забирайте карты'
        : `Ждём, пока <b>${esc(defName)}</b> заберёт карты`;
    } else if (g.you?.isDefender) {
      banner.innerHTML = `Вы берёте. Ждём подкидывания:<br><b>${esc(waiting.join(', '))}</b>`;
    } else {
      banner.innerHTML = `<b>${esc(defName)}</b> берёт карты.<br>Можно подкинуть ещё или нажать <b>пас</b>`;
    }
    banner.classList.remove('hide');
  } else {
    banner.classList.add('hide');
  }

  // ---- журнал ----
  $('log').innerHTML = (g.log || []).slice(-3).map(l => esc(l.text)).join('<br>');

  // ---- рука с жестами ----
  const hand = $('hand');
  hand.innerHTML = '';
  const cards = me?.hand || [];
  cards.forEach(c => {
    const el = cardEl(c, { selected: state.selected === c.id });
    el.classList.add('in-hand');
    attachGesture(el, c, g);
    hand.appendChild(el);
  });
  layoutHand(hand, cards.length);

  renderBar(g);
}

// Раскладка руки: чем больше карт, тем сильнее они налезают друг на друга,
// но угол с рангом и мастью всегда остаётся виден
function layoutHand(handEl, count) {
  if (!count) return;
  const CARD_W = 58;
  const CORNER = 22;            // сколько должно остаться видимым у каждой карты
  const av = handEl.clientWidth || window.innerWidth - 20;
  const padding = 20;
  const usable = av - padding;

  // сколько нужно места, если не налезать вовсе
  const full = count * CARD_W;
  let overlap = 0;
  if (full > usable) {
    // сдвиг на каждую следующую карту
    const needed = (full - usable) / (count - 1);
    overlap = Math.min(CARD_W - CORNER, needed);
  }
  handEl.style.setProperty('--overlap', `-${Math.round(overlap)}px`);
}

// Кнопки в нижней панели
const ICONS = {
  take: '<svg viewBox="0 0 24 24"><path d="M17 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-7 4v6l4-3z"/></svg>',
  pass: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  transfer: '<svg viewBox="0 0 24 24"><path d="M4 7h11V4l5 4-5 4V9H4zm16 10H9v3l-5-4 5-4v3h11z"/></svg>',
  ready: '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>',
};

function renderBar(g) {
  const me = g.you;
  const box = $('bar-btns');
  box.innerHTML = '';
  if (!me || g.phase === 'over') return;

  const table = g.table || [];
  const undefended = table.filter(s => !s.defense);
  const hasSelection = !!state.selected;
  const takePhase = g.takePhase?.active;

  const addBtn = (cls, label, sub, icon, fn, disabled = false) => {
    const b = document.createElement('button');
    b.className = 'pill-btn ' + cls;
    b.innerHTML = `${icon || ''}<span>${label}</span>${sub ? `<span class="sub">${sub}</span>` : ''}`;
    b.disabled = disabled;
    b.onclick = fn;
    box.appendChild(b);
    return b;
  };

  // спорная карта: любой, кроме шулера, может нажать «Поймать»
  if (g.pendingCheat && g.pendingCheat.playerId !== me.id) {
    const sBtn = document.createElement('button');
    sBtn.className = 'pill-btn take';
    sBtn.innerHTML = `${ICONS.ready}<span>Поймать</span><span class="sub">${esc(g.pendingCheat.playerName)}</span>`;
    sBtn.onclick = () => send({ t: 'act', action: 'accuse', targetId: g.pendingCheat.playerId });
    box.appendChild(sBtn);
  }

  // ================= фаза «беру» =================
  if (takePhase) {
    if (me.isDefender) {
      // защитник ждёт всех, потом забирает
      addBtn('take', 'Забрать', g.you.canConfirmTake ? 'готово' : 'ждём', ICONS.take, () => {
        send({ t: 'act', action: 'confirmTake' });
      }, !g.you.canConfirmTake);
      return;
    }

    // остальные подкидывают или пасуют
    if (me.passed) {
      const hint = document.createElement('div');
      hint.className = 'bar-hint';
      hint.innerHTML = 'Вы сказали <b>пас</b><br>ждём остальных';
      box.appendChild(hint);
      return;
    }

    // можно ли ещё подкинуть
    const atLimit = table.length >= (g.takePhase.maxCards || 6);
    addBtn('ready', 'Подкинуть', 'карту', ICONS.ready, () => {
      if (!state.selected) return toast('Выберите карту или перетащите её на стол');
      send({ t: 'act', action: 'attack', cardId: state.selected, cheat: !!g.opts?.cheat });
      state.selected = null;
    }, !hasSelection || atLimit);

    addBtn('pass', 'Пас', 'больше нет', ICONS.pass, () => {
      send({ t: 'act', action: 'passPodkid' });
      state.selected = null;
    });
    return;
  }

  // ================= обычная фаза =================
  if (me.isDefender) {
    // перевод возможен, только пока ничего не отбито
    if (g.opts?.transfer && table.length > 0 && undefended.length === table.length) {
      addBtn('hint', 'Перевод', 'картой', ICONS.transfer, () => {
        if (!state.selected) return toast('Выберите карту того же ранга');
        send({ t: 'act', action: 'transfer', cardId: state.selected });
        state.selected = null;
      }, !hasSelection);
    }

    if (undefended.length > 0) {
      const hint = document.createElement('div');
      hint.className = 'bar-hint';
      hint.innerHTML = 'Перетащите карту<br>на нужную ⇢';
      box.appendChild(hint);
    }

    // «Беру» — единственная кнопка защитника. «Бито» у него НЕТ.
    addBtn('take', 'Беру', 'себе', ICONS.take, () => {
      send({ t: 'act', action: 'take' });
      state.selected = null;
    });
    return;
  }

  // атакующая сторона
  const myLead = table.length === 0 ? g.attackerId === me.id : true;

  if (myLead) {
    addBtn('ready', 'Готов', 'выложить', ICONS.ready, () => {
      if (!state.selected) return toast('Выберите карту или перетащите её на стол');
      send({ t: 'act', action: 'attack', cardId: state.selected, cheat: !!g.opts?.cheat });
      state.selected = null;
    }, !hasSelection);
  }

  // «Бито» — только у атакующей стороны и только когда всё отбито
  if (table.length > 0 && undefended.length === 0) {
    addBtn('pass', 'Бито', 'закрыть', ICONS.pass, () => {
      send({ t: 'act', action: 'endBout' });
      state.selected = null;
    });
  }
}

// ============================================================
//  ЖЕСТЫ: тащим карту из руки на конкретную карту соперника
//  - защищающийся: бросает свою карту НА ту, которую хочет побить
//  - атакующий:   бросает карту просто на стол
// ============================================================
let lastTouchAt = 0;
let dragCtx = null;

// Кто бьёт кого — считаем локально, чтобы подсвечивать цель ещё до броска
function beatsLocal(card, target, trump) {
  if (!card || !target) return false;
  if (card.s === target.s) return card.r > target.r;
  return card.s === trump && target.s !== trump;
}

// Какая карта стола под пальцем
function hitSlotAt(x, y) {
  const slots = [...document.querySelectorAll('#battlefield .slot')];
  for (const el of slots) {
    const r = el.getBoundingClientRect();
    if (x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8)
      return el;
  }
  return null;
}

function clearTargetMarks() {
  document.querySelectorAll('#battlefield .slot')
    .forEach(el => el.classList.remove('target', 'invalid'));
}

function attachGesture(el, card, g) {
  let startX = 0, startY = 0, startT = 0, moved = false, ghost = null;

  const point = (e) => (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;

  const takeGhost = (x, y) => {
    ghost = el.cloneNode(true);
    ghost.className = 'card drag-ghost' + (el.classList.contains('red') ? ' red' : '');
    ghost.style.left = x + 'px';
    ghost.style.top = y + 'px';
    document.body.appendChild(ghost);
    el.style.opacity = '0.3';
  };

  const onStart = (e) => {
    if (e.type === 'mousedown' && Date.now() - lastTouchAt < 700) return;
    if (e.type === 'touchstart') lastTouchAt = Date.now();
    const t = point(e);
    startX = t.clientX; startY = t.clientY; startT = Date.now();
    moved = false;
    dragCtx = { card, g };
  };

  const onMove = (e) => {
    if (e.type === 'mousemove' && Date.now() - lastTouchAt < 700) return;
    const t = point(e);
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (!moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      moved = true;
      takeGhost(t.clientX, t.clientY);
      tg?.HapticFeedback?.impactOccurred?.('light');
    }

    if (!ghost) return;
    ghost.style.left = t.clientX + 'px';
    ghost.style.top = t.clientY + 'px';
    if (e.cancelable) e.preventDefault();

    // подсветка карты-цели
    clearTargetMarks();
    const me = g.you;
    if (me?.isDefender) {
      const slot = hitSlotAt(t.clientX, t.clientY);
      if (slot) {
        const entry = (g.table || []).find(x => x.attack.id === slot.dataset.attackId);
        if (entry) {
          const ok = !entry.defense && beatsLocal(card, entry.attack, g.trump);
          slot.classList.add(ok ? 'target' : 'invalid');
        }
      }
    } else {
      const bf = $('battlefield').getBoundingClientRect();
      if (t.clientX >= bf.left - 40 && t.clientX <= bf.right + 40 &&
          t.clientY >= bf.top - 40 && t.clientY <= bf.bottom + 40) {
        document.querySelectorAll('#battlefield .slot').forEach(s => s.classList.add('target'));
      }
    }
  };

  const onEnd = (e) => {
    if (e.type === 'mouseup' && Date.now() - lastTouchAt < 700) return;
    const t = point(e) || { clientX: startX, clientY: startY };
    const dt = Date.now() - startT;

    clearTargetMarks();
    if (ghost) { ghost.remove(); ghost = null; }
    el.style.opacity = '';
    dragCtx = null;

    const me = g.you;

    // --- короткий тап: просто выбрать карту ---
    if (!moved && dt < 500) {
      state.selected = state.selected === card.id ? null : card.id;
      renderTable(state.game);
      tg?.HapticFeedback?.selectionChanged?.();
      return;
    }
    if (!moved) { renderTable(state.game); return; }

    // --- защищающийся: нужна конкретная цель ---
    if (me?.isDefender) {
      const slot = hitSlotAt(t.clientX, t.clientY);
      if (!slot) {
        toast('Перетащите карту на ту, которую хотите побить');
        renderTable(state.game);
        return;
      }
      const entry = (g.table || []).find(x => x.attack.id === slot.dataset.attackId);
      if (!entry) { renderTable(state.game); return; }
      if (entry.defense) {
        toast('Эта карта уже отбита');
        renderTable(state.game);
        return;
      }
      if (!beatsLocal(card, entry.attack, g.trump)) {
        toast(`${RANK[card.r]}${SUIT[card.s]} не бьёт ${RANK[entry.attack.r]}${SUIT[entry.attack.s]}`);
        renderTable(state.game);
        return;
      }
      state.selected = null;
      send({ t: 'act', action: 'defend', cardId: card.id, targetCardId: entry.attack.id });
      tg?.HapticFeedback?.impactOccurred?.('medium');
      return;
    }

    // --- атакующий: достаточно бросить на стол ---
    const bf = $('battlefield').getBoundingClientRect();
    const onTable = t.clientX >= bf.left - 60 && t.clientX <= bf.right + 60 &&
                    t.clientY >= bf.top - 60 && t.clientY <= bf.bottom + 60;
    if (onTable) {
      dropOnTable(card, g, el);
    } else {
      renderTable(state.game);
    }
  };

  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: false });
  el.addEventListener('touchend', onEnd);
  el.addEventListener('touchcancel', onEnd);
  el.addEventListener('mousedown', onStart);
  el.addEventListener('mousemove', onMove);
  el.addEventListener('mouseup', onEnd);
}

// Что делать, когда карту «бросили» на стол
function dropOnTable(card, g, fromEl) {
  const me = g?.you;
  if (!me || !g) return;

  const undefended = (g.table || []).filter(s => !s.defense);

  // запоминаем для анимации полёта
  state.pendingCard = card;
  state.pendingFrom = fromEl || null;

  // защищающийся бросает карту вверх по неотбитой — это защита
  if (me.isDefender && undefended.length) {
    send({ t: 'act', action: 'defend', cardId: card.id });
    state.selected = null;
    return;
  }

  // иначе — атака/подкидывание
  send({ t: 'act', action: 'attack', cardId: card.id, cheat: !!g.opts?.cheat });
  state.selected = null;
  tg?.HapticFeedback?.impactOccurred?.('medium');
}

// Выход из партии — засчитывается поражение
$('exit-game').addEventListener('click', () => {
  const g = state.game;
  if (!g || g.phase === 'over') return toast('Партия не идёт');
  if (!confirm('Выйти из партии? Вам засчитается поражение, а ставка сгорит.')) return;
  send({ t: 'surrender' });
});

// Отмена последней выложенной карты
$('undo-btn').addEventListener('click', () => {
  const g = state.game;
  const id = g?.you?.recallable;
  if (!id) return toast('Нечего возвращать');
  send({ t: 'act', action: 'recall', cardId: id });
  tg?.HapticFeedback?.impactOccurred?.('light');
  setTimeout(() => { state.selected = null; }, 50);
});

// ---------- конец игры ----------
let overShown = false;
function showGameOver(g) {
  if (overShown) return;
  overShown = true;

  const iLost = g.losers?.includes(g.you?.id);
  const bet = g.bet || 0;
  const losers = g.players.filter(p => g.losers?.includes(p.id)).map(p => p.name);

  $('over-title').textContent = iLost ? 'Вы проиграли' : 'Победа!';

  const lines = [];
  if (losers.length) {
    lines.push(losers.length === 1
      ? `Дурак: ${losers[0]}`
      : `Проигрыш делится: ${losers.join(', ')}`);
  }
  $('over-text').innerHTML = lines.join('<br>');

  // ---- выплаты ----
  const myPay = g.payouts?.[g.you?.id];
  if (bet > 0 && typeof myPay === 'number') {
    $('over-coins').textContent = myPay > 0 ? `+${myPay} ◈` : (myPay < 0 ? `−${bet} ◈` : 'ставка возвращена');
    $('over-coins').className = 'overlay-coins ' + (myPay > 0 ? 'gain' : myPay < 0 ? 'lose' : '');
  } else {
    $('over-coins').textContent = '';
  }

  // ---- кто сколько получил ----
  const detail = g.payoutDetail;
  const box = $('over-detail');
  if (detail?.length) {
    box.innerHTML = `<div class="od-title">Доли выигрыша</div>` +
      detail.map((d, i) => `
        <div class="od-row">
          <span class="od-place">${i + 1}</span>
          <span class="od-name">${esc(d.name)}</span>
          <span class="od-sum">+${d.amount}</span>
        </div>`).join('');
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }

  $('overlay').classList.add('on');
  tg?.HapticFeedback?.notificationOccurred?.(iLost ? 'error' : 'success');
}

$('over-close').addEventListener('click', () => {
  $('overlay').classList.remove('on');
  overShown = false;
  // запросить актуальный баланс
  ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'auth', initData: tg?.initData || '', devId: state.devId, name: state.myName }));
  send({ t: 'leave' });
  state.room = null; state.game = null;
  show('list-screen');
  send({ t: 'lobby_list' });
});

// ---------- утилиты ----------
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

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
  const h = $('hand');
  if (h && state.game) layoutHand(h, state.game.you?.hand?.length || 0);
});
// пересчитываем раскладку после появления экрана стола
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.game) {
    const h = $('hand');
    if (h) layoutHand(h, state.game.you?.hand?.length || 0);
  }
});

connect();
