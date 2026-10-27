// engine.js — движок дурака
// Режимы:
//  - podkid: 'all' | 'neighbors'  — кто может подкидывать
//  - transfer: bool               — переводной
//  - cheat: bool                  — режим "с шулерами"
//  - lossMode: 'classic' | 'draw' — определение проигравшего
//  - recallQuota: number          — сколько раз за партию можно вернуть карту (5)

import { buildDeck, beats, shuffle, mulberry32, sortHand, label } from './cards.js';

export const MAX_ATTACKS = 6;
export const RECALL_QUOTA = 5;

export class Durak {
  constructor(opts = {}) {
    this.opts = {
      players: opts.players || [],          // [{id, name}]
      deckSize: opts.deckSize || 36,
      podkid: opts.podkid || 'all',         // 'all' | 'neighbors'
      transfer: opts.transfer !== false,
      cheat: !!opts.cheat,
      lossMode: opts.lossMode || 'classic',
      speed: opts.speed || 'normal',
      seed: opts.seed ?? Date.now(),
      recallQuota: opts.recallQuota ?? RECALL_QUOTA,
      cheatPenalty: opts.cheatPenalty || 'game' // 'game' | 'bout'
    };
    if (this.opts.players.length < 2 || this.opts.players.length > 6)
      throw new Error('Игроков должно быть от 2 до 6');

    const rnd = mulberry32(this.opts.seed);
    this.rnd = rnd;

    let deck = shuffle(buildDeck(this.opts.deckSize), rnd);
    this.trumpCard = deck[deck.length - 1];
    this.trump = this.trumpCard.s;

    this.players = this.opts.players.map((p, i) => ({
      id: p.id, name: p.name, idx: i,
      hand: [],
      out: false,
      cheatsLocked: false,      // заблокирован до конца партии (или кона)
      cheatAccusedThisBout: false,
      recallsLeft: this.opts.recallQuota
    }));

    // Раздача по 6
    for (let k = 0; k < 6; k++)
      for (const p of this.players) if (deck.length) p.hand.push(deck.pop());

    this.deck = deck;
    this.discard = [];
    this.table = [];                 // [{attack, defense, attacker}]
    this.attackerIdx = 0;
    this.defenderIdx = 1 % this.players.length;
    this.phase = 'attack';           // attack | defend | over
    this.tookCards = false;
    this.lastCardPlayerIdx = null;   // для 'классика'
    this.pendingCheat = null;        // {playerIdx, slotIndex, cardId}
    this.log = [];
    this.boutNumber = 1;
    this.losers = [];
    this.exitOrder = [];        // порядок выхода из игры: первый вышел -> первый забрал
    this.createdAt = Date.now();
    this.stallBouts = 0;              // кóнов подряд без прогресса (отбоя)
    this.lastDiscardCount = 0;

    this.pushLog(`Козырь: ${label(this.trumpCard)}. Первым ходит ${this.player(this.attackerIdx).name}`);
    this.refillHands();
  }

  // ---------- утилиты ----------
  player(i) { return this.players[i]; }
  playerById(id) { return this.players.find(p => p.id === id); }
  idxOf(id) { return this.players.findIndex(p => p.id === id); }
  activePlayers() { return this.players.filter(p => !p.out); }

  // Игрок вышел из игры — запоминаем порядок (для расчёта ставок)
  markOut(p) {
    if (!p || p.out) return;
    p.out = true;
    if (!this.exitOrder.includes(p.id)) this.exitOrder.push(p.id);
  }
  pushLog(text) { this.log.push({ t: Date.now(), text }); if (this.log.length > 300) this.log.shift(); }

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

  // Сколько ещё карт можно положить на стол
  // правил два: не больше 6 слотов и не больше, чем карт в руке защищающегося
  maxAttacks() {
    const d = this.players[this.defenderIdx];
    if (!d) return MAX_ATTACKS;
    const undefended = this.table.filter(s => !s.defense).length;
    // защищающийся должен суметь отбить всё, что на столе, плюс новую карту
    if (undefended + 1 > d.hand.length) return this.table.length;
    return Math.min(MAX_ATTACKS, this.table.length + 1);
  }

  tableRanks() {
    const set = new Set();
    for (const s of this.table) { set.add(s.attack.r); if (s.defense) set.add(s.defense.r); }
    return set;
  }

  // ---------- выдачи ----------
  refillHands() {
    // Сначала атакующий, потом остальные по кругу — как в живой игре
    const order = [];
    let i = this.attackerIdx;
    for (let k = 0; k < this.players.length; k++) {
      order.push(i); i = (i + 1) % this.players.length;
    }
    for (const idx of order) {
      const p = this.players[idx];
      if (p.out) continue;
      while (p.hand.length < 6 && this.deck.length) p.hand.push(this.deck.pop());
      if (p.hand.length === 0 && !this.deck.length) this.markOut(p);
    }
  }

  // Карта, которую этот игрок может вернуть прямо сейчас (последняя на столе и своя)
  recallableFor(idx) {
    if (this.phase === 'over' || !this.table.length) return null;
    if (this.pendingCheat) return null;
    const p = this.players[idx];
    if (!p || p.recallsLeft <= 0) return null;
    const slot = this.table[this.table.length - 1];
    if (slot.defense) return idx === this.defenderIdx ? slot.defense.id : null;
    return slot.attacker === idx ? slot.attack.id : null;
  }

  publicState(forPlayerId) {
    const me = this.playerById(forPlayerId);
    return {
      phase: this.phase,
      trump: this.trump,
      trumpCard: this.trumpCard,
      deckCount: this.deck.length,
      discardCount: this.discard.length,
      table: this.table.map(s => ({
        attack: s.attack,
        defense: s.defense || null,
        attacker: this.players[s.attacker]?.id
      })),
      attackerId: this.players[this.attackerIdx]?.id,
      defenderId: this.players[this.defenderIdx]?.id,
      players: this.players.map(p => ({
        id: p.id, name: p.name, idx: p.idx,
        count: p.hand.length, out: p.out,
        hand: p.id === forPlayerId ? sortHand(p.hand, this.trump) : null,
        cheatsLocked: p.cheatsLocked,
        recallsLeft: p.recallsLeft
      })),
      you: me ? {
        id: me.id,
        hand: sortHand(me.hand, this.trump),
        isAttacker: me.idx === this.attackerIdx,
        isDefender: me.idx === this.defenderIdx,
        recallsLeft: me.recallsLeft,
        recallable: this.recallableFor(me.idx),
        cheatsLocked: me.cheatsLocked
      } : null,
      losers: this.losers,
      exitOrder: this.exitOrder,
      pendingCheat: this.pendingCheat ? {
        playerId: this.players[this.pendingCheat.playerIdx].id,
        playerName: this.players[this.pendingCheat.playerIdx].name
      } : null,
      log: this.log.slice(-40),
      opts: { ...this.opts, seed: undefined }
    };
  }

  // ---------- проверки хода ----------
  isNeighborOfDefender(idx) {
    const before = this.prevActive(this.defenderIdx);
    const after = this.nextActive(this.defenderIdx);
    return idx === before || idx === after;
  }

  // Легальные ли атака/подкидывание этой картой
  canAttackWith(idx, card) {
    const p = this.players[idx];
    if (!p || p.out) return { ok: false, why: 'Нет игрока' };
    if (idx === this.defenderIdx) return { ok: false, why: 'Вы защищаетесь, а не атакуете' };
    if (!p.hand.some(c => c.id === card.id)) return { ok: false, why: 'Нет такой карты' };

    if (this.table.length === 0) {
      if (idx !== this.attackerIdx) return { ok: false, why: 'Первым ходит атакующий' };
      return { ok: true };
    }
    const d = this.players[this.defenderIdx];
    const undefended = this.table.filter(s => !s.defense).length;
    if (this.table.length >= MAX_ATTACKS) return { ok: false, why: 'На столе уже 6 карт' };
    if (undefended + 1 > d.hand.length)
      return { ok: false, why: 'У защищающегося не хватит карт' };
    if (!this.tableRanks().has(card.r))
      return { ok: false, why: 'Нужен ранг, который уже есть на столе' };
    if (this.opts.podkid === 'neighbors' && idx !== this.attackerIdx && !this.isNeighborOfDefender(idx))
      return { ok: false, why: 'Подкидывать могут только соседи, атакующий и защищающийся' };
    return { ok: true };
  }

  canDefendWith(card, attackCard) {
    return beats(card, attackCard, this.trump);
  }

  // ---------- действия ----------

  // Атака / подкидывание
  attack(playerId, cardId, { cheat = false } = {}) {
    if (this.phase === 'over') return { ok: false, why: 'Партия окончена' };
    const idx = this.idxOf(playerId);
    const p = this.players[idx];
    if (!p) return { ok: false, why: 'Нет игрока' };
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return { ok: false, why: 'Нет такой карты в руке' };

    const chk = this.canAttackWith(idx, card);
    const cheating = !chk.ok;

    if (cheating) {
      if (!this.opts.cheat) return chk;
      if (p.cheatsLocked) return { ok: false, why: 'Вам запрещено обманывать до конца партии' };
      if (this.pendingCheat) return { ok: false, why: 'Сначала решите предыдущий спор' };
      // шулер может положить любую карту, даже не в свой ход
    }

    p.hand = p.hand.filter(c => c.id !== cardId);
    this.table.push({ attack: card, defense: null, attacker: idx });
    this.lastCardPlayerIdx = idx;
    this.phase = 'defend';

    if (cheating) {
      this.pendingCheat = { playerIdx: idx, slotIndex: this.table.length - 1, cardId: card.id };
      this.pushLog(`${p.name} выкладывает ${label(card)} — что-то нечисто`);
    } else {
      this.pushLog(`${p.name} ходит ${label(card)}`);
    }
    return { ok: true, cheat: cheating };
  }

  // Защита
  // targetAttackId — какую именно карту на столе бьём.
  // Если не указана, бьём первую неотбитую (совместимость со старым клиентом).
  defend(playerId, cardId, targetAttackId) {
    if (this.phase !== 'defend') return { ok: false, why: 'Сейчас не защита' };
    const idx = this.idxOf(playerId);
    if (idx !== this.defenderIdx) return { ok: false, why: 'Вы не защищающийся' };
    const p = this.players[idx];
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return { ok: false, why: 'Нет такой карты в руке' };

    let slot;
    if (targetAttackId) {
      const any = this.table.find(s => s.attack.id === targetAttackId);
      if (!any) return { ok: false, why: 'Этой карты нет на столе' };
      if (any.defense) return { ok: false, why: `${label(any.attack)} уже отбита` };
      slot = any;
    } else {
      slot = this.table.find(s => !s.defense);
    }
    if (!slot) return { ok: false, why: 'Нечего бить' };

    if (!this.canDefendWith(card, slot.attack)) {
      // подскажем, какую карту на столе эта карта всё-таки может побить
      const canBeatAny = this.table.filter(x => !x.defense && this.canDefendWith(card, x.attack));
      const hint = canBeatAny.length
        ? ` — она бьёт ${label(canBeatAny[0].attack)}, бросьте её на нужную карту`
        : '';
      return { ok: false, why: `${label(card)} не бьёт ${label(slot.attack)}${hint}` };
    }

    p.hand = p.hand.filter(c => c.id !== cardId);
    slot.defense = card;
    this.lastCardPlayerIdx = idx;
    this.pushLog(`${p.name} бьёт ${label(slot.attack)} — ${label(card)}`);
    return { ok: true };
  }

  // Какие лежащие на столе карты этот игрок может побить этой картой
  beatableTargets(card) {
    if (!card) return [];
    return this.table.filter(s => !s.defense && this.canDefendWith(card, s.attack))
      .map(s => s.attack.id);
  }

  // Перевод (переводной): защищающийся переводит на следующего
  transfer(playerId, cardId) {
    if (!this.opts.transfer) return { ok: false, why: 'Режим без перевода' };
    if (this.phase !== 'defend') return { ok: false, why: 'Сейчас не защита' };
    const idx = this.idxOf(playerId);
    if (idx !== this.defenderIdx) return { ok: false, why: 'Переводить может только защищающийся' };
    if (this.table.some(s => s.defense))
      return { ok: false, why: 'Перевод возможен только пока вы отбивались' };

    const p = this.players[idx];
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return { ok: false, why: 'Нет такой карты' };
    if (!this.tableRanks().has(card.r))
      return { ok: false, why: 'Для перевода нужен ранг со стола' };

    const nextDef = this.nextActive(idx);
    const nextP = this.players[nextDef];
    if (nextP.hand.length < this.table.length + 1)
      return { ok: false, why: `У ${nextP.name} не хватает карт для перевода` };

    p.hand = p.hand.filter(c => c.id !== cardId);
    this.table.push({ attack: card, defense: null, attacker: idx });
    this.lastCardPlayerIdx = idx;

    // роли меняются: переводящий становится атакующим, следующий — защищающимся
    this.attackerIdx = idx;
    this.defenderIdx = nextDef;
    this.phase = 'defend';
    this.pushLog(`${p.name} переводит на ${nextP.name} (${label(card)})`);
    return { ok: true };
  }

  // Все отбились -> бито
  endBout(playerId) {
    if (this.phase !== 'defend' && this.phase !== 'attack') return { ok: false, why: 'Нечего завершать' };
    const idx = this.idxOf(playerId);
    if (idx !== this.attackerIdx && idx !== this.defenderIdx)
      return { ok: false, why: 'Завершать кон может только атакующий или защищающийся' };
    if (this.table.some(s => !s.defense))
      return { ok: false, why: 'Есть неотбитые карты' };
    if (this.pendingCheat) return { ok: false, why: 'Сначала решите спор о шулерстве' };

    this.discard.push(...this.table.flatMap(s => [s.attack, s.defense]));
    this.pushLog(`Бито. ${this.player(this.defenderIdx).name} отбился`);
    this.table = [];
    this.afterBout(this.defenderIdx, false);
    return { ok: true };
  }

  // Защищающийся забирает
  takeCards(playerId) {
    if (this.phase !== 'defend') return { ok: false, why: 'Сейчас не защита' };
    const idx = this.idxOf(playerId);
    if (idx !== this.defenderIdx) return { ok: false, why: 'Взять может только защищающийся' };
    if (this.pendingCheat) return { ok: false, why: 'Сначала решите спор о шулерстве' };

    const d = this.players[idx];
    const cards = this.table.flatMap(s => [s.attack, s.defense]).filter(Boolean);
    d.hand.push(...cards);
    this.pushLog(`${d.name} забирает ${cards.length} карт`);
    this.table = [];
    this.refillHands();
    this.afterBout(idx, true);
    return { ok: true };
  }

  afterBout(takerIdx, took) {
    // добор до 6 — до расчёта следующего атакующего
    this.refillHands();

    // следующий атакующий; если он вышел из игры — берём следующего активного
    let nextAttacker = took ? this.nextActive(takerIdx) : takerIdx;
    if (this.players[nextAttacker].out) nextAttacker = this.nextActive(nextAttacker);
    this.attackerIdx = nextAttacker;
    this.defenderIdx = this.nextActive(nextAttacker);
    this.phase = 'attack';
    this.boutNumber++;

    // сброс флагов кона
    for (const p of this.players) {
      p.cheatAccusedThisBout = false;
      if (this.opts.cheatPenalty === 'bout') p.cheatsLocked = false;
    }
    this.pendingCheat = null;

    // анти-зависание: если карты не уходят в отбой слишком долго,
    // партия перестаёт двигаться (два игрока бесконечно перекидывают карты)
    if (this.discard.length > this.lastDiscardCount) {
      this.lastDiscardCount = this.discard.length;
      this.stallBouts = 0;
    } else {
      this.stallBouts++;
    }
    const stallLimit = this.opts.stallLimit ?? (this.players.length * 4);
    if (this.stallBouts >= stallLimit && this.deck.length === 0) {
      this.pushLog('Игра затянулась — объявляем результат по картам на руках');
      this.forceResultByHands();
      return;
    }

    // проверка "выхода" игроков
    for (const p of this.players) {
      if (!p.out && p.hand.length === 0 && this.deck.length === 0) this.markOut(p);
    }
    this.checkGameOver();
  }

  // Принудительный результат, когда партия встала
  forceResultByHands() {
    const withCards = this.players.filter(p => p.hand.length > 0);
    this.phase = 'over';
    if (this.opts.lossMode === 'draw' && withCards.length > 1) {
      this.losers = withCards.map(p => p.id);
    } else if (withCards.length) {
      const worst = withCards.reduce((a, b) => (b.hand.length > a.hand.length ? b : a));
      this.losers = [worst.id];
    } else {
      this.losers = [];
    }
  }

  checkGameOver() {
    const remaining = this.players.filter(p => !p.out && p.hand.length > 0);

    // все вышли из игры одновременно
    if (remaining.length === 0) {
      this.phase = 'over';
      if (this.opts.lossMode === 'draw') {
        // ничья: проигрыш делится на всех, кто остался без карт
        this.losers = this.players.filter(p => p.hand.length === 0).map(p => p.id);
        this.pushLog(`Ничья: никто не остался с картами — проигрыш делится на ${this.losers.length}`);
      } else {
        // классика: проиграл тот, кто последним выложил карту
        const last = this.lastCardPlayerIdx ?? 0;
        this.losers = [this.players[last].id];
        this.pushLog(`Классика: последним карту выложил ${this.players[last].name} — он и проиграл`);
      }
      return;
    }

    // карты кончились, остался один с картами — он дурак
    if (this.deck.length === 0 && remaining.length === 1) {
      const p = remaining[0];
      this.phase = 'over';
      if (this.opts.lossMode === 'classic' && this.lastCardPlayerIdx != null) {
        // и в классике проигравший — тот, кто выложил карту последним
        const last = this.players[this.lastCardPlayerIdx];
        this.losers = [last.id];
        if (last.id !== p.id) {
          this.pushLog(`Карты остались у ${p.name}, но последним выложил ${last.name} — проиграл он`);
        } else {
          this.pushLog(`${p.name} остался с картами и выложил последним — он дурак`);
        }
      } else {
        this.losers = [p.id];
        this.pushLog(`${p.name} остался с картами — дурак`);
      }
    }
  }

  // ---------- возврат случайно выложенной карты (5 раз за партию) ----------
  // Вернуть можно только последнюю карту на столе и только свою.
  recall(playerId, cardId) {
    const idx = this.idxOf(playerId);
    const p = this.players[idx];
    if (!p) return { ok: false, why: 'Нет игрока' };
    if (p.recallsLeft <= 0) return { ok: false, why: 'Возвраты закончились' };
    if (this.pendingCheat) return { ok: false, why: 'Сначала решите спор о шулерстве' };
    if (this.phase === 'over') return { ok: false, why: 'Партия окончена' };
    if (this.table.length === 0) return { ok: false, why: 'Стол пуст' };

    const i = this.table.length - 1;
    const slot = this.table[i];

    // последняя карта — защита
    if (slot.defense) {
      if (slot.defense.id !== cardId) return { ok: false, why: 'Вернуть можно только последнюю карту' };
      if (idx !== this.defenderIdx) return { ok: false, why: 'Это не ваша карта' };
      const back = slot.defense;
      p.hand.push(back);
      slot.defense = null;
      p.recallsLeft--;
      this.pushLog(`${p.name} возвращает ${label(back)} — ошибся (осталось возвратов: ${p.recallsLeft})`);
      return { ok: true };
    }

    // последняя карта — атака
    if (slot.attack.id !== cardId) return { ok: false, why: 'Вернуть можно только последнюю карту' };
    if (slot.attacker !== idx) return { ok: false, why: 'Это не ваша карта' };
    const back = slot.attack;
    p.hand.push(back);
    this.table.pop();
    p.recallsLeft--;
    this.pushLog(`${p.name} возвращает ${label(back)} — ошибся (осталось возвратов: ${p.recallsLeft})`);
    if (this.table.length === 0) this.phase = 'attack';
    return { ok: true };
  }

  // ---------- шулеры ----------
  accuse(accuserId, targetId) {
    if (!this.opts.cheat) return { ok: false, why: 'Режим без шулеров' };
    if (!this.pendingCheat) return { ok: false, why: 'Нечего оспаривать' };
    const acc = this.playerById(accuserId);
    if (!acc) return { ok: false, why: 'Нет игрока' };
    if (acc.idx === this.pendingCheat.playerIdx) return { ok: false, why: 'Нельзя обвинять себя' };
    if (acc.cheatAccusedThisBout) return { ok: false, why: 'Вы уже обвиняли в этом кону' };

    const cheatIdx = this.pendingCheat.playerIdx;
    const cheater = this.players[cheatIdx];
    const slot = this.table[this.pendingCheat.slotIndex];
    acc.cheatAccusedThisBout = true;

    // карта возвращается шулеру, он больше не может обманывать
    if (slot) {
      cheater.hand.push(slot.attack);
      this.table.splice(this.pendingCheat.slotIndex, 1);
    }
    cheater.cheatsLocked = true;
    this.pendingCheat = null;
    if (this.table.length === 0) this.phase = 'attack';

    this.pushLog(`${acc.name} поймал ${cheater.name} за руку. Карта возвращена, обманывать он больше не может`);
    return { ok: true, caught: true };
  }

  // Обвинение с ошибкой — карта остаётся, обвинитель теряет право обвинять в этом кону
  // (вызывается когда pendingCheat легален)
  clearPendingCheat() {
    this.pendingCheat = null;
  }
}
