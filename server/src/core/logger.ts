type Level = 'silent' | 'info' | 'debug';
let level: Level = 'info';

export const setLogLevel = (l: Level): void => {
  level = l;
};

const ts = (): string => new Date().toISOString().slice(11, 23);

export const log = {
  info: (...a: unknown[]): void => {
    if (level !== 'silent') console.log(`[${ts()}]`, ...a);
  },
  debug: (...a: unknown[]): void => {
    if (level === 'debug') console.log(`[${ts()}] [debug]`, ...a);
  },
  warn: (...a: unknown[]): void => {
    if (level !== 'silent') console.warn(`[${ts()}] [aviso]`, ...a);
  },
  error: (...a: unknown[]): void => {
    console.error(`[${ts()}] [erro]`, ...a);
  },
};
