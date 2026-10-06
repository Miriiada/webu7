import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { api, type User } from './api';

export function AdminPanel({ currentUser, refreshUser }: { currentUser: User; refreshUser: () => Promise<void> }) {
  const [users, setUsers] = useState<User[]>([]), [total, setTotal] = useState(0), [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function load() {
    setBusy(true); setError('');
    try { const data = await api<{ users: User[]; total: number }>(`/admin/users?offset=${offset}`); setUsers(data.users); setTotal(data.total); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [offset]);
  async function changeRole(user: User, role: User['role']) {
    setBusy(true); setError('');
    try {
      const result = await api<{ user: User }>(`/admin/users/${encodeURIComponent(user.id)}/role`, { role }, 'PATCH');
      setUsers(values => values.map(value => value.id === user.id ? result.user : value));
      if (user.id === currentUser.id) await refreshUser();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card admin-panel"><div className="section-heading"><h2><ShieldCheck size={22}/>Пользователи и роли</h2><button className="secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={16}/>Обновить</button></div>
    <p>Студент получает доступ к материалам по прогрессу бота. Администратор видит все курсы и шаги. Роль не даёт доступа к чужим Telegram-чатам.</p>
    {error && <div className="notice error" role="alert">{error}</div>}
    <div className="admin-users">{users.map(user => <article className="admin-user" key={user.id}><div><strong>{user.name}{user.id === currentUser.id && ' · ты'}</strong><span>{user.email}</span><small>{user.telegramConnected ? 'Telegram подключён' : 'Telegram не подключён'}</small></div><label>Роль<select aria-label={`Роль: ${user.name}`} disabled={busy} value={user.role} onChange={event => void changeRole(user, event.target.value as User['role'])}><option value="student">Студент</option><option value="admin">Администратор</option></select></label></article>)}</div>
    {!users.length && !busy && <p>Пользователей нет.</p>}
    <div className="admin-pagination"><button className="secondary" disabled={busy || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Назад</button><span>{total ? `${offset + 1}–${Math.min(offset + 50, total)} из ${total}` : '0 пользователей'}</span><button className="secondary" disabled={busy || offset + 50 >= total} onClick={() => setOffset(value => value + 50)}>Далее</button></div>
  </section>;
}
