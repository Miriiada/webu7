export function isRevokedTelegramSession(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  const rpc = (error as { errorMessage?: unknown } | null)?.errorMessage;
  return /\b(?:AUTH_KEY_DUPLICATED|AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED)\b/.test(typeof rpc === 'string' ? rpc : message);
}
