// cards.js — карты, колоды, сравнение
export const SUIT_CHAR = ['♠', '♥', '♦', '♣']; // 0=S 1=H 2=D 3=C
export const SUIT_NAME = ['Пики', 'Черви', 'Бубны', 'Трефы'];
export const RANK_LABEL = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'В', 12: 'Д', 13: 'К', 14: 'Т'
};

// 24 = 9..Туза, 36 = 6..Туза, 52 = 2..Туза
export function minRankFor(deckSize) {
  if (deckSize === 24) return 9;
  if (deckSize === 36) return 6;
  if (deckSize === 52) return 2;
  throw new Error('bad deck size: ' + deckSize);
}

// Уникальный id карты — стабилен в пределах колоды
export const cardId = (c) => `${c.s}${c.r}`;

export function buildDeck(deckSize) {
  const min = minRankFor(deckSize);
  const deck = [];
  for (let s = 0; s < 4; s++) {
    for (let r = min; r <= 14; r++) deck.push({ s, r, id: cardId({ s, r }) });
  }
  return deck;
}

// Может ли карта `a` побить карту `b` при козыре `trump`
export function beats(a, b, trump) {
  if (!a || !b) return false;
  if (a.s === b.s) return a.r > b.r;
  if (a.s === trump && b.s !== trump) return true;
  return false;
}

export const isTrump = (c, trump) => c.s === trump;

export function label(c) {
  return RANK_LABEL[c.r] + SUIT_CHAR[c.s];
}

export function sortHand(hand, trump) {
  return [...hand].sort((x, y) => {
    const xt = x.s === trump, yt = y.s === trump;
    if (xt !== yt) return xt ? 1 : -1;     // козыри в конце
    if (x.s !== y.s) return x.s - y.s;
    return x.r - y.r;
  });
}

// Детерминированный ГПСЧ — чтобы партию можно было воспроизвести и проверить
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
