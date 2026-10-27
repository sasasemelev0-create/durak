// server/auth.js — проверка Telegram initData и профили
import crypto from 'node:crypto';

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

  // сравнение с постоянным временем
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
        createdAt: Date.now()
      };
      this.map.set(id, p);
    } else {
      // обновляем то, что могло поменяться
      p.name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || p.name;
      p.username = tgUser.username || p.username;
      p.photo = tgUser.photo_url || p.photo;
    }
    return p;
  }

  get(id) { return this.map.get(String(id)) || null; }

  recordResult(playerId, isLoser) {
    const p = this.get(playerId);
    if (!p) return;
    p.games++;
    if (isLoser) p.losses++; else p.wins++;
  }

  public(id) {
    const p = this.get(id);
    if (!p) return null;
    return { id: p.id, name: p.name, username: p.username, photo: p.photo, wins: p.wins, losses: p.losses, games: p.games };
  }
}
