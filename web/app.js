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

$('start-game').addEventListener('click', () => send({ t: 'start' }));

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
    Конец: <b>${r.lossMode === 'classic' ? 'классика' : 'ничья'}</b> · Пароль: <b>${r.locked ? 'да' : 'нет'}</b>`;

  const isHost = m.hostId === m.me;
  const btn = $('start-game');
  btn.style.display = isHost ? 'block' : 'none';
  // хост может начать с любым числом игроков от 2 — иначе лобби на 6 навсегда застрянет
  btn.disabled = m.players.length < 2 || r.inGame;
  btn.textContent = r.inGame ? 'Игра идёт…'
    : (m.players.length === r.maxPlayers ? 'Начать игру' : `Начать игру (${m.players.length}/${r.maxPlayers})`);

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
function renderTable(g) {
  if (!g) return;
  state.game = g;
  const me = g.you;
  const isMe = (id) => id === g.you?.id;

  // места
  $('seats').innerHTML = g.players.map(p => {
    const tags = [];
    if (p.id === g.attackerId) tags.push('атакует');
    if (p.id === g.defenderId) tags.push('защита');
    if (p.out) tags.push('вышел');
    return `<div class="seat ${p.id === g.attackerId ? 'turn' : ''} ${p.id === g.defenderId ? 'defender' : ''} ${p.out ? 'out' : ''}">
      <div class="sname">${esc(p.name)}${isMe(p.id) ? ' (вы)' : ''}</div>
      <div class="scount">${p.count}</div>
      <div class="stag">${tags.join(' · ') || '&nbsp;'}</div>
      ${p.cheatsLocked && g.opts?.cheat ? '<div class="stag" style="color:#e88">без обмана</div>' : ''}
    </div>`;
  }).join('');

  // колода / отбой
  $('deck-count').textContent = g.deckCount;
  $('deck').classList.toggle('empty', g.deckCount === 0);
  $('trump').textContent = SUIT[g.trump];
  $('trump').style.color = (g.trump === 1 || g.trump === 2) ? '#d4352f' : '#1b2733';
  $('discard-count').textContent = g.discardCount;

  // стол
  const bf = $('battlefield');
  bf.innerHTML = '';
  (g.table || []).forEach((slot, i) => {
    const s = document.createElement('div');
    s.className = 'slot';
    const a = cardEl(slot.attack, { dim: !!slot.defense });
    a.classList.add('atk'); s.appendChild(a);
    if (slot.defense) { const df = cardEl(slot.defense); df.classList.add('def'); s.appendChild(df); }
    bf.appendChild(s);
  });

  // журнал
  $('log').innerHTML = (g.log || []).slice(-6).map(l => esc(l.text)).join('<br>');

  // рука
  const hand = $('hand');
  hand.innerHTML = '';
  (me?.hand || []).forEach(c => {
    const el = cardEl(c, { selected: state.selected === c.id });
    el.addEventListener('click', () => {
      state.selected = state.selected === c.id ? null : c.id;
      renderTable(g);
    });
    hand.appendChild(el);
  });

  renderActions(g);
}

function renderActions(g) {
  const me = g.you;
  const box = $('actions');
  box.innerHTML = '';
  if (!me || g.phase === 'over') return;

  const add = (label, cls, fn, disabled = false) => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls; b.textContent = label;
    b.disabled = disabled;
    b.onclick = fn;
    box.appendChild(b);
    return b;
  };

  const sel = state.selected;
  const iAmDefender = me.isDefender;
  const undefended = (g.table || []).filter(s => !s.defense);

  if (iAmDefender) {
    // перевести
    if (g.opts?.transfer && (g.table || []).length > 0 && undefended.length === (g.table || []).length) {
      add('Перевести', 'btn-ghost', () => {
        if (!sel) return toast('Выберите карту');
        send({ t: 'act', action: 'transfer', cardId: sel });
        state.selected = null;
      }, !sel);
    }
    add('Беру', 'btn-ghost', () => { send({ t: 'act', action: 'take' }); state.selected = null; });
    // подкинуть (после отбоя защищающийся может подкидывать на следующего — не здесь)
    if (undefended.length < (g.table || []).length) {
      add('Бито', 'btn-primary', () => { send({ t: 'act', action: 'endBout' }); state.selected = null; });
    }
  } else {
    add('Взять карту', 'btn-ghost', () => {
      if (!sel) return toast('Выберите карту в руке');
      send({ t: 'act', action: 'attack', cardId: sel, cheat: !!g.opts?.cheat });
      state.selected = null;
    });
    // закрыть кон, если всё отбито
    if ((g.table || []).length > 0 && undefended.length === 0) {
      add('Бито', 'btn-primary', () => { send({ t: 'act', action: 'endBout' }); state.selected = null; });
    }
  }

  // возврат карты
  if (sel && me.recallsLeft > 0) {
    add(`Вернуть (${me.recallsLeft})`, 'btn-ghost', () => {
      send({ t: 'act', action: 'recall', cardId: sel });
      state.selected = null;
    });
  }

  // обвинить шулера — только когда есть спорная карта
  if (g.opts?.cheat && g.pendingCheat && g.pendingCheat.playerId !== g.you?.id) {
    add(`Поймать: ${g.pendingCheat.playerName}`, 'btn-danger', () => {
      send({ t: 'act', action: 'accuse', targetId: g.pendingCheat.playerId });
    });
  }
}

// ---------- конец игры ----------
let overShown = false;
function showGameOver(g) {
  if (overShown) return;
  overShown = true;
  const losers = g.players.filter(p => g.losers?.includes(p.id)).map(p => p.name);
  const iLost = g.losers?.includes(g.you?.id);
  $('over-title').textContent = iLost ? 'Вы проиграли' : 'Победа!';
  $('over-text').textContent = losers.length
    ? (losers.length === 1 ? `Дурак: ${losers[0]}` : `Проигрыш делится: ${losers.join(', ')}`)
    : '';
  $('overlay').classList.add('on');
}

$('over-close').addEventListener('click', () => {
  $('overlay').classList.remove('on');
  overShown = false;
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

connect();
