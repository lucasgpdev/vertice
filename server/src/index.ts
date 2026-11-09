import { loadConfig } from './config.js';
import { createServer } from './createServer.js';
import { log } from './core/logger.js';

const cfg = loadConfig();
const server = await createServer(cfg);

const shutdown = async (sig: string): Promise<void> => {
  log.info(`recebido ${sig}, encerrando...`);
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => log.error('promessa rejeitada sem tratamento', e));
