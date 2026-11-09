import { performance } from 'node:perf_hooks';

const epoch = performance.now();

/** Relógio monotônico do servidor em ms (base para snapshots, rewind e sincronia). */
export const serverNow = (): number => performance.now() - epoch;
