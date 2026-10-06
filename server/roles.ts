import type { Store } from './db.js';
import { AppError } from './security.js';

export function setUserRole(store: Store, id: string, role: 'student' | 'admin', actor?: string) {
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const user = store.user(id);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'Пользователь не найден.');
    if (user.role === 'admin' && role === 'student' && Number(store.db.prepare("SELECT COUNT(*) AS total FROM users WHERE role='admin'").get()!.total) <= 1) {
      throw new AppError(409, 'LAST_ADMIN', 'Нельзя снять роль последнего администратора. Сначала назначьте другого.');
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
