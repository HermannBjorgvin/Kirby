import { appendFileSync } from 'node:fs';

const logPath = process.env.KIRBY_LOG || null;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Levels in increasing severity. Filter drops anything *below* the
// configured level. Default is `info` so high-volume `debug` (e.g.
// network traces) is opt-in via `KIRBY_LOG_LEVEL=debug`.
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinLevel(): number {
  const raw = (process.env.KIRBY_LOG_LEVEL || 'info').toLowerCase();
  if (raw in LEVEL_RANK) return LEVEL_RANK[raw as LogLevel];
  return LEVEL_RANK.info;
}

const minLevel = resolveMinLevel();

export function log(
  level: LogLevel,
  context: string,
  message: string,
  data?: unknown
): void {
  if (!logPath) return;
  if (LEVEL_RANK[level] < minLevel) return;
  const ts = new Date().toISOString();
  const serialized =
    data instanceof Error
      ? `${data.message}\n${data.stack ?? ''}`
      : JSON.stringify(data);
  const line =
    data !== undefined
      ? `${ts} [${level.toUpperCase()}] ${context}: ${message} ${serialized}`
      : `${ts} [${level.toUpperCase()}] ${context}: ${message}`;
  appendFileSync(logPath, line + '\n');
}

export function logError(context: string, err: unknown): void {
  const msg =
    err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
  log('error', context, msg);
}

/**
 * Log a network request/response pair at `debug` level. Suppressed
 * unless `KIRBY_LOG_LEVEL=debug` is set, so day-to-day runs don't
 * spam the log with every gh/ADO call.
 *
 * Caller is responsible for sanitizing — do NOT pass auth headers,
 * PATs, or full response bodies that might contain user content. Pass
 * a shape summary (counts, top-level keys, sampled IDs) instead.
 */
export function logNetwork(
  context: string,
  message: string,
  data?: unknown
): void {
  log('debug', context, message, data);
}
