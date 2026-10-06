import type { Store } from './db.js';
import { AppError } from './security.js';
import type { UserRow } from './db.js';

// Keep the persisted admin flag compatible with existing installations/CLI.
// Student status is never assigned manually: it is derived from bot access.
export function effectiveRole(user: UserRow): 'user' | 'student' | 'mentor' {
  return user.role === 'admin' ? 'mentor' : user.telegram && user.bot_access === 1 ? 'student' : 'user';
}
export function observeBotAccess(store: Store, id: string, granted: boolean, date: number, message = 0) {
  store.db.prepare('UPDATE users SET bot_access=?,bot_access_date=?,bot_access_message=? WHERE id=? AND (bot_access_date<? OR (bot_access_date=? AND bot_access_message<=?))').run(granted ? 1 : 0, date, message, id, date, date, message);
}

export function setUserRole(store: Store, id: string, role: 'student' | 'admin', actor?: string) {
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const user = store.user(id);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'Пользователь не найден.');
    if (user.role === 'admin' && role === 'student' && Number(store.db.prepare("SELECT COUNT(*) AS total FROM users WHERE role='admin'").get()!.total) <= 1) {
      throw new AppError(409, 'LAST_ADMIN', 'Нельзя снять роль последнего ментора. Сначала назначьте другого.');
    }
    if (user.role !== role) {
      store.db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
      store.audit(id, `role.${role}`);
      if (actor && actor !== id) store.audit(actor, `admin.role.${role}`);
    }
    store.db.exec('COMMIT');
    return store.user(id)!;
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
