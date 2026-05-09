export type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let _minLevel: Level = "info";

export function setLevel(level: Level): void {
  _minLevel = level;
}

export function log(level: Level, msg: string, ...args: unknown[]): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[_minLevel]) return;
  console.error(`${level.toUpperCase()} ${msg}`, ...args);
}
