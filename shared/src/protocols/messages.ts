import { z } from 'zod';
import {
  MAX_PLAYERS_PER_ROOM,
  MIN_PLAYERS_PER_ROOM,
  NICKNAME_MAX,
  NICKNAME_MIN,
  NICKNAME_REGEX,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '../constants/game.js';
import { BUTTONS_MASK } from './buttons.js';

/**
 * Protocolo tipado cliente ↔ servidor.
 * TODA mensagem recebida pelo servidor é validada com estes esquemas (estritos:
 * campos extras invalidam a mensagem). O cliente nunca envia posição, dano,
 * acerto ou pontuação — o protocolo simplesmente não tem esses campos.
 */

export const PROTOCOL_VERSION = 1;

// ---------- Cliente → Servidor ----------

export const NicknameSchema = z
  .string()
  .trim()
  .min(NICKNAME_MIN)
  .max(NICKNAME_MAX)
  .regex(NICKNAME_REGEX);

export const RoomCodeSchema = z
  .string()
  .length(ROOM_CODE_LENGTH)
  .transform((s) => s.toUpperCase())
  .refine((s) => [...s].every((c) => ROOM_CODE_ALPHABET.includes(c)), 'código inválido');

export const HelloSchema = z.strictObject({
  v: z.literal(PROTOCOL_VERSION),
  nickname: NicknameSchema,
  /** Token de sessão anterior (reconexão). */
  session: z.string().regex(/^[a-f0-9]{32}$/).optional(),
});

export const RoomSettingsSchema = z.strictObject({
  maxPlayers: z.number().int().min(MIN_PLAYERS_PER_ROOM).max(MAX_PLAYERS_PER_ROOM),
  modeId: z.literal('deathmatch'),
  mapId: z.literal('arena-patio7'),
  killLimit: z.number().int().min(5).max(100),
  timeLimitMin: z.number().int().min(2).max(30),
});
export type RoomSettings = z.infer<typeof RoomSettingsSchema>;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  modeId: 'deathmatch',
  mapId: 'arena-patio7',
  killLimit: 20,
  timeLimitMin: 10,
};

export const RoomCreateSchema = z.strictObject({ settings: RoomSettingsSchema });
export const RoomJoinSchema = z.strictObject({ code: RoomCodeSchema });
export const RoomKickSchema = z.strictObject({ playerId: z.string().min(1).max(32) });
export const RoomUpdateSchema = z.strictObject({ settings: RoomSettingsSchema });
export const EmptySchema = z.strictObject({});

const finite = z.number().finite();

export const InputCmdSchema = z.strictObject({
  /** Número de sequência crescente. */
  s: z.number().int().min(0).max(2 ** 31),
  /** Botões (bitmask). */
  b: z.number().int().min(0).max(BUTTONS_MASK),
  /** Yaw/pitch em radianos. */
  y: finite.min(-1e4).max(1e4),
  p: finite.min(-Math.PI / 2).max(Math.PI / 2),
  /** Tempo do servidor (ms) que o cliente estava renderizando — usado no rewind. */
  vt: finite.min(0),
});
export type InputCmd = z.infer<typeof InputCmdSchema>;

/** Inputs podem chegar agrupados (1 a 4 por mensagem). */
export const InputBatchSchema = z.array(InputCmdSchema).min(1).max(4);

export const PongSchema = z.strictObject({ n: z.number().int().min(0) });
export const ClockSchema = z.strictObject({ c: finite });

/** Mapa evento → esquema de validação. Evento fora desta lista é descartado. */
export const ClientEventSchemas = {
  hello: HelloSchema,
  'room:create': RoomCreateSchema,
  'room:join': RoomJoinSchema,
  'room:leave': EmptySchema,
  'room:kick': RoomKickSchema,
  'room:update': RoomUpdateSchema,
  'match:start': EmptySchema,
  'match:end': EmptySchema,
  input: InputBatchSchema,
  pong: PongSchema,
  clock: ClockSchema,
} as const;
export type ClientEventName = keyof typeof ClientEventSchemas;
export type ClientPayload<E extends ClientEventName> = z.output<(typeof ClientEventSchemas)[E]>;

// ---------- Servidor → Cliente (tipos; o cliente confia no servidor) ----------

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface HelloOk {
  playerId: string;
  session: string;
  nickname: string;
  /** Preenchido quando a reconexão devolveu o jogador a uma sala. */
  resumedRoom: string | null;
}

export type ConnectionStatus = 'connected' | 'disconnected';

export interface LobbyPlayer {
  id: string;
  nickname: string;
  ping: number;
  status: ConnectionStatus;
  isHost: boolean;
  /** Fase 1: todos contra todos. Equipes chegam com o modo Competitivo. */
  team: 'ffa';
  kills: number;
  deaths: number;
  score: number;
  level: number;
  weaponId: string;
}

export type RoomPhase = 'lobby' | 'playing' | 'results';

export interface RoomState {
  code: string;
  hostId: string;
  phase: RoomPhase;
  settings: RoomSettings;
  players: LobbyPlayer[];
}

export interface MatchStartMsg {
  mapId: string;
  modeId: string;
  selfId: string;
  tick: number;
  serverTime: number;
  killLimit: number;
  endsAt: number;
}

/** Estado simulado completo do próprio jogador (para reconciliação). */
export interface SelfSnap {
  /** Último input processado. */
  ack: number;
  pos: [number, number, number];
  vel: [number, number, number];
  g: boolean;
  c: boolean;
  ct: number;
  jh: boolean;
  w: {
    id: string;
    ammo: number;
    reserve: number;
    cd: number;
    rl: number;
    eq: number;
    th: boolean;
    sc: number;
    bl: number;
  };
  seed: number;
  hp: number;
  alive: boolean;
  /** Incrementa a cada teleporte (spawn) — o cliente não suaviza a correção. */
  tp: number;
  /** Yaw inicial do spawn atual (aplicado pelo cliente quando `tp` muda). */
  sy: number;
  respawnIn: number;
}

/** Entidade remota (quantizada). */
export interface EntitySnap {
  id: string;
  /** posição (cm) */
  p: [number, number, number];
  y: number;
  pi: number;
  ct: number;
  g: boolean;
  /** velocidade horizontal (para animação) */
  sp: number;
  hp: number;
  a: boolean;
  w: string;
  /** spawn counter */
  tp: number;
}

export type GameEvent =
  | { k: 'shot'; s: string; o: [number, number, number]; e: [number, number, number]; hit: 'world' | 'player' | 'none'; n?: [number, number, number] }
  | { k: 'hit'; victim: string; dmg: number; region: 'head' | 'torso' | 'legs'; kill: boolean }
  | { k: 'hurt'; from: [number, number, number]; dmg: number }
  | { k: 'kill'; killer: string; victim: string; weapon: string; head: boolean }
  | { k: 'spawn'; id: string }
  | { k: 'reload'; s: string };

export interface SnapshotMsg {
  /** tick do servidor */
  t: number;
  /** tempo do servidor (ms) correspondente ao tick */
  st: number;
  self: SelfSnap | null;
  ents: EntitySnap[];
  ev: GameEvent[];
}

export interface ScoreRow {
  id: string;
  nickname: string;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  status: ConnectionStatus;
}

export interface MatchEndMsg {
  winnerId: string | null;
  reason: 'killLimit' | 'timeLimit' | 'host' | 'notEnoughPlayers';
  scoreboard: ScoreRow[];
  backToLobbyInMs: number;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomState) => void;
  'room:kicked': (m: { reason: string }) => void;
  'match:start': (m: MatchStartMsg) => void;
  'match:end': (m: MatchEndMsg) => void;
  snap: (s: SnapshotMsg) => void;
  score: (rows: ScoreRow[]) => void;
  ping: (m: { n: number }) => void;
  'server:error': (m: { error: string }) => void;
}
