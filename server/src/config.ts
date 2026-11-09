import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECONNECT_WINDOW_MS } from '@vertice/shared';

const here = path.dirname(fileURLToPath(import.meta.url));

const num = (v: string | undefined, d: number): number => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export interface ServerConfig {
  port: number;
  host: string;
  /** Latência simulada total (ida + volta) em ms. 0 = desligado. */
  simLatencyMs: number;
  /** Jitter simulado (± ms por direção). */
  simJitterMs: number;
  /** Compensação de latência ligada (desligar só para testes comparativos). */
  lagCompensation: boolean;
  /** Pasta com o build do cliente para servir estático (opcional). */
  clientDist: string | null;
  /** Origens permitidas para CORS do Socket.IO em desenvolvimento. */
  corsOrigins: string[] | '*';
  logLevel: 'silent' | 'info' | 'debug';
  /** Janela de reconexão (ms). Padrão: RECONNECT_WINDOW_MS (30 s). */
  reconnectWindowMs: number;
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => ({
  port: num(env.PORT, 3000),
  host: env.HOST ?? '0.0.0.0',
  simLatencyMs: num(env.NET_SIM_LATENCY_MS, 0),
  simJitterMs: num(env.NET_SIM_JITTER_MS, 0),
  lagCompensation: env.LAG_COMPENSATION !== '0',
  clientDist: env.CLIENT_DIST ?? path.resolve(here, '../../client/dist'),
  corsOrigins: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',') : '*',
  logLevel: (env.LOG_LEVEL as ServerConfig['logLevel']) ?? 'info',
  reconnectWindowMs: num(env.RECONNECT_WINDOW_MS, RECONNECT_WINDOW_MS),
});
