type Level = 'debug' | 'info' | 'warn' | 'error';

type Fields = Record<string, unknown>;

const LEVEL_ORDER: Record<Level, number> = {debug: 10, info: 20, warn: 30, error: 40};

function minLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return LEVEL_ORDER[raw as Level] ?? 20;
}

function emit(level: Level, msg: string, fields?: Fields): void {
  if (LEVEL_ORDER[level] < minLevel()) return;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Fields) => emit('debug', msg, fields),
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
};

/** Security-relevant auth events (login, signup, reset…). Never log passwords or tokens. */
export function logAuthEvent(event: string, fields?: Fields): void {
  logger.info(`auth:${event}`, fields);
}
