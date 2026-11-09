/** Constantes de simulação e rede compartilhadas entre cliente e servidor. */

/** Frequência de simulação (servidor e predição do cliente). */
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_DT = 1 / TICK_RATE;

/** Frequência de envio de snapshots (a cada N ticks). 60/2 = 30 Hz. */
export const SNAPSHOT_EVERY_TICKS = 2;

/** Atraso de interpolação de entidades remotas (ms). */
export const INTERP_DELAY_MS = 100;

/**
 * Janela máxima de compensação de latência (ms).
 * Ajustada de 250 para 320 ms: o que o atirador vê está atrasado em
 * RTT + atraso de interpolação (150 + 100 = 250 ms no critério da Fase 1)
 * mais o intervalo entre snapshots e o tick de processamento (~50 ms).
 * Com 250 ms exatos, jogadores com 150 ms de ping já seriam cortados.
 */
export const MAX_REWIND_MS = 320;

/** Quantidade de ticks guardados no histórico de posições (> MAX_REWIND). */
export const HISTORY_TICKS = Math.ceil((MAX_REWIND_MS + 100) / TICK_MS);

/** Janela para reconectar e voltar à mesma partida (ms). */
export const RECONNECT_WINDOW_MS = 30_000;

/** Orçamento de inputs: 1 por tick, com rajada máxima tolerada. */
export const INPUT_BURST_MAX = 8;
/** Tamanho máximo da fila de inputs pendentes por jogador. */
export const INPUT_QUEUE_MAX = 32;

export const ROOM_CODE_LENGTH = 6;
/** Alfabeto sem caracteres ambíguos (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const MIN_PLAYERS_PER_ROOM = 2;
export const MAX_PLAYERS_PER_ROOM = 10;

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
export const NICKNAME_REGEX = /^[A-Za-z0-9_\-À-ÿ]+$/;

export const MAX_HEALTH = 100;
export const RESPAWN_DELAY_TICKS = 3 * TICK_RATE;
/** Proteção curta após renascer (ticks). Quebra ao disparar. */
export const SPAWN_PROTECTION_TICKS = Math.round(1.5 * TICK_RATE);

/** Intervalo de medição de ping pelo servidor (ms). */
export const PING_INTERVAL_MS = 1000;
