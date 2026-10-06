export interface User { id: string; name: string; email: string; role: 'user' | 'student' | 'mentor'; telegramConnected: boolean; telegramName: string | null; created: number; }
export interface BotMessage { id: number; text: string; date: number; entities?: import('../server/telegram-format').TextEntity[]; buttons: { id?: string; text: string; url?: string; disabled?: boolean }[][]; }
export type { Catalog } from '../server/content';
let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export class ApiError extends Error { constructor(message: string, public code: string) { super(message); } }
export async function api<T = Record<string, unknown>>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}api${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-U7-Request': '1', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || 'Запрос не выполнен', data.code || 'ERROR');
  return data as T;
}
