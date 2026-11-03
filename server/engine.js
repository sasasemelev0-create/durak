// engine.js — движок партии «Дурак» (v9)
//
// Фазы партии:
//   attack  — атакующий выкладывает первую карту
//   defend  — защитник отбивается; атакующие могут подкидывать карты тех же рангов
//   podkid  — атакующий нажал «Бито»: остальные (кроме защитника) подкидывают или пасуют
//   take    — защитник нажал «Беру»: остальные подкидывают или пасуют; на двоих — сразу
//   over    — партия окончена
//
// Правила, которые ОБЯЗАТЕЛЬНО соблюдает движок:
//   • защитник не закрывает кон и не отправляет карты в отбой сам;
//   • подкидывать можно только карту ранга, уже лежащего на столе;
//   • число атакующих карт на столе не превышает число карт в руке защитника
//     (отбивающие карты в счёт не идут);
//   • козырь — нижняя карта колоды, на руки не раздаётся до её конца;
//   • перевод — картой того же ранга, что на столе, и только пока ничего не отбито.
//
// Шулерство (единая модель, см. isLegalPlay):
//   • шулер может подкинуть, побить или перевести карту НЕ по правилам;
//   • такая карта ничем не выделена — никто, кроме проверяющих, не видит нарушения;
//   • любой игрок (не шулер) может «проверить» любую карту на столе, сколько угодно раз;
//   • если карта нарушает правила — она возвращается шулеру, и он до конца партии
//     играет только честно (cheatsLocked);
//   • если карта по правилам — ничего не происходит. Штрафа за проверку нет.
//   Игра при этом НЕ блокируется: проверка не останавливает ход.

import { buildDeck, beats, shuffle, mulberry32, sortHand, label } from './cards.js';

export const MAX_ATTACKS = 6;
export const RECALL_QUOTA = 5;

export class Durak {
  constructor(opts = {}) {
    this.opts = {
      players: opts.players || [],
      deckSize: opts.deckSize || 36,
      podkid: opts.podkid || 'all',         // 'all' | 'neighbors'
      transfer: opts.transfer !== false,
      cheat: !!opts.cheat,
      lossMode: opts.lossMode || 'classic', // 'classic' | 'draw'
      seed: opts.seed ?? Date.now(),
      recallQuota: opts.recallQuota ?? RECALL_QUOTA,
    };
    if (this.opts.players.length < 2 || this.opts.players.length > 6)
      throw new Error('Игроков должно быть от 2 до 6');

    const rnd = mulberry32(this.opts.seed);
    // козырь — НИЖНЯЯ карта колоды; раздача через pop() с конца, поэтому кладём в начало
    const deck = shuffle(buildDeck(this.opts.deckSize), rnd);
    this.trumpCard = deck[0];
    this.trump = this.trumpCard.s;
    this.deck = deck;

    this.players = this.opts.players.map((p, i) => ({
      id: p.id, name: p.name, photo: p.photo || null, idx: i,
      hand: [],
      out: false,
      cheatsLocked: false,          // пойманный шулер: до конца партии играет честно
      recallsLeft: this.opts.recallQuota,
    }));

    this.discard = [];
    this.table = [];                // [{attack, defense, attackerIdx}]
    this.attackerIdx = 0;
    this.defenderIdx = 1 % this.players.length;
    this.phase = 'attack';
    this.takePending = null;        // {defenderIdx, passed:Set}
    this.podkidPending = null;      // {passed:Set}
    this.losers = [];
    this.exitOrder = [];
    this.surrendered = [];
    this.lastCardPlayerIdx = null;
    this.log = [];
    this.stallBouts = 0;
    this.lastDiscardCount = 0;

    // раздача по 6 карт по кругу
    for (let k = 0; k < 6; k++)
      for (const p of this.players) if (this.deck.length) p.hand.push(this.deck.pop());

    this.pushLog(`Козырь: ${label(this.trumpCard)}. Первым ходит ${this.players[this.attackerIdx].name}`);
  }

  // ---------- утилиты ----------
  player(i) { return this.players[i]; }
  playerById(id) { return this.players.find(p => p.id === id); }
  idxOf(id) { return this.players.findIndex(p => p.id === id); }

  pushLog(text) {
    this.log.push({ t: Date.now(), text });
    if (this.log.length > 300) this.log.shift();
  }

  markOut(p) {
    if (!p || p.out) return;
    p.out = true;
    if (!this.exitOrder.includes(p.id)) this.exitOrder.push(p.id);
    this.pushLog(`${p.name} вышел из игры`);
  }

  activeCount() { return this.players.filter(p => !p.out).length; }

  nextActive(fromIdx) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (fromIdx + k) % n;
      if (!this.players[i].out) return i;
    }
    return fromIdx;
  }

  prevActive(fromIdx) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (fromIdx - k + n * 2) % n;
      if (!this.players[i].out) return i;
    }
    return fromIdx;
  }

  isNeighborOfDefender(idx) {
    return idx === this.prevActive(this.defenderIdx) || idx === this.nextActive(this.defenderIdx);
  }

  tableRanks() {
    const set = new Set();
    for (const s of this.table) {
      set.add(s.attack.r);
      if (s.defense) set.add(s.defense.r);
    }
    return set;
  }

  // Сколько атакующих карт может лежать на столе (по числу карт защитника)
  attackLimit() {
    const d = this.players[this.defenderIdx];
    return Math.min(MAX_ATTACKS, d.hand.length + this.table.filter(s => s.defense).length);
  }

  refillHands() {
    const order = [];
    for (let k = 0; k < this.players.length; k++) order.push((this.attackerIdx + k) % this.players.length);
    for (const idx of order) {
      const p = this.players[idx];
      if (p.out) continue;
      while (p.hand.length < 6 && this.deck.length) p.hand.push(this.deck.pop());
    }
    for (const p of this.players) {
      if (!p.out && p.hand.length === 0 && this.deck.length === 0) this.markOut(p);
    }
  }

  // ---------- ЕДИНАЯ ПРОВЕРКА ПРАВИЛ (для шулерства и для обычного хода) ----------
  // Возвращает true, если действие по правилам. Используется и при ходе, и при проверке.
  //   kind: 'attack' — подкидывание; 'defend' — бой карты card по карте target;
  //         'transfer' — перевод картой card
  isLegalPlay(kind, card, target = null) {
    if (kind === 'defend') {
      return !!target && beats(card, target, this.trump);
    }
    if (kind === 'transfer') {
      return this.tableRanks().has(card.r) && this.table.every(s => !s.defense);
    }
    // attack / подкидывание
    if (this.table.length === 0) return true;          // первую карту атакующий кладёт свободно
    return this.tableRanks().has(card.r) && this.table.length < this.attackLimit();
  }

  // Совместимость: проверка подкидывания картой card игроком idx (возвращает {ok, why})
  checkPodkid(idx, card) {
    if (this.table.length === 0) {
      if (idx !== this.attackerIdx) return { ok: false, why: 'Первым ходит атакующий' };
      return { ok: true };
    }
    if (!this.tableRanks().has(card.r))
      return { ok: false, why: 'Подкидывать можно только карту того ранга, что уже на столе' };
    if (this.table.length >= this.attackLimit())
      return { ok: false, why: 'Карт на столе больше, чем у защитника на руках' };
    if (this.opts.podkid === 'neighbors' && idx !== this.attackerIdx && !this.isNeighborOfDefender(idx))
      return { ok: false, why: 'Подкидывать могут только соседи защитника' };
    return { ok: true };
  }

  // Может ли игрок idx подкинуть (вне фаз «беру» и «бито»)
  mayAttack(idx) {
    const p = this.players[idx];
    if (!p || p.out || idx === this.defenderIdx) return false;
    if (this.opts.podkid === 'all') return true;
    return this.isNeighborOfDefender(idx) || idx === this.attackerIdx;
  }

  canPodkidNow(idx) {
    if (this.phase !== 'defend' || this.takePending || this.podkidPending) return false;
    return this.mayAttack(idx) && this.table.length > 0;
  }

  canTransferNow(idx) {
    if (!this.opts.transfer || this.phase !== 'defend') return false;
    if (idx !== this.defenderIdx) return false;
    return this.table.length > 0 && this.table.every(s => !s.defense);
  }

  // ---------- состояние для клиента ----------
  // Шулерская карта НИЧЕМ не помечается — клиент её не отличает.
  publicState(forPlayerId) {
    const me = this.playerById(forPlayerId);
    const meIdx = me ? me.idx : -1;
    return {
      phase: this.phase,
      trump: this.trump,
      trumpCard: this.trumpCard,
      deckCount: this.deck.length,
      discardCount: this.discard.length,
      table: this.table.map(s => ({
        attack: s.attack,
        defense: s.defense || null,
        attacker: this.players[s.attackerIdx]?.id,
      })),
      attackerId: this.players[this.attackerIdx]?.id,
      defenderId: this.players[this.defenderIdx]?.id,
      players: this.players.map(p => ({
        id: p.id, name: p.name, idx: p.idx, photo: p.photo || null,
        count: p.hand.length, out: p.out,
        hand: p.id === forPlayerId ? sortHand(p.hand, this.trump) : null,
        cheatsLocked: p.cheatsLocked,
        recallsLeft: p.recallsLeft,
        passed: this.isPassed(p.id),
      })),
      you: me ? {
        id: me.id,
        hand: sortHand(me.hand, this.trump),
        isAttacker: meIdx === this.attackerIdx,
        isDefender: meIdx === this.defenderIdx,
        recallsLeft: me.recallsLeft,
        recallable: this.recallableFor(meIdx),
        cheatsLocked: me.cheatsLocked,
        passed: this.isPassed(me.id),
        canConfirmTake: this.canConfirmTake(me.id),
        canPodkid: this.canPodkidNow(meIdx),
        canTransfer: this.canTransferNow(meIdx),
        canAccuse: this.table.length > 0,
      } : null,
      takePhase: this.takePending ? {
        active: true,
        defenderId: this.players[this.takePending.defenderIdx].id,
        waitingFor: this.waitingPassers().map(x => x.name),
        allPassed: this.allPassed(),
        maxCards: this.attackLimit(),
      } : null,
      podkidPhase: this.podkidPending ? {
        active: true,
        waitingFor: this.waitingPodkidPassers().map(x => x.name),
        allPassed: this.allPodkidPassed(),
      } : null,
      losers: this.losers,
      exitOrder: this.exitOrder,
      log: this.log.slice(-40),
      opts: { ...this.opts, seed: undefined },
    };
  }

  recallableFor(idx) {
    if (this.phase === 'over' || !this.table.length) return null;
    if (this.takePending || this.podkidPending) return null;
    const p = this.players[idx];
    if (!p || p.recallsLeft <= 0) return null;
    const slot = this.table[this.table.length - 1];
    if (slot.defense) return idx === this.defenderIdx ? slot.defense.id : null;
    return slot.attackerIdx === idx ? slot.attack.id : null;
  }

  isPassed(playerId) {
    if (this.takePending) return this.takePending.passed.has(playerId);
    if (this.podkidPending) return this.podkidPending.passed.has(playerId);
    return false;
  }

  // ---------- атака / подкидывание ----------
  // Шулер может подкинуть неподходящую карту, если cheat=true и он ещё не пойман.
  // Карта встаёт на стол как обычная; никаких пометок не ставится.
  attack(playerId, cardId, { cheat = false } = {}) {
    if (this.phase === 'over') return { ok: false, why: 'Партия окончена' };
    const idx = this.idxOf(playerId);
    const p = this.players[idx];
    if (!p) return { ok: false, why: 'Нет игрока' };
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return { ok: false, why: 'Нет такой карты в руке' };
    if (idx === this.defenderIdx) return { ok: false, why: 'Защитник не атакует' };

    if (this.takePending) {
      if (this.takePending.passed.has(p.id)) return { ok: false, why: 'Вы уже сказали пас' };
    } else if (this.podkidPending) {
      if (this.podkidPending.passed.has(p.id)) return { ok: false, why: 'Вы уже сказали пас' };
    } else {
      if (this.phase !== 'defend' && this.phase !== 'attack') return { ok: false, why: 'Сейчас нельзя ходить' };
      if (this.table.length === 0 && idx !== this.attackerIdx) return { ok: false, why: 'Первым ходит атакующий' };
      if (this.table.length > 0 && !this.mayAttack(idx)) return { ok: false, why: 'Сейчас подкидывать не ваша очередь' };
    }

    const inWindow = !!(this.takePending || this.podkidPending) || this.table.length > 0;
    const legal = this.isLegalPlay('attack', card);
    const cardInWindowOk = !inWindow || this.tableRanks().has(card.r) || this.table.length === 0;

    if (!legal || !cardInWindowOk) {
      // нарушение правил: разрешено только шулеру в режиме шулеров
      if (!this.opts.cheat || !cheat) return { ok: false, why: this.attackWhy(card) };
      if (p.cheatsLocked) return { ok: false, why: 'Вас поймали за шулерство — до конца партии играйте честно' };
    }

    if (this.table.length >= this.attackLimit() && this.table.length > 0)
      return { ok: false, why: `У защитника на руках ${this.players[this.defenderIdx].hand.length} карт — больше подкинуть нельзя` };

    p.hand = p.hand.filter(c => c.id !== cardId);
    this.table.push({ attack: card, defense: null, attackerIdx: idx, how: 'attack', legal });
    this.lastCardPlayerIdx = idx;
    if (this.table.length === 1) this.phase = 'defend';
    this.pushLog(`${p.name} ходит ${label(card)}`);
    return { ok: true };
  }

  attackWhy(card) {
    if (!this.tableRanks().has(card.r) && this.table.length > 0)
      return 'Подкидывать можно только карту того ранга, что уже на столе';
    return 'У защитника недостаточно карт для этого подкидывания';
  }

  // ---------- защита (бой) ----------
  // Шулер может побить неподходящей картой, если cheat=true и он ещё не пойман.
  defend(playerId, cardId, targetAttackId, { cheat = false } = {}) {
    if (this.phase !== 'defend') return { ok: false, why: 'Сейчас не защита' };
    if (this.takePending || this.podkidPending) return { ok: false, why: 'Сейчас идёт подкидывание' };
    const idx = this.idxOf(playerId);
    if (idx !== this.defenderIdx) return { ok: false, why: 'Вы не защищаетесь' };
    const p = this.players[idx];
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return { ok: false, why: 'Нет такой карты в руке' };

    let slot;
    if (targetAttackId) {
      slot = this.table.find(s => s.attack.id === targetAttackId);
      if (!slot) return { ok: false, why: 'Этой карты нет на столе' };
      if (slot.defense) return { ok: false, why: `${label(slot.attack)} уже отбита` };
    } else {
      slot = this.table.find(s => !s.defense);
    }
    if (!slot) return { ok: false, why: 'Нечего бить' };

    if (!this.isLegalPlay('defend', card, slot.attack)) {
      if (!this.opts.cheat || !cheat || p.cheatsLocked) {
        const canBeatAny = this.table.filter(x => !x.defense && beats(card, x.attack, this.trump));
        const hint = canBeatAny.length
          ? ` — она бьёт ${label(canBeatAny[0].attack)}, перетащите её на нужную карту`
          : '';
        return { ok: false, why: `${label(card)} не бьёт ${label(slot.attack)}${hint}` };
      }
      if (p.cheatsLocked) return { ok: false, why: 'Вас поймали за шулерство — до конца партии играйте честно' };
    }

    p.hand = p.hand.filter(c => c.id !== cardId);
    slot.defense = card;
    slot.defenseLegal = beats(card, slot.attack, this.trump);
    this.pushLog(`${p.name} бьёт ${label(slot.attack)} — ${label(card)}`);
    return { ok: true };
  }

  // ---------- перевод ----------
  // Шулер может перевести картой не того ранга, если cheat=true и он ещё не пойман.
  transfer(playerId, cardId, { cheat = false } = {}) {
    if (!this.opts.transfer) return { ok: false, why: 'Режим без перевода' };
    if (this.phase !== 'defend') return { ok: false, why: 'Сейчас не защита' };
    const idx = this.idxOf(playerId);
    if (idx !== this.defenderIdx) return { ok: false, why: 'Переводить может только защищающийся' };
    if (this.table.some(s => s.defense)) return { ok: false, why: 'Перевод возможен, только пока ничего не отбито' };

    const p = this.players[idx];
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return { ok: false, why: 'Нет такой карты' };

    const nextDef = this.nextActive(idx);
    const nextP = this.players[nextDef];
    if (nextP.hand.length < this.table.length + 1)
      return { ok: false, why: `У ${nextP.name} не хватает карт для перевода` };

    if (!this.isLegalPlay('transfer', card)) {
      if (!this.opts.cheat || !cheat) return { ok: false, why: 'Для перевода нужен ранг, который уже на столе' };
      if (p.cheatsLocked) return { ok: false, why: 'Вас поймали за шулерство — до конца партии играйте честно' };
    }

    const transferLegal = this.isLegalPlay('transfer', card);
    p.hand = p.hand.filter(c => c.id !== cardId);
    this.table.push({ attack: card, defense: null, attackerIdx: idx, how: 'transfer', legal: transferLegal });
    this.lastCardPlayerIdx = idx;
    this.attackerIdx = idx;
    this.defenderIdx = nextDef;
    this.phase = 'defend';
    this.pushLog(`${p.name} переводит на ${nextP.name} (${label(card)})`);
    return { ok: true };
  }

  // ---------- «Бито» атакующего ----------
  endBout(playerId) {
    if (this.takePending || this.podkidPending) return { ok: false, why: 'Идёт подкидывание' };
    if (this.phase !== 'defend' && this.phase !== 'attack') return { ok: false, why: 'Нечего завершать' };
    const idx = this.idxOf(playerId);
    if (idx === this.defenderIdx) return { ok: false, why: 'Карты в отбой отправляет атакующий' };
    if (idx !== this.attackerIdx) return { ok: false, why: 'Бито нажимает первый атакующий' };
    if (this.table.some(s => !s.defense)) return { ok: false, why: 'Есть неотбитые карты' };
    if (this.table.length === 0) return { ok: false, why: 'На столе нет карт' };

    // на двоих подкидывать некому — карты сразу в отбой
    if (this.activeCount() <= 2) {
      this.pushLog(`${this.players[idx].name}: бито`);
      return this.finishBoutToDiscard();
    }

    this.podkidPending = { passed: new Set() };
    this.phase = 'podkid';
    if (this.waitingPodkidPassers().length === 0) return this.finishBoutToDiscard();
    this.pushLog(`${this.players[idx].name}: бито. Остальные могут подкинуть или сказать пас`);
    return { ok: true };
  }

  waitingPodkidPassers() {
    if (!this.podkidPending) return [];
    return this.players.filter(x => !x.out && x.idx !== this.defenderIdx && !this.podkidPending.passed.has(x.id));
  }

  allPodkidPassed() {
    return !!this.podkidPending && this.waitingPodkidPassers().length === 0;
  }

  passPodkidAfterBito(playerId) {
    if (!this.podkidPending) return { ok: false, why: 'Сейчас нечего подкидывать' };
    const p = this.playerById(playerId);
    if (!p) return { ok: false, why: 'Нет игрока' };
    if (p.idx === this.defenderIdx) return { ok: false, why: 'Защитник не пасует' };
    if (this.podkidPending.passed.has(p.id)) return { ok: false, why: 'Вы уже сказали пас' };
    this.podkidPending.passed.add(p.id);
    this.pushLog(`${p.name}: пас`);
    if (this.allPodkidPassed()) return this.finishBoutToDiscard();
    return { ok: true, allPassed: false };
  }

  finishBoutToDiscard() {
    const cards = this.table.flatMap(s => [s.attack, s.defense]).filter(Boolean);
    this.discard.push(...cards);
    this.pushLog(cards.length ? 'Бито — карты уходят в отбой' : 'Бито');
    this.table = [];
    this.podkidPending = null;
    this.afterBout(this.defenderIdx, false);
    return { ok: true, discarded: true };
  }

  // ---------- «Беру» защитника ----------
  takeCards(playerId) {
    if (this.phase !== 'defend') return { ok: false, why: 'Сейчас не защита' };
    if (this.takePending || this.podkidPending) return { ok: false, why: 'Уже идёт подкидывание' };
    const idx = this.idxOf(playerId);
    if (idx !== this.defenderIdx) return { ok: false, why: 'Взять может только защищающийся' };
    if (!this.table.length) return { ok: false, why: 'На столе нет карт' };

    this.takePending = { defenderIdx: idx, passed: new Set() };
    this.phase = 'take';
    if (this.waitingPassers().length === 0) {
      this.pushLog(`${this.players[idx].name} берёт`);
      return { ok: true, allPassed: true };
    }
    this.pushLog(`${this.players[idx].name} берёт. Остальные могут подкинуть карты`);
    return { ok: true };
  }

  waitingPassers() {
    if (!this.takePending) return [];
    return this.players.filter(x =>
      !x.out && x.idx !== this.takePending.defenderIdx && !this.takePending.passed.has(x.id));
  }

  allPassed() {
    return !!this.takePending && this.waitingPassers().length === 0;
  }

  // Защитник забирает: на двоих — сразу, на троих и больше — после всех пасов
  canConfirmTake(playerId) {
    if (!this.takePending) return false;
    if (this.idxOf(playerId) !== this.takePending.defenderIdx) return false;
    return this.allPassed() || this.activeCount() <= 2;
  }

  passPodkid(playerId) {
    if (!this.takePending) return { ok: false, why: 'Сейчас нечего подкидывать' };
    const p = this.playerById(playerId);
    if (!p) return { ok: false, why: 'Нет игрока' };
    if (p.idx === this.takePending.defenderIdx) return { ok: false, why: 'Защитник не пасует — он забирает' };
    if (this.takePending.passed.has(p.id)) return { ok: false, why: 'Вы уже сказали пас' };
    this.takePending.passed.add(p.id);
    this.pushLog(`${p.name}: пас`);
    return { ok: true, allPassed: this.allPassed() };
  }

  confirmTake(playerId) {
    if (!this.takePending) return { ok: false, why: 'Вы не брали карты' };
    const idx = this.idxOf(playerId);
    if (idx !== this.takePending.defenderIdx) return { ok: false, why: 'Забрать может только защищающийся' };
    if (!this.canConfirmTake(playerId)) return { ok: false, why: 'Дождитесь, пока остальные скажут пас' };

    const d = this.players[idx];
    const cards = this.table.flatMap(s => [s.attack, s.defense]).filter(Boolean);
    d.hand.push(...cards);
    this.pushLog(`${d.name} забирает ${cards.length} карт`);
    this.table = [];
    this.takePending = null;
    this.afterBout(idx, true);
    return { ok: true };
  }

  // ---------- выход из партии ----------
  surrender(playerId) {
    const p = this.playerById(playerId);
    if (!p) return { ok: false, why: 'Нет игрока' };
    if (this.phase === 'over') return { ok: false, why: 'Партия уже окончена' };
    if (p.out) return { ok: false, why: 'Вы уже вышли' };
    this.surrendered.push(p.id);
    this.losers = [p.id];
    this.pushLog(`${p.name} вышел из партии — засчитано поражение`);
    this.markOut(p);
    this.phase = 'over';
    return { ok: true };
  }

  // ---------- после кона ----------
  afterBout(takerIdx, took) {
    this.takePending = null;
    this.podkidPending = null;
    this.refillHands();

    // классика: если защитник отбился — он становится атакующим; если забрал — атакует следующий
    let nextAttacker = took ? this.nextActive(takerIdx) : this.defenderIdx;
    if (this.players[nextAttacker].out) nextAttacker = this.nextActive(nextAttacker);
    this.attackerIdx = nextAttacker;
    this.defenderIdx = this.nextActive(nextAttacker);
    this.phase = 'attack';

    if (this.discard.length > this.lastDiscardCount) {
      this.lastDiscardCount = this.discard.length;
      this.stallBouts = 0;
    } else {
      this.stallBouts++;
    }
    const stallLimit = this.players.length * 3;
    if (this.stallBouts >= stallLimit && this.deck.length === 0) {
      this.pushLog('Игра затянулась — итог по картам на руках');
      this.forceResultByHands();
      return;
    }
    this.checkGameOver();
  }

  forceResultByHands() {
    const alive = this.players.filter(p => !p.out && p.hand.length > 0);
    this.phase = 'over';
    if (alive.length === 0) { this.losers = []; return; }
    const max = Math.max(...alive.map(p => p.hand.length));
    const worst = alive.filter(p => p.hand.length === max);
    if (worst.length === 1) { this.losers = [worst[0].id]; return; }
    const last = this.lastCardPlayerIdx != null ? this.players[this.lastCardPlayerIdx] : null;
    this.losers = last && worst.some(p => p.id === last.id) ? [last.id] : [worst[0].id];
  }

  // ---------- проверка шулерства ----------
  // Любой игрок (не владелец карты) может проверить ЛЮБУЮ карту на столе, сколько угодно раз.
  //   • карта нарушает правила → её возвращают владельцу, он больше не шулерит;
  //   • карта по правилам → ничего не происходит, штрафа нет.
  // Проверяется по самому факту хода (рангам и числам), а не по метке.
  // cardId — id атакующей карты (slot.attack) или отбивающей карты (slot.defense).
  checkCard(checkerId, cardId) {
    if (!this.opts.cheat) return { ok: false, why: 'Режим без шулеров' };
    const checker = this.playerById(checkerId);
    if (!checker) return { ok: false, why: 'Нет игрока' };

    // ищем карту на столе: атакующую или отбивающую
    let slotIdx = -1, side = null;
    this.table.forEach((s, i) => {
      if (s.attack.id === cardId) { slotIdx = i; side = 'attack'; }
      else if (s.defense && s.defense.id === cardId) { slotIdx = i; side = 'defense'; }
    });
    if (slotIdx < 0) return { ok: false, why: 'Карты нет на столе' };

    const slot = this.table[slotIdx];
    const ownerIdx = side === 'attack' ? slot.attackerIdx : this.defenderIdx;
    const owner = this.players[ownerIdx];
    if (owner.id === checker.id) return { ok: false, why: 'Свою карту проверять нельзя' };

    // законность заранее записана при ходе — проверка не угадывает
    const legal = side === 'attack' ? slot.legal !== false : slot.defenseLegal !== false;
    if (legal) {
      this.pushLog(`${checker.name} проверил карту — всё по правилам`);
      return { ok: true, legal: true };
    }

    // нарушение: карта возвращается владельцу, он больше не шулерит
    if (side === 'attack') {
      // атакующая карта убирается со стола вместе с отбивающей (если была)
      this.table.splice(slotIdx, 1);
      owner.hand.push(slot.attack);
      if (slot.defense) this.players[this.defenderIdx].hand.push(slot.defense);
    } else {
      // отбивающая карта возвращается защитнику; атакующая остаётся на столе без отбоя
      const back = slot.defense;
      slot.defense = null;
      owner.hand.push(back);
    }
    owner.cheatsLocked = true;
    this.pushLog(`${checker.name} поймал ${owner.name} за руку. Карта возвращена, шулерить он больше не может`);
    if (this.table.length === 0 && this.phase === 'defend') this.phase = 'attack';
    return { ok: true, legal: false, caught: owner.id };
  }

  // ---------- проигрыш ----------
  checkGameOver() {
    const withCards = this.players.filter(p => !p.out && p.hand.length > 0);
    const inDeck = this.deck.length > 0;
    if (inDeck || withCards.length > 1) return;

    this.phase = 'over';
    if (withCards.length === 1) {
      this.losers = [withCards[0].id];
      this.pushLog(`${withCards[0].name} остался с картами — он дурак`);
      return;
    }
    const last = this.lastCardPlayerIdx != null ? this.players[this.lastCardPlayerIdx] : null;
    this.losers = last ? [last.id] : [];
    this.pushLog(`Карты закончились — проигрывает ${last ? last.name : '—'}, последним выложивший карту`);
  }

  // ---------- возврат своей карты ----------
  recall(playerId, cardId) {
    const idx = this.idxOf(playerId);
    const p = this.players[idx];
    if (!p) return { ok: false, why: 'Нет игрока' };
    if (p.recallsLeft <= 0) return { ok: false, why: 'Возвраты закончились' };
    if (this.phase === 'over') return { ok: false, why: 'Партия окончена' };
    if (this.takePending || this.podkidPending) return { ok: false, why: 'Сейчас карты не возвращают' };
    if (this.table.length === 0) return { ok: false, why: 'Стол пуст' };

    const slot = this.table[this.table.length - 1];
    let card = null;
    if (slot.defense && slot.defense.id === cardId && idx === this.defenderIdx) card = slot.defense;
    else if (!slot.defense && slot.attack.id === cardId && slot.attackerIdx === idx) card = slot.attack;
    if (!card) return { ok: false, why: 'Вернуть можно только последнюю свою карту на столе' };

    if (slot.defense && slot.defense.id === cardId) slot.defense = null;
    else this.table.pop();
    p.hand.push(card);
    p.recallsLeft--;
    this.pushLog(`${p.name} возвращает карту ${label(card)}`);
    if (this.table.length === 0) this.phase = 'attack';
    return { ok: true };
  }
}
