// Minimal structured logger: one JSON object per line, ready for log drains.
// Deliberately tiny — swap for OpenTelemetry-aware logging in M8.
type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};
