import { appendFileSync } from 'node:fs';

const logPath = process.env.KIRBY_LOG || null;

export function log(
  level: 'info' | 'warn' | 'error',
  context: string,
  message: string,
  data?: unknown
): void {
  if (!logPath) return;
  const ts = new Date().toISOString();
  const line =
    data !== undefined
      ? `${ts} [${level.toUpperCase()}] ${context}: ${message} ${JSON.stringify(
          data
        )}`
      : `${ts} [${level.toUpperCase()}] ${context}: ${message}`;
  appendFileSync(logPath, line + '\n');
}

export function logError(context: string, err: unknown): void {
  const msg =
    err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
  log('error', context, msg);
}
