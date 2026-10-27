// server/index.js — HTTP + WebSocket: лобби, стол, профиль
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
const PORT = Number(process.env.PORT || 3000);
const DEV = !BOT_TOKEN;   // без токена — режим разработки, подпись не проверяем

const profiles = new Profiles();
const rooms = new Map();       // id -> {id, opts, password, players[], game, spectators, createdAt}
const sockets = new Map();     // playerId -> ws
const clientRoom = new Map();  // playerId -> roomId

const uid = () => crypto.randomBytes(6).toString('hex');

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') {
    return json(res, { ok: true, dev: DEV, rooms: rooms.size, players: profiles.map.size });
  }
  if (url.pathname === '/api/config') {
    return json(res, { dev: DEV });
  }
  // статика Mini App
  let p = url.pathname === '/' ? '/index.html' : url.pathname;  const file = path.join(__dirname, '..', 'web', p);
  if (!file.startsWith(path.join(__dirname, '..', 'web'))) return json(res, { error: 'forbidden' }, 403);
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

wss.on('connection', (ws, req) => {
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
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.presence = room.presence || {};
        room.presence[ws.playerId] = false;
        broadcastRoom(room);
      }
    }
  });
});

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcastRoom(room) {
  for (const p of room.players) {
    const sock = sockets.get(p.id);
    if (sock) send(sock, roomStateFor(room, p.id));
  }
  for (const spec of room.spectators || []) {
    const sock = sockets.get(spec.id);
    if (sock) send(sock, roomStateFor(room, null));
  }
}

// ---------- авторизация ----------
function auth(ws, msg) {
  if (DEV) {
    // dev-режим: доверяем переданному id, но с префиксом
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

// ---------- обработчик сообщений ----------
function handle(ws, msg) {
  switch (msg.t) {
    case 'auth': {
      const prof = auth(ws, msg);
      if (!prof) return;
      send(ws, { t: 'auth_ok', profile: profiles.public(prof.id), dev: DEV });
      return;
    }
    case 'lobby_list': {
      send(ws, { t: 'lobby_list', rooms: [...rooms.values()].map(roomPublic) });
      return;
    }
    case 'create': {
      const me = requireAuth(ws); if (!me) return;
      const room = createRoom(me, msg.opts || {}, msg.password || null);
      joinRoom(room, me.id);
      broadcastRoom(room);
      broadcastLobbies();
      return;
    }
    case 'join': {
      const me = requireAuth(ws); if (!me) return;
      const room = rooms.get(msg.roomId);
      if (!room) return send(ws, { t: 'error', why: 'Лобби не найдено' });
      if (room.game && room.game.phase !== 'over')
        return send(ws, { t: 'error', why: 'Игра уже идёт' });
      if (room.players.length >= room.opts.maxPlayers)
        return send(ws, { t: 'error', why: 'Лобби заполнено' });
      if (room.password && room.password !== String(msg.password || ''))
        return send(ws, { t: 'error', why: 'Неверный пароль' });
      joinRoom(room, me.id);
      broadcastRoom(room);
      broadcastLobbies();
      return;
    }
    case 'leave': {
      const me = requireAuth(ws); if (!me) return;
      const room = rooms.get(clientRoom.get(me.id));
      if (!room) return;
      leaveRoom(room, me.id);
      broadcastRoom(room);
      broadcastLobbies();
      return;
    }
    case 'start': {
      const me = requireAuth(ws); if (!me) return;
      const room = rooms.get(clientRoom.get(me.id));
      if (!room) return send(ws, { t: 'error', why: 'Вы не в лобби' });
      if (room.hostId !== me.id) return send(ws, { t: 'error', why: 'Начинает только хост' });
      if (room.players.length < 2) return send(ws, { t: 'error', why: 'Нужно минимум 2 игрока' });

      // ---- ставка: проверяем у всех и блокируем ----
      const bet = room.opts.bet || 0;
      if (bet > 0) {
        for (const p of room.players) {
          if (!profiles.canBet(p.id, bet)) {
            return send(ws, { t: 'error', why: `У ${p.name} не хватает монет на ставку ${bet}` });
          }
        }
        for (const p of room.players) profiles.lockBet(p.id, bet);
      }
      room.betLocked = bet;

      try {
        room.game = new Durak({
          players: room.players.map(p => ({ id: p.id, name: p.name })),
          deckSize: room.opts.deckSize,
          podkid: room.opts.podkid,
          transfer: room.opts.transfer,
          cheat: room.opts.cheat,
          lossMode: room.opts.lossMode,
          seed: crypto.randomInt(1e9)
        });
      } catch (e) {
        // если партия не создалась — вернуть ставки
        for (const p of room.players) profiles.refundBet(p.id);
        room.betLocked = 0;
        return send(ws, { t: 'error', why: e.message });
      }
      room.startedAt = Date.now();
      broadcastRoom(room);
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
    case 'ping': send(ws, { t: 'pong' }); return;
  }
}

function requireAuth(ws) {
  if (!ws.playerId) { send(ws, { t: 'error', why: 'Нужна авторизация' }); return null; }
  return profiles.get(ws.playerId);
}

// ---------- ставки ----------
// Правило: в банк идут ставки ПРОИГРАВШИХ. Банк делят победители по порядку выхода:
// первый вышедший забирает половину остатка, второй — четверть и т.д.; последний получает остаток.
// Свою ставку победители возвращают себе.
export function computePayouts({ bet, players, losers, exitOrder }) {
  const loserSet = new Set(losers);
  const winners = players.filter(id => !loserSet.has(id));
  const payouts = {};
  for (const id of players) payouts[id] = 0;

  // все проиграли или никто не проиграл — ставки возвращаются
  if (winners.length === 0 || losers.length === 0) {
    return { refund: true, payouts };
  }

  const pot = bet * losers.length;
  // тем, кто не успел выйти, — в конец очереди
  const ordered = [
    ...exitOrder.filter(id => winners.includes(id)),
    ...winners.filter(id => !exitOrder.includes(id)),
  ];

  let left = pot;
  ordered.forEach((id, i) => {
    const isLast = i === ordered.length - 1;
    const share = isLast ? left : Math.floor(left / 2);
    payouts[id] = share;
    left -= share;
  });

  return { refund: false, payouts, pot };
}

function settleRoom(room, g) {
  const bet = room.betLocked || 0;
  for (const p of room.players) profiles.recordResult(p.id, g.losers.includes(p.id));
  room.payouts = null;
  if (bet <= 0) return;

  const ids = room.players.map(p => p.id);
  const res = computePayouts({
    bet,
    players: ids,
    losers: ids.filter(id => g.losers.includes(id)),
    exitOrder: g.exitOrder || [],
  });

  if (res.refund) {
    for (const p of room.players) profiles.refundBet(p.id);
    room.payouts = Object.fromEntries(ids.map(id => [id, 0]));
    return;
  }

  for (const p of room.players) {
    if (g.losers.includes(p.id)) {
      profiles.forfeit(p.id);                          // ставка проигравшего ушла в банк
      res.payouts[p.id] = -bet;
    } else {
      profiles.payout(p.id, bet + res.payouts[p.id]);  // своя ставка + доля банка
    }
  }
  room.payouts = res.payouts;
}

function createRoom(host, opts, password) {
  const id = uid().slice(0, 6).toUpperCase();
  const room = {
    id,
    hostId: host.id,
    password: password || null,
    players: [],
    spectators: [],
    game: null,
    scored: false,
    presence: {},
    createdAt: Date.now(),
    opts: {
      maxPlayers: clamp(Number(opts.maxPlayers) || 2, 2, 6),
      deckSize: [24, 36, 52].includes(Number(opts.deckSize)) ? Number(opts.deckSize) : 36,
      podkid: opts.podkid === 'neighbors' ? 'neighbors' : 'all',
      transfer: opts.transfer !== false,
      cheat: !!opts.cheat,
      lossMode: opts.lossMode === 'draw' ? 'draw' : 'classic',
      speed: ['fast', 'normal'].includes(opts.speed) ? opts.speed : 'normal',
      bet: clamp(Number(opts.bet) || 0, 0, 5000)
    }
  };
  rooms.set(id, room);
  return room;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function joinRoom(room, playerId) {
  if (!room.players.some(p => p.id === playerId)) {
    const prof = profiles.get(playerId);
    room.players.push({ id: playerId, name: prof.name, photo: prof.photo });
    room.presence[playerId] = true;
  }
  clientRoom.set(playerId, room.id);
}

function leaveRoom(room, playerId) {
  const wasInGame = room.game && room.game.phase !== 'over';

  // если партия ещё не началась — вернуть ставку
  if (!wasInGame && room.betLocked > 0) profiles.refundBet(playerId);

  room.players = room.players.filter(p => p.id !== playerId);
  clientRoom.delete(playerId);
  delete room.presence[playerId];
  // если игра идёт — игрок помечается как вышедший
  if (wasInGame) {
    const p = room.game.players.find(x => x.id === playerId);
    if (p) { p.out = true; }
  }
  if (room.players.length === 0) rooms.delete(room.id);
  else if (room.hostId === playerId) room.hostId = room.players[0].id;
}

function roomPublic(room) {
  return {
    id: room.id,
    host: profiles.public(room.hostId)?.name || '—',
    players: room.players.length,
    maxPlayers: room.opts.maxPlayers,
    locked: !!room.password,
    deckSize: room.opts.deckSize,
    podkid: room.opts.podkid,
    transfer: room.opts.transfer,
    cheat: room.opts.cheat,
    lossMode: room.opts.lossMode,
    bet: room.opts.bet || 0,
    inGame: !!(room.game && room.game.phase !== 'over')
  };
}

function roomStateFor(room, playerId) {
  return {
    t: 'room',
    room: roomPublic(room),
    me: playerId,
    hostId: room.hostId,
    players: room.players.map(p => ({
      ...p,
      online: room.presence[p.id] !== false,
      profile: profiles.public(p.id)
    })),
    game: room.game
      ? {
          ...room.game.publicState(playerId),
          bet: room.betLocked || 0,
          payouts: room.payouts || null,
          payoutDetail: room.payoutDetail || null
        }
      : null
  };
}

function broadcastLobbies() {
  const list = [...rooms.values()].map(roomPublic);
  for (const [, ws] of sockets) send(ws, { t: 'lobby_list', rooms: list });
}

// не поднимаем порт при импорте из тестов
if (process.env.NO_LISTEN !== '1') server.listen(PORT, () => {
  console.log(`Durak server on http://localhost:${PORT} ${DEV ? '(DEV: подпись Telegram не проверяется)' : '(prod)'}`);
});
