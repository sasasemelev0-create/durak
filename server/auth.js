// server/auth.js — проверка Telegram initData и профили с балансом
import crypto from 'node:crypto';

export const START_BALANCE = 2500;

// Проверка подписи initData по алгоритму Telegram:
// secret = HMAC_SHA256("WebAppData", bot_token)
// hash   = HMAC_SHA256(secret, data_check_string)
export function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData) return { ok: false, why: 'initData отсутствует' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, why: 'Нет hash' };
  params.delete('hash');

  const pairs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(pairs).digest('hex');

  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return { ok: false, why: 'Подпись неверна' };

  const authDate = Number(params.get('auth_date') || 0);
  if (maxAgeSec && Date.now() / 1000 - authDate > maxAgeSec)
    return { ok: false, why: 'initData устарел' };

  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { }

  return { ok: true, user, authDate, params };
}

// Профиль в памяти (заменится на БД)
export class Profiles {
  constructor() { this.map = new Map(); }

  upsert(tgUser) {
    if (!tgUser) return null;
    const id = String(tgUser.id);
    let p = this.map.get(id);
    if (!p) {
      p = {
        id,
        name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Игрок',
        username: tgUser.username || null,
        photo: tgUser.photo_url || null,
        wins: 0, losses: 0, games: 0,
        balance: START_BALANCE,
        staked: 0,             // сколько заблокировано в текущей партии
        createdAt: Date.now()
      };
      this.map.set(id, p);
    } else {
      p.name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || p.name;
      p.username = tgUser.username || p.username;
      p.photo = tgUser.photo_url || p.photo;
    }
    return p;
  }

  get(id) { return this.map.get(String(id)) || null; }

  // Хватает ли денег на ставку
  canBet(id, amount) {
    const p = this.get(id);
    return !!p && p.balance >= amount;
  }

  // Блокируем ставку: списываем с баланса в «замороженные»
  lockBet(id, amount) {
    const p = this.get(id);
    if (!p) return { ok: false, why: 'Нет профиля' };
    if (amount <= 0) return { ok: true };
    if (p.balance < amount) return { ok: false, why: 'Недостаточно монет' };
    p.balance -= amount;
    p.staked += amount;
    return { ok: true };
  }

  // Возврат ставки (отмена партии, ничья)
  refundBet(id) {
    const p = this.get(id);
    if (!p) return;
    p.balance += p.staked;
    p.staked = 0;
  }

  // Выплата выигрыша: забираем всё замороженное, начисляем долю
  payout(id, amount) {
    const p = this.get(id);
    if (!p) return;
    p.staked = 0;
    p.balance += Math.max(0, Math.round(amount));
  }

  // Проигрыш: забранное просто не возвращается
  forfeit(id) {
    const p = this.get(id);
    if (!p) return;
    p.staked = 0;
  }

  recordResult(playerId, isLoser) {
    const p = this.get(playerId);
    if (!p) return;
    p.games++;
    if (isLoser) p.losses++; else p.wins++;
  }

  public(id) {
    const p = this.get(id);
    if (!p) return null;
    return {
      id: p.id, name: p.name, username: p.username, photo: p.photo,
      wins: p.wins, losses: p.losses, games: p.games,
      balance: p.balance, staked: p.staked
    };
  }
}
