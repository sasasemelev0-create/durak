// server/index.js — HTTP + WebSocket сервер «Дурак» (v6)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Durak } from './engine.js';
import { Profiles, verifyInitData, START_BALANCE } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const BOT_USERNAME = process.env.BOT_USERNAME || 'durak132_game_bot';
const PORT = Number(process.env.PORT || 3000);
const DEV = !BOT_TOKEN;

const profiles = new Profiles();
const rooms = new Map();        // roomId -> room
const sockets = new Map();      // playerId -> ws
const clientRoom = new Map();   // playerId -> roomId
const friends = new Map();      // playerId -> Set(playerId)  (хранится в памяти до появления БД)
const friendReq = new Map();    // targetId -> Set(fromId)    (входящие заявки)

const uid = () => crypto.randomBytes(6).toString('hex');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- HTTP (статика Mini App) ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') return json(res, { ok: true, dev: DEV, rooms: rooms.size });
  if (url.pathname === '/api/config') return json(res, { dev: DEV, bot: BOT_USERNAME });

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const webRoot = path.join(__dirname, '..', 'web');
  const file = path.normalize(path.join(webRoot, rel));
  if (!file.startsWith(webRoot)) return json(res, { error: 'forbidden' }, 403);
  fs.readFile(file, (err, data) => {
    if (err) return json(res, { error: 'not found' }, 404);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.id = uid();
  ws.playerId = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { t: 'error', why: 'Плохой JSON' }); }
    try { handle(ws, msg); } catch (e) {
      console.error('handler error', e);
      send(ws, { t: 'error', why: 'Внутренняя ошибка' });
    }
  });
  ws.on('close', () => {
    if (ws.playerId && sockets.get(ws.playerId) === ws) sockets.delete(ws.playerId);
    const roomId = ws.playerId && clientRoom.get(ws.playerId);
    const room = roomId && rooms.get(roomId);
    if (room) {
      room.presence[ws.playerId] = false;
      broadcastRoom(room);
    }
  });
});

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function sendTo(playerId, obj) {
  const s = sockets.get(playerId);
  if (s) send(s, obj);
}

function roomSockets(room) {
  return room.players.map(p => sockets.get(p.id)).filter(Boolean);
}

function broadcastRoom(room) {
  for (const p of room.players) sendTo(p.id, roomStateFor(room, p.id));
}

function broadcastLobbies() {
  const list = [...rooms.values()].filter(r => !r.closed).map(roomPublic);
  for (const s of wss.clients) if (s.readyState === 1) send(s, { t: 'lobby_list', rooms: list });
}

// ---------- авторизация ----------
function auth(ws, msg) {
  if (DEV) {
    const id = String(msg.devId || 'dev-' + ws.id);
    const prof = profiles.upsert({ id, first_name: msg.name || 'Игрок' });
    ws.playerId = prof.id;
    sockets.set(prof.id, ws);
    return prof;
  }
  const v = verifyInitData(msg.initData, BOT_TOKEN);
  if (!v.ok) { send(ws, { t: 'auth_fail', why: v.why }); return null; }
  const prof = profiles.upsert(v.user);
  ws.playerId = prof.id;
  sockets.set(prof.id, ws);
  return prof;
}

function requireAuth(ws) {
  if (!ws.playerId) { send(ws, { t: 'error', why: 'Нужна авторизация' }); return null; }
  return profiles.get(ws.playerId);
}

// ---------- обработчик ----------
function handle(ws, msg) {
  switch (msg.t) {
    case 'auth': {
      const prof = auth(ws, msg);
      if (!prof) return;
      // если игрок был в лобби до перезагрузки клиента — возвращаем его туда
      const rid = clientRoom.get(prof.id);
      send(ws, { t: 'auth_ok', profile: profileFor(prof.id, prof.id), dev: DEV, bot: BOT_USERNAME });
      if (rid && rooms.has(rid)) broadcastRoom(rooms.get(rid));
      return;
    }

    case 'lobby_list': {
      const me = requireAuth(ws); if (!me) return;
      send(ws, { t: 'lobby_list', rooms: [...rooms.values()].filter(r => !r.closed).map(roomPublic) });
      return;
    }

    case 'create': {
      const me = requireAuth(ws); if (!me) return;
      if (clientRoom.has(me.id)) leaveCurrentRoom(me.id);
      const room = createRoom(me, msg.opts || {}, msg.password || null);
      joinRoom(room, me.id);
      broadcastRoom(room);
      broadcastLobbies();
      return;
    }

    case 'join': {
      const me = requireAuth(ws); if (!me) return;
      const room = rooms.get(String(msg.roomId || '').toUpperCase());
      if (!room || room.closed) return send(ws, { t: 'error', why: 'Лобби не найдено' });
      if (room.game && room.game.phase !== 'over') return send(ws, { t: 'error', why: 'Игра уже идёт' });
      if (room.players.length >= room.opts.maxPlayers) return send(ws, { t: 'error', why: 'Лобби заполнено' });
      if (room.password && room.password !== String(msg.password || '')) return send(ws, { t: 'error', why: 'Неверный пароль' });
      if (clientRoom.has(me.id) && clientRoom.get(me.id) !== room.id) leaveCurrentRoom(me.id);
      joinRoom(room, me.id);
      broadcastRoom(room);
      broadcastLobbies();
      return;
    }

    case 'leave': {
      // выход из лобби в главное меню
      const me = requireAuth(ws); if (!me) return;
      leaveCurrentRoom(me.id);
      send(ws, { t: 'left' });
      broadcastLobbies();
      return;
    }

    case 'ready': {
      // «Готов» — только в лобби, до старта партии
      const me = requireAuth(ws); if (!me) return;
      const room = rooms.get(clientRoom.get(me.id));
      if (!room) return send(ws, { t: 'error', why: 'Вы не в лобби' });
      if (room.game && room.game.phase !== 'over') return send(ws, { t: 'error', why: 'Партия уже идёт' });
      if (room.game && room.game.phase === 'over') {
        // новая партия в том же лобби
        room.game = null; room.scored = false; room.payouts = null;
        room.readySet = new Set();
      }
      if (room.readySet.has(me.id)) room.readySet.delete(me.id);
      else room.readySet.add(me.id);
      tryStartRoom(room);
      broadcastRoom(room);
      broadcastLobbies();
      return;
    }

    case 'surrender': {
      // выход из партии: вышедший проигрывает, банк делят остальные поровну
      const me = requireAuth(ws); if (!me) return;
      const room = rooms.get(clientRoom.get(me.id));
      if (!room || !room.game) return send(ws, { t: 'error', why: 'Нет игры' });
      const res = room.game.surrender(me.id);
      if (!res.ok) return send(ws, { t: 'error', why: res.why });
      if (!room.scored) { room.scored = true; settleRoom(room, room.game, { surrender: me.id }); }
      // игрок покидает лобби и возвращается в главное меню
      leaveCurrentRoom(me.id);
      sendTo(me.id, { t: 'left', reason: 'surrender' });
      broadcastRoom(room);
      broadcastLobbies();
      return;
    }

    case 'act': {
      const me = requireAuth(ws); if (!me) return;
      const room = rooms.get(clientRoom.get(me.id));
      if (!room || !room.game) return send(ws, { t: 'error', why: 'Нет игры' });
      const g = room.game;
      if (g.phase === 'over') return send(ws, { t: 'error', why: 'Партия окончена' });

      let res;
      switch (msg.action) {
        case 'attack': res = g.attack(me.id, msg.cardId, { cheat: !!msg.cheat }); break;
        case 'defend': res = g.defend(me.id, msg.cardId, msg.targetCardId || null); break;
        case 'transfer': res = g.transfer(me.id, msg.cardId); break;
        case 'endBout': res = g.endBout(me.id); break;
        case 'take': res = g.takeCards(me.id); break;
        case 'passPodkid': res = g.phase === 'podkid' || g.podkidPending ? g.passPodkidAfterBito(me.id) : g.passPodkid(me.id); break;
        case 'confirmTake': res = g.confirmTake(me.id); break;
        case 'recall': res = g.recall(me.id, msg.cardId); break;
        case 'accuse': res = g.accuse(me.id, msg.targetId); break;
        default: res = { ok: false, why: 'Неизвестное действие' };
      }
      if (!res.ok) send(ws, { t: 'error', why: res.why });
      if (g.phase === 'over' && !room.scored) {
        room.scored = true;
        settleRoom(room, g);
      }
      broadcastRoom(room);
      return;
    }

    // ----- профили и друзья -----
    case 'profile': {
      const me = requireAuth(ws); if (!me) return;
      const target = profiles.get(String(msg.playerId || ''));
      if (!target) return send(ws, { t: 'error', why: 'Игрок не найден' });
      send(ws, { t: 'profile', profile: profileFor(target.id, me.id) });
      return;
    }

    case 'friend_invite': {
      // отправить заявку в друзья
      const me = requireAuth(ws); if (!me) return;
      const target = profiles.get(String(msg.playerId || ''));
      if (!target || target.id === me.id) return send(ws, { t: 'error', why: 'Нельзя добавить этого игрока' });
      if (isFriend(me.id, target.id)) return send(ws, { t: 'error', why: 'Уже в друзьях' });
      if (!friendReq.has(target.id)) friendReq.set(target.id, new Set());
      friendReq.get(target.id).add(me.id);
      sendTo(target.id, { t: 'friend_request', from: { id: me.id, name: me.name } });
      send(ws, { t: 'notice', text: `Заявка отправлена: ${target.name}` });
      return;
    }

    case 'friend_accept': {
      const me = requireAuth(ws); if (!me) return;
      const fromId = String(msg.playerId || '');
      if (!friendReq.get(me.id)?.has(fromId)) return send(ws, { t: 'error', why: 'Заявки нет' });
      friendReq.get(me.id).delete(fromId);
      addFriend(me.id, fromId);
      sendTo(fromId, { t: 'notice', text: `${me.name} принял заявку в друзья` });
      send(ws, { t: 'friends', friends: friendsOf(me.id) });
      return;
    }

    case 'friend_remove': {
      const me = requireAuth(ws); if (!me) return;
      const id = String(msg.playerId || '');
      friends.get(me.id)?.delete(id);
      friends.get(id)?.delete(me.id);
      send(ws, { t: 'friends', friends: friendsOf(me.id) });
      return;
    }

    case 'friends': {
      const me = requireAuth(ws); if (!me) return;
      send(ws, { t: 'friends', friends: friendsOf(me.id), requests: requestsOf(me.id) });
      return;
    }

    case 'invite_friend': {
      // пригласить друга в свою комнату (ссылка + личное сообщение в приложении)
      const me = requireAuth(ws); if (!me) return;
      const room = rooms.get(clientRoom.get(me.id));
      if (!room) return send(ws, { t: 'error', why: 'Сначала создайте лобби' });
      if (!isFriend(me.id, msg.playerId)) return send(ws, { t: 'error', why: 'Приглашать можно только друзей' });
      sendTo(msg.playerId, {
        t: 'invite',
        from: { id: me.id, name: me.name },
        roomId: room.id,
        link: inviteLink(room.id),
      });
      send(ws, { t: 'notice', text: 'Приглашение отправлено' });
      return;
    }

    case 'ping': send(ws, { t: 'pong' }); return;
  }
}

// ---------- друзья ----------
function isFriend(a, b) { return !!friends.get(a)?.has(String(b)); }
function addFriend(a, b) {
  if (!friends.has(a)) friends.set(a, new Set());
  if (!friends.has(b)) friends.set(b, new Set());
  friends.get(a).add(b);
  friends.get(b).add(a);
}
function friendsOf(id) {
  return [...(friends.get(id) || [])].map(fid => {
    const p = profiles.get(fid);
    return p ? { id: p.id, name: p.name, photo: p.photo, online: sockets.has(fid) } : null;
  }).filter(Boolean);
}
function requestsOf(id) {
  return [...(friendReq.get(id) || [])].map(fid => {
    const p = profiles.get(fid);
    return p ? { id: p.id, name: p.name } : null;
  }).filter(Boolean);
}

// Профиль игрока с точки зрения смотрящего
function profileFor(targetId, viewerId) {
  const p = profiles.get(targetId);
  if (!p) return null;
  return {
    id: p.id, name: p.name, username: p.username, photo: p.photo,
    wins: p.wins, losses: p.losses, games: p.games,
    balance: targetId === viewerId ? p.balance : undefined,
    isFriend: isFriend(viewerId, targetId),
    isMe: targetId === viewerId,
    online: sockets.has(targetId),
  };
}

function inviteLink(roomId) {
  return `https://t.me/${BOT_USERNAME}?startapp=lobby_${roomId}`;
}

// ---------- лобби ----------
function createRoom(host, opts, password) {
  const id = uid().slice(0, 6).toUpperCase();
  const room = {
    id,
    hostId: host.id,
    password: password || null,
    players: [],
    game: null,
    scored: false,
    closed: false,
    readySet: new Set(),
    presence: {},
    createdAt: Date.now(),
    betLocked: 0,
    payouts: null,
    opts: {
      maxPlayers: clamp(Number(opts.maxPlayers) || 2, 2, 6),
      deckSize: [24, 36, 52].includes(Number(opts.deckSize)) ? Number(opts.deckSize) : 36,
      podkid: opts.podkid === 'neighbors' ? 'neighbors' : 'all',
      transfer: opts.transfer !== false,
      cheat: opts.cheat !== false,
      lossMode: opts.lossMode === 'draw' ? 'draw' : 'classic',
      bet: clamp(Number(opts.bet) || 0, 0, 5000),
    },
  };
  rooms.set(id, room);
  return room;
}

function joinRoom(room, playerId) {
  if (!room.players.some(p => p.id === playerId)) {
    const prof = profiles.get(playerId);
    room.players.push({ id: playerId, name: prof.name, photo: prof.photo });
    room.presence[playerId] = true;
  }
  clientRoom.set(playerId, room.id);
}

// Выход игрока из лобби (вне партии). Во время партии — см. surrender.
function leaveCurrentRoom(playerId) {
  const roomId = clientRoom.get(playerId);
  clientRoom.delete(playerId);
  const room = roomId && rooms.get(roomId);
  if (!room) return;

  // ставка возвращается, если партия не начиналась
  if (!(room.game && room.game.phase !== 'over') && room.betLocked > 0) {
    // ставка ещё не списана (партия не шла) — ничего не делаем
  }
  room.players = room.players.filter(p => p.id !== playerId);
  room.readySet.delete(playerId);
  delete room.presence[playerId];

  // лобби с одним игроком закрывается, оставшийся уходит в главное меню
  if (room.players.length <= 1) {
    closeRoom(room, 'Вы остались один — лобби закрыто');
    return;
  }
  if (room.hostId === playerId) room.hostId = room.players[0].id;
  broadcastRoom(room);
}

function closeRoom(room, reason) {
  room.closed = true;
  for (const p of room.players) {
    clientRoom.delete(p.id);
    sendTo(p.id, { t: 'left', reason });
  }
  room.players = [];
  rooms.delete(room.id);
  broadcastLobbies();
}

// ---------- старт партии ----------
// Партия стартует, когда ВСЕ игроки лобби нажали «Готов»
function tryStartRoom(room) {
  if (room.game && room.game.phase !== 'over') return false;
  if (room.players.length < 2) return false;
  if (room.readySet.size < room.players.length) return false;

  const bet = room.opts.bet || 0;
  if (bet > 0) {
    const poor = room.players.find(p => !profiles.canBet(p.id, bet));
    if (poor) {
      room.readySet.delete(poor.id);
      for (const s of roomSockets(room))
        send(s, { t: 'error', why: `У ${poor.name} не хватает денег на ставку ${bet} ₽` });
      return false;
    }
    for (const p of room.players) profiles.lockBet(p.id, bet);
  }
  room.betLocked = bet;

  try {
    room.game = new Durak({
      players: room.players.map(p => ({ id: p.id, name: p.name, photo: p.photo })),
      deckSize: room.opts.deckSize,
      podkid: room.opts.podkid,
      transfer: room.opts.transfer,
      cheat: room.opts.cheat,
      lossMode: room.opts.lossMode,
      seed: crypto.randomInt(1e9),
    });
  } catch (e) {
    for (const p of room.players) profiles.refundBet(p.id);
    room.betLocked = 0;
    for (const s of roomSockets(room)) send(s, { t: 'error', why: e.message });
    return false;
  }
  room.scored = false;
  room.payouts = null;
  room.readySet = new Set();
  room.startedAt = Date.now();
  return true;
}

// ---------- ставки и выплаты ----------
// Обычный финал: ставки проигравших идут в банк, банк делят победители по порядку выхода
// (первый забирает половину, второй четверть, … последний — остаток). Своя ставка возвращается.
export function computePayouts({ bet, players, losers, exitOrder }) {
  const loserSet = new Set(losers);
  const winners = players.filter(id => !loserSet.has(id));
  const payouts = {};
  for (const id of players) payouts[id] = 0;
  if (winners.length === 0 || losers.length === 0) return { refund: true, payouts };

  const pot = bet * losers.length;
  const ordered = [
    ...exitOrder.filter(id => winners.includes(id)),
    ...winners.filter(id => !exitOrder.includes(id)),
  ];
  let left = pot;
  ordered.forEach((id, i) => {
    const share = i === ordered.length - 1 ? left : Math.floor(left / 2);
    payouts[id] = share;
    left -= share;
  });
  return { refund: false, payouts, pot };
}

// Выход из партии: вышедший проигрывает ставку, остальные делят банк поровну
export function computeSurrenderPayouts({ bet, players, quitterId }) {
  const winners = players.filter(id => id !== quitterId);
  const payouts = {};
  for (const id of players) payouts[id] = 0;
  if (winners.length === 0) return { refund: true, payouts };
  const share = Math.floor((bet * 1) / winners.length);
  // банк — только ставка вышедшего; делим поровну, остаток — первому по порядку
  let left = bet;
  winners.forEach((id, i) => {
    const s = i === winners.length - 1 ? left : Math.floor(bet / winners.length);
    payouts[id] = s;
    left -= s;
  });
  void share;
  return { refund: false, payouts };
}

function settleRoom(room, g, opts = {}) {
  const bet = room.betLocked || 0;
  for (const p of room.players) profiles.recordResult(p.id, g.losers.includes(p.id));
  room.payouts = null;
  if (bet <= 0) return;

  const ids = room.players.map(p => p.id);

  if (opts.surrender) {
    const res = computeSurrenderPayouts({ bet, players: ids, quitterId: opts.surrender });
    for (const id of ids) {
      if (id === opts.surrender) {
        profiles.forfeit(id);                       // ставка вышедшего уходит в банк
      } else {
        profiles.payout(id, bet + res.payouts[id]); // своя ставка + доля банка
      }
    }
    room.payouts = res.payouts;
    return;
  }

  const res = computePayouts({
    bet,
    players: ids,
    losers: ids.filter(id => g.losers.includes(id)),
    exitOrder: g.exitOrder || [],
  });
  if (res.refund) {
    for (const id of ids) profiles.refundBet(id);
    room.payouts = Object.fromEntries(ids.map(id => [id, 0]));
    return;
  }
  for (const id of ids) {
    if (g.losers.includes(id)) {
      profiles.forfeit(id);
      res.payouts[id] = -bet;
    } else {
      profiles.payout(id, bet + res.payouts[id]);
    }
  }
  room.payouts = res.payouts;
}

// ---------- состояние для клиента ----------
function roomPublic(room) {
  return {
    id: room.id,
    host: profiles.get(room.hostId)?.name || '—',
    players: room.players.length,
    maxPlayers: room.opts.maxPlayers,
    locked: !!room.password,
    deckSize: room.opts.deckSize,
    podkid: room.opts.podkid,
    transfer: room.opts.transfer,
    cheat: room.opts.cheat,
    lossMode: room.opts.lossMode,
    bet: room.opts.bet,
    ready: room.readySet.size,
    inGame: !!(room.game && room.game.phase !== 'over'),
  };
}

function roomStateFor(room, playerId) {
  const inGame = !!(room.game && room.game.phase !== 'over');
  return {
    t: 'room',
    room: roomPublic(room),
    me: playerId,
    hostId: room.hostId,
    readyCount: room.readySet.size,
    players: room.players.map(p => ({
      id: p.id, name: p.name, photo: p.photo,
      ready: room.readySet.has(p.id),
      online: room.presence[p.id] !== false,
      coins: profiles.get(p.id)?.balance ?? 0,
      profile: profiles.public(p.id),
    })),
    // в лобби кнопка «Готов» показывается только до старта
    showReady: !inGame,
    game: room.game ? {
      ...room.game.publicState(playerId),
      bet: room.betLocked || 0,
      payouts: room.payouts || null,
    } : null,
  };
}

// ---------- запуск ----------
if (process.env.NO_LISTEN !== '1') {
  server.listen(PORT, () => {
    console.log(`Durak server on http://localhost:${PORT} (DEV: ${DEV ? 'без проверки подписи Telegram' : 'подпись проверяется'})`);
  });
}

export { server, rooms, profiles };
