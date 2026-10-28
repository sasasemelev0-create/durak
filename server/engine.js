// engine.js — движок партии «Дурак» (v6)
//
// Фазы партии:
//   attack   — атакующий выкладывает первую карту
//   defend   — защитник отбивается, атакующие могут подкидывать (по рангу на столе)
//   podkid   — атакующий нажал «Бито»: остальные (кроме защитника) подкидывают или пасуют
//   take     — защитник нажал «Беру»: ждём, пока все остальные (кроме защитника) спасуют
//   over     — партия окончена
//
// Правила, которые ОБЯЗАТЕЛЬНО соблюдает движок:
//   • защитник никогда не закрывает кон и не отправляет карты в отбой сам;
//   • подкидывать можно только карты того ранга, что уже лежат на столе;
//   • число карт на столе (атакующих) не может превышать число карт в руке защитника
//     (карты, которыми он отбился, в счёт не идут);
//   • козырь — нижняя карта колоды, на руки не раздаётся до конца колоды;
//   • шулерство: карта вне правил помечается как спорная; если её поймали — она
//     возвращается шулеру, и он до конца партии играет только честно.

import { buildDeck, beats, shuffle, mulberry32, sortHand, label } from './cards.js';

export const MAX_ATTACKS = 6;
export const RECALL_QUOTA = 5;   // сколько раз за партию можно вернуть свою карту

export class Durak {
  constructor(opts = {}) {
    this.opts = {
      players: opts.players || [],          // [{id, name, photo}]
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
    // Колода: козырь — НИЖНЯЯ карта. Раздача идёт через pop() (с конца),
    // поэтому козырь кладём в начало массива: он уйдёт на руки последним.
    const deck = shuffle(buildDeck(this.opts.deckSize), rnd);
    this.trumpCard = deck[0];
    this.trump = this.trumpCard.s;
    this.deck = deck;

    this.players = this.opts.players.map((p, i) => ({
      id: p.id, name: p.name, photo: p.photo || null, idx: i,
      hand: [],
      out: false,                 // вышел из игры (нет карт и колоды)
      cheatsLocked: false,        // пойманный шулер: до конца партии играет честно
      cheatAccusedThisBout: false,
      recallsLeft: this.opts.recallQuota,
      passedPodkid: false,
    }));

    this.discard = [];
    this.table = [];               // [{attack, defense, attackerIdx}]
    this.attackerIdx = 0;
    this.defenderIdx = 1 % this.players.length;
    this.phase = 'attack';
    this.takePending = null;       // {defenderIdx, passed:Set} — фаза «беру»
    this.podkidPending = null;     // {passed:Set} — фаза после «Бито» атакующего
    this.pendingCheat = null;      // {playerIdx, slotIndex, cardId}
    this.losers = [];
    this.exitOrder = [];           // порядок выхода из игры (первый вышедший — первый)
    this.surrendered = [];
    this.lastCardPlayerIdx = null; // кто последним выложил карту (для проигрыша)
    this.log = [];
    // защита от вечной партии: если несколько конов подряд ничего не уходит в отбой,
    // игра завершается по картам на руках (см. forceResultByHands)
    this.stallBouts = 0;
    this.lastDiscardCount = 0;

    // Раздача по 6 карт, по одной карте по кругу
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

  // следующий НЕ вышедший игрок по кругу
  nextActive(fromIdx) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (fromIdx + k) % n;
      if (!this.players[i].out) return i;
    }
    return fromIdx;
  }

  // соседи защитника (для режима «соседи»)
  isNeighborOfDefender(idx) {
    return idx === this.prevActive(this.defenderIdx) || idx === this.nextActive(this.defenderIdx);
  }

  prevActive(fromIdx) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (fromIdx - k + n * 2) % n;
      if (!this.players[i].out) return i;
    }
    return fromIdx;
  }

  tableRanks() {
    const set = new Set();
    for (const s of this.table) {
      set.add(s.attack.r);
      if (s.defense) set.add(s.defense.r);
    }
    return set;
  }

  // Сколько атакующих карт можно держать на столе (в счёт идут только атакующие)
  attackLimit() {
    const d = this.players[this.defenderIdx];
    return Math.min(MAX_ATTACKS, d.hand.length + this.table.filter(s => s.defense).length);
  }

  // Добор карт до 6: сначала атакующий, потом остальные по кругу
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

  // Карту, которую игрок может вернуть (последняя выложенная им, пока кон не закрыт)
  recallableFor(idx) {
    if (this.phase === 'over' || !this.table.length) return null;
    if (this.pendingCheat || this.takePending || this.podkidPending) return null;
    const p = this.players[idx];
    if (!p || p.recallsLeft <= 0) return null;
    const slot = this.table[this.table.length - 1];
    if (slot.defense) return idx === this.defenderIdx ? slot.defense.id : null;
    return slot.attackerIdx === idx ? slot.attack.id : null;
  }

  // ---------- состояние для клиента ----------
  publicState(forPlayerId) {
    const me = this.playerById(forPlayerId);
    const meIdx = me ? me.idx : -1;
    const defId = this.players[this.defenderIdx]?.id;
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
      defenderId: defId,
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
      pendingCheat: this.pendingCheat ? {
        playerId: this.players[this.pendingCheat.playerIdx].id,
        playerName: this.players[this.pendingCheat.playerIdx].name,
        cardId: this.pendingCheat.cardId,
      } : null,
      log: this.log.slice(-40),
      opts: { ...this.opts, seed: undefined },
    };
  }

  // ---------- право на ходы ----------
  // Может ли игрок подкидывать карты прямо сейчас (вне фаз «беру» и «подкидывания»)
  mayAttack(idx) {
    const p = this.players[idx];
    if (!p || p.out || idx === this.defenderIdx) return false;
    if (this.opts.podkid === 'all') return true;
    return this.isNeighborOfDefender(idx) || idx === this.attackerIdx;
  }

  // Можно ли подкидывать сейчас (в обычном ходу атаки)
  canPodkidNow(idx) {
    if (this.phase !== 'defend' || this.pendingCheat || this.takePending || this.podkidPending) return false;
    return this.mayAttack(idx) && this.table.length > 0;
  }

  // Перевод доступен защитнику, пока ничего не отбито
  canTransferNow(idx) {
    if (!this.opts.transfer || this.phase !== 'defend' || this.pendingCheat) return false;
    if (idx !== this.defenderIdx) return false;
    return this.table.length > 0 && this.table.every(s => !s.defense);
  }

  // Проверка подкидывания картой card игроком idx
  // (возвращает {ok, why}); cheat — карта вне правил
  checkPodkid(idx, card) {
    if (this.table.length === 0) {
      if (idx !== this.attackerIdx) return { ok: false, why: 'Первым ходит атакующий' };
      return { ok: true };
    }
    if (!this.tableRanks().has(card.r))
      return { ok: false, why: 'Подкидывать можно только карту того ранга, что уже на столе' };
    if (this.table.filter(s => !s.defense).length + 1 > this.attackLimit() ||
        this.table.length >= this.attackLimit())
      return { ok: false, why: 'Карт на столе больше, чем у защитника на руках' };
    if (this.opts.podkid === 'neighbors' && idx !== this.attackerIdx && !this.isNeighborOfDefender(idx))
      return { ok: false, why: 'Подкидывать могут только соседи защитника' };
    return { ok: true };
  }

  // ---------- атака / подкидывание ----------
  attack(playerId, cardId, { cheat = false } = {}) {
    if (this.phase === 'over') return { ok: false, why: 'Партия окончена' };
    const idx = this.idxOf(playerId);
    const p = this.players[idx];
    if (!p) return { ok: false, why: 'Нет игрока' };
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return { ok: false, why: 'Нет такой карты в руке' };
    if (idx === this.defenderIdx) return { ok: false, why: 'Защитник не атакует' };
    if (this.pendingCheat) return { ok: false, why: 'Сначала решите спор о шулерстве' };

    // фаза «беру» и «подкидывания после бито»
    if (this.takePending) {
      if (this.takePending.passed.has(p.id)) return { ok: false, why: 'Вы уже сказали пас' };
      if (!this.tableRanks().has(card.r)) return { ok: false, why: 'Подкидывать можно только карту того ранга, что уже на столе' };
      if (this.table.length >= this.attackLimit())
        return { ok: false, why: `У защитника на руках ${this.players[this.defenderIdx].hand.length} карт — больше подкинуть нельзя` };
    } else if (this.podkidPending) {
      if (this.podkidPending.passed.has(p.id)) return { ok: false, why: 'Вы уже сказали пас' };
      if (!this.tableRanks().has(card.r)) return { ok: false, why: 'Подкидывать можно только карту того ранга, что уже на столе' };
      if (this.table.length >= this.attackLimit())
        return { ok: false, why: `У защитника на руках ${this.players[this.defenderIdx].hand.length} карт — больше подкинуть нельзя` };
    } else {
      if (this.phase !== 'defend' && this.phase !== 'attack') return { ok: false, why: 'Сейчас нельзя ходить' };
      if (this.table.length === 0) {
        if (idx !== this.attackerIdx) return { ok: false, why: 'Первым ходит атакующий' };
      } else {
        if (!this.mayAttack(idx)) return { ok: false, why: 'Сейчас подкидывать не ваша очередь' };
        const chk = this.checkPodkid(idx, card);
        if (!chk.ok) {
          // шулерство: карта вне правил, если разрешено режимом
          if (!this.opts.cheat) return chk;
          if (p.cheatsLocked) return { ok: false, why: 'Вас поймали за шулерство — до конца партии играйте честно' };
          if (!cheat && !this.canCheatWith(card)) return chk;
          this.table.push({ attack: card, defense: null, attackerIdx: idx });
          p.hand = p.hand.filter(c => c.id !== cardId);
          this.lastCardPlayerIdx = idx;
          this.pendingCheat = { playerIdx: idx, slotIndex: this.table.length - 1, cardId: card.id };
          this.pushLog(`${p.name} выкладывает карту — что-то нечисто`);
          return { ok: true, cheat: true };
        }
      }
    }

    p.hand = p.hand.filter(c => c.id !== cardId);
    this.table.push({ attack: card, defense: null, attackerIdx: idx });
    this.lastCardPlayerIdx = idx;
    if (this.table.length === 1) this.phase = 'defend';
    this.pushLog(`${p.name} ходит ${label(card)}`);
    return { ok: true, cheat: false };
  }

  // Карта «вне правил» для шулера: если она не подходит по рангу или лимиту
  canCheatWith(card) {
    // шулерить можно только картой, которая не проходит по правилам (иначе это не обман)
    return !this.tableRanks().has(card.r) || this.table.length >= this.attackLimit();
  }

  // ---------- защита ----------
  defend(playerId, cardId, targetAttackId) {
    if (this.phase !== 'defend') return { ok: false, why: 'Сейчас не защита' };
    if (this.takePending || this.podkidPending) return { ok: false, why: 'Сейчас идёт подкидывание' };
    const idx = this.idxOf(playerId);
    if (idx !== this.defenderIdx) return { ok: false, why: 'Вы не защищаетесь' };
    const p = this.players[idx];
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return { ok: false, why: 'Нет такой карты в руке' };
    if (this.pendingCheat) return { ok: false, why: 'Сначала решите спор о шулерстве' };

    let slot;
    if (targetAttackId) {
      slot = this.table.find(s => s.attack.id === targetAttackId);
      if (!slot) return { ok: false, why: 'Этой карты нет на столе' };
      if (slot.defense) return { ok: false, why: `${label(slot.attack)} уже отбита` };
    } else {
      slot = this.table.find(s => !s.defense);
    }
    if (!slot) return { ok: false, why: 'Нечего бить' };

    if (!beats(card, slot.attack, this.trump)) {
      const canBeatAny = this.table.filter(x => !x.defense && beats(card, x.attack, this.trump));
      const hint = canBeatAny.length
        ? ` — она бьёт ${label(canBeatAny[0].attack)}, перетащите её на нужную карту`
        : '';
      return { ok: false, why: `${label(card)} не бьёт ${label(slot.attack)}${hint}` };
    }

    p.hand = p.hand.filter(c => c.id !== cardId);
    slot.defense = card;
    this.pushLog(`${p.name} бьёт ${label(slot.attack)} — ${label(card)}`);
    return { ok: true };
  }

  // ---------- перевод ----------
  // Перевод: защитник кладёт карту того же ранга, что на столе, атакующим становится он,
  // защитником — следующий. Перевести можно и «неправильной» картой, если шулерство
  // не замечено — тогда её тоже можно спорить (см. accuse).
  transfer(playerId, cardId) {
    if (!this.opts.transfer) return { ok: false, why: 'Режим без перевода' };
    if (this.phase !== 'defend') return { ok: false, why: 'Сейчас не защита' };
    const idx = this.idxOf(playerId);
    if (idx !== this.defenderIdx) return { ok: false, why: 'Переводить может только защищающийся' };
    if (this.table.some(s => s.defense)) return { ok: false, why: 'Перевод возможен, только пока ничего не отбито' };
    if (this.pendingCheat) return { ok: false, why: 'Сначала решите спор о шулерстве' };

    const p = this.players[idx];
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return { ok: false, why: 'Нет такой карты' };
    if (!this.tableRanks().has(card.r)) return { ok: false, why: 'Для перевода нужен ранг, который уже на столе' };

    const nextDef = this.nextActive(idx);
    const nextP = this.players[nextDef];
    // у следующего защитника должно хватить карт на весь стол после перевода
    if (nextP.hand.length < this.table.length + 1)
      return { ok: false, why: `У ${nextP.name} не хватает карт для перевода` };

    p.hand = p.hand.filter(c => c.id !== cardId);
    this.table.push({ attack: card, defense: null, attackerIdx: idx });
    this.lastCardPlayerIdx = idx;
    this.attackerIdx = idx;
    this.defenderIdx = nextDef;
    this.phase = 'defend';
    this.pushLog(`${p.name} переводит на ${nextP.name} (${label(card)})`);
    return { ok: true };
  }

  // ---------- кон закрыт: «Бито» атакующего ----------
  // Атакующий нажимает «Бито» — открывается окно подкидывания (фаза podkid).
  endBout(playerId) {
    if (this.takePending || this.podkidPending) return { ok: false, why: 'Идёт подкидывание' };
    if (this.phase !== 'defend' && this.phase !== 'attack') return { ok: false, why: 'Нечего завершать' };
    const idx = this.idxOf(playerId);
    if (idx === this.defenderIdx) return { ok: false, why: 'Карты в отбой отправляет атакующий' };
    if (idx !== this.attackerIdx) return { ok: false, why: 'Бито нажимает первый атакующий' };
    if (this.table.some(s => !s.defense)) return { ok: false, why: 'Есть неотбитые карты' };
    if (this.pendingCheat) return { ok: false, why: 'Сначала решите спор о шулерстве' };
    if (this.table.length === 0) return { ok: false, why: 'На столе нет карт' };

    // окно подкидывания: остальные (кроме защитника) могут подкинуть или сказать «пас»
    this.podkidPending = { passed: new Set() };
    this.phase = 'podkid';
    if (this.waitingPodkidPassers().length === 0) {
      return this.finishBoutToDiscard();
    }
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

  // Пас в окне подкидывания после «Бито»
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

  // Все спасовали — карты уходят в отбой, кон закрыт
  finishBoutToDiscard() {
    const cards = this.table.flatMap(s => [s.attack, s.defense]).filter(Boolean);
    this.discard.push(...cards);
    this.pushLog(cards.length ? 'Бито — карты уходят в отбой' : 'Бито');
    this.table = [];
    this.podkidPending = null;
    this.pendingCheat = null;
    this.afterBout(this.defenderIdx, false);
    return { ok: true, discarded: true };
  }

  // ---------- защитник берёт ----------
  // «Беру»: карты остаются на столе, остальные могут подкинуть (те же ограничения) или сказать пас
  takeCards(playerId) {
    if (this.phase !== 'defend') return { ok: false, why: 'Сейчас не защита' };
    if (this.takePending || this.podkidPending) return { ok: false, why: 'Уже идёт подкидывание' };
    const idx = this.idxOf(playerId);
    if (idx !== this.defenderIdx) return { ok: false, why: 'Взять может только защищающийся' };
    if (this.pendingCheat) return { ok: false, why: 'Сначала решите спор о шулерстве' };
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

  canConfirmTake(playerId) {
    if (!this.takePending) return false;
    return this.idxOf(playerId) === this.takePending.defenderIdx && this.allPassed();
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

  isPassed(playerId) {
    if (this.takePending) return this.takePending.passed.has(playerId);
    if (this.podkidPending) return this.podkidPending.passed.has(playerId);
    return false;
  }

  confirmTake(playerId) {
    if (!this.takePending) return { ok: false, why: 'Вы не брали карты' };
    const idx = this.idxOf(playerId);
    if (idx !== this.takePending.defenderIdx) return { ok: false, why: 'Забрать может только защищающийся' };
    if (!this.allPassed()) return { ok: false, why: 'Дождитесь, пока остальные скажут пас' };

    const d = this.players[idx];
    const cards = this.table.flatMap(s => [s.attack, s.defense]).filter(Boolean);
    // Незамеченный обман: карты уходят в отбой, а не защитнику
    if (this.pendingCheat) {
      this.discard.push(...cards);
      this.pushLog('Обман не заметили — карты уходят в отбой');
      this.table = [];
      this.takePending = null;
      this.pendingCheat = null;
      this.afterBout(idx, false);
      return { ok: true, discarded: true };
    }
    d.hand.push(...cards);
    this.pushLog(`${d.name} забирает ${cards.length} карт`);
    this.table = [];
    this.takePending = null;
    this.afterBout(idx, true);
    return { ok: true };
  }

  // ---------- выход из партии (поражение вышедшему) ----------
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

    // следующий атакующий: если забрал — следующий после него; иначе — тот же, кто был атакующим
    let nextAttacker = took ? this.nextActive(takerIdx) : this.nextActive(this.defenderIdx);
    if (this.players[nextAttacker].out) nextAttacker = this.nextActive(nextAttacker);
    this.attackerIdx = nextAttacker;
    this.defenderIdx = this.nextActive(nextAttacker);
    this.phase = 'attack';

    for (const p of this.players) p.cheatAccusedThisBout = false;

    // прогресс: кон без роста отбоя — «холостой»
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

  // Принудительный итог: проигрывает тот, у кого больше карт на руках (при равенстве — последний выложивший)
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

  // ---------- шулерство ----------
  // Обвинение: карта возвращается шулеру, он до конца партии играет честно
  accuse(accuserId, targetId) {
    if (!this.opts.cheat) return { ok: false, why: 'Режим без шулеров' };
    if (!this.pendingCheat) return { ok: false, why: 'Нечего оспаривать' };
    const acc = this.playerById(accuserId);
    if (!acc) return { ok: false, why: 'Нет игрока' };
    if (acc.idx === this.pendingCheat.playerIdx) return { ok: false, why: 'Нельзя обвинить себя' };

    const cheater = this.players[this.pendingCheat.playerIdx];
    const slot = this.table[this.pendingCheat.slotIndex];
    if (slot) {
      cheater.hand.push(slot.attack);
      this.table.splice(this.pendingCheat.slotIndex, 1);
    }
    cheater.cheatsLocked = true;
    this.pendingCheat = null;
    this.pushLog(`${acc.name} поймал ${cheater.name} за руку. Карта возвращена, шулерить он больше не может`);
    this.phase = this.takePending ? 'take' : (this.table.length ? 'defend' : 'attack');
    return { ok: true, caught: true };
  }

  // ---------- проигрыш ----------
  // Правило: если у обоих (всех оставшихся) карт нет — проигрывает тот, кто последним выложил карту.
  // Если у кого-то остались карты — проигрывает тот, у кого карты на руках.
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
    // никому не осталось карт: проигрывает последний выложивший карту
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
    if (this.pendingCheat) return { ok: false, why: 'Сначала решите спор о шулерстве' };
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
