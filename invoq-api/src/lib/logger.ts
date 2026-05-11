type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  msg: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function write(level: LogLevel, module: string, msg: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry: LogEntry = {
    ts:     new Date().toISOString(),
    level,
    module,
    msg,
    ...meta,
  };
  const out = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    process.stderr.write(out + "\n");
  } else {
    process.stdout.write(out + "\n");
  }
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg:  string, meta?: Record<string, unknown>): void;
  warn(msg:  string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(subModule: string): Logger;
}

export function createLogger(module: string): Logger {
  return {
    debug: (msg, meta) => write("debug", module, msg, meta),
    info:  (msg, meta) => write("info",  module, msg, meta),
    warn:  (msg, meta) => write("warn",  module, msg, meta),
    error: (msg, meta) => write("error", module, msg, meta),
    child: (sub)       => createLogger(`${module}:${sub}`),
  };
}

export const log = createLogger("invoq");