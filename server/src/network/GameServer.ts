import type { Server, Socket } from 'socket.io';
import {
  ClientEventSchemas,
  DEFAULT_ROOM_SETTINGS,
  PING_INTERVAL_MS,
  TICK_MS,
} from '@vertice/shared';
import type { Ack, ClientEventName, ClientPayload, HelloOk } from '@vertice/shared';
import { PlayerSession } from '../players/PlayerSession.js';
import { Room } from '../rooms/Room.js';
import { generateRoomCode } from '../rooms/roomCode.js';
import { serverNow } from '../core/clock.js';
import { log } from '../core/logger.js';
import { DelayLine } from './netsim.js';
import { ConnectionRateLimiter } from '../security/rateLimiter.js';
import type { ServerConfig } from '../config.js';

type AckFn = (res: unknown) => void;

/**
 * Camada de rede + orquestração: sessões, salas e laço de simulação.
 * Todo evento recebido passa por: limite de taxa → validação Zod → handler.
 */
export class GameServer {
  readonly sessionsByToken = new Map<string, PlayerSession>();
  readonly sessionsById = new Map<string, PlayerSession>();
  readonly rooms = new Map<string, Room>();
  private loopTimer: NodeJS.Timeout | null = null;
  private housekeepingTimer: NodeJS.Timeout | null = null;
  private nextTick = 0;
  private readonly oneWay: number;
  private readonly jitter: number;
  /** Contadores para diagnóstico/testes. */
  readonly counters = { invalidMessages: 0, rateLimited: 0, unknownEvents: 0 };

  constructor(
    private readonly io: Server,
    private readonly cfg: ServerConfig,
  ) {
    this.oneWay = cfg.simLatencyMs / 2;
    this.jitter = cfg.simJitterMs;
    io.on('connection', (socket) => this.onConnection(socket));
  }

  start(): void {
    this.nextTick = serverNow();
    const loop = (): void => {
      const now = serverNow();
      // Recupera ticks atrasados, mas não acumula mais de 250 ms.
      if (now - this.nextTick > 250) this.nextTick = now;
      while (this.nextTick <= now) {
        const t = this.nextTick;
        for (const room of this.rooms.values()) {
          try {
            room.step(t);
          } catch (err) {
            log.error(`falha no tick da sala ${room.code}`, err);
          }
        }
        this.nextTick += TICK_MS;
      }
      this.loopTimer = setTimeout(loop, Math.max(0, this.nextTick - serverNow() - 1));
    };
    loop();
    this.housekeepingTimer = setInterval(() => this.housekeeping(), PING_INTERVAL_MS);
  }

  stop(): void {
    if (this.loopTimer) clearTimeout(this.loopTimer);
    if (this.housekeepingTimer) clearInterval(this.housekeepingTimer);
    for (const r of this.rooms.values()) r.dispose();
  }

  private housekeeping(): void {
    const now = serverNow();
    for (const s of this.sessionsById.values()) {
      if (s.connected) s.sendPing(now);
      else if (s.disconnectedAt !== null && now - s.disconnectedAt > this.cfg.reconnectWindowMs) this.expireSession(s);
    }
    for (const room of this.rooms.values()) {
      if (room.members.size === 0) {
        room.dispose();
        this.rooms.delete(room.code);
        log.info(`sala ${room.code} removida (vazia)`);
      } else if (room.phase !== 'playing') room.broadcastState(); // atualiza pings no lobby
    }
  }

  private expireSession(s: PlayerSession): void {
    log.info(`sessão de ${s.nickname} expirou (sem reconexão em ${this.cfg.reconnectWindowMs / 1000}s)`);
    if (s.roomCode) this.rooms.get(s.roomCode)?.remove(s.id);
    this.sessionsById.delete(s.id);
    this.sessionsByToken.delete(s.token);
  }

  // ---------- conexão ----------

  private onConnection(socket: Socket): void {
    let session: PlayerSession | null = null;
    const inbound = new DelayLine(this.oneWay, this.jitter);
    const limiter = new ConnectionRateLimiter();

    const handle = <E extends ClientEventName>(event: E, fn: (data: ClientPayload<E>, ack: AckFn) => void): void => {
      (socket as unknown as { on: (e: string, l: (...a: unknown[]) => void) => void }).on(event, (...args: unknown[]) => {
        const maybeAck = args[args.length - 1];
        const ackRaw = typeof maybeAck === 'function' ? (maybeAck as AckFn) : null;
        const payload = args[0];
        inbound.run(() => {
          const now = serverNow();
          if (!limiter.allow(event, now)) {
            this.counters.rateLimited++;
            return;
          }
          const parsed = ClientEventSchemas[event].safeParse(payload);
          if (!parsed.success) {
            this.counters.invalidMessages++;
            limiter.flag(now);
            log.debug(`mensagem inválida '${event}' de ${session?.nickname ?? socket.id}`);
            if (ackRaw) ackRaw({ ok: false, error: 'mensagem inválida' });
            if (limiter.abusive) socket.disconnect(true);
            return;
          }
          if (event !== 'hello' && !session) {
            if (ackRaw) ackRaw({ ok: false, error: 'não autenticado' });
            return;
          }
          const ack: AckFn = (res) => {
            if (!ackRaw) return;
            if (session) session.delayed(() => ackRaw(res));
            else ackRaw(res);
          };
          try {
            fn(parsed.data as ClientPayload<E>, ack);
          } catch (err) {
            log.error(`erro tratando '${event}'`, err);
            ack({ ok: false, error: 'erro interno' });
          }
        });
      });
    };

    // Eventos fora do protocolo são contados e ignorados.
    socket.onAny((event: string) => {
      if (!(event in ClientEventSchemas)) {
        this.counters.unknownEvents++;
        limiter.flag(serverNow());
        if (limiter.abusive) socket.disconnect(true);
        log.debug(`evento desconhecido '${event}' ignorado`);
      }
    });

    handle('hello', (d, ack) => {
      if (session) return ack({ ok: false, error: 'já autenticado' } satisfies Ack);
      let resumed: string | null = null;
      const prev = d.session ? this.sessionsByToken.get(d.session) : undefined;
      if (prev) {
        // Reconexão. Se o servidor ainda não percebeu a queda do socket antigo
        // (ex.: troca de rede), a nova conexão assume a sessão.
        const old = prev.connected ? prev.socket : null;
        session = prev;
        session.attach(socket);
        if (old) {
          old.emit('server:error', { error: 'Sua sessão foi aberta em outra aba ou conexão.' });
          old.disconnect(true);
        }
        if (session.roomCode) {
          const room = this.rooms.get(session.roomCode);
          if (room && room.members.has(session.id)) {
            resumed = room.code;
            log.info(`${session.nickname} reconectou na sala ${room.code}`);
          } else session.roomCode = null;
        }
      } else {
        session = new PlayerSession(d.nickname, this.oneWay, this.jitter);
        session.attach(socket);
        this.sessionsById.set(session.id, session);
        this.sessionsByToken.set(session.token, session);
      }
      const res: Ack<HelloOk> = {
        ok: true,
        playerId: session.id,
        session: session.token,
        nickname: session.nickname,
        resumedRoom: resumed,
      };
      ack(res);
      if (resumed) {
        const room = this.rooms.get(resumed)!;
        // O ack acima sai antes destes eventos (mesma fila de atraso).
        room.onMemberReconnected(session);
      }
    });

    handle('room:create', (d, ack) => {
      const s = session!;
      if (s.roomCode) this.leaveRoom(s);
      const code = generateRoomCode((c) => this.rooms.has(c));
      const room = new Room(code, s, { ...DEFAULT_ROOM_SETTINGS, ...d.settings }, { lagCompensation: this.cfg.lagCompensation }, serverNow);
      this.rooms.set(code, room);
      log.info(`sala ${code} criada por ${s.nickname}`);
      ack({ ok: true, code });
      room.add(s);
    });

    handle('room:join', (d, ack) => {
      const s = session!;
      const room = this.rooms.get(d.code);
      if (!room) return ack({ ok: false, error: 'Sala não encontrada.' });
      if (room.members.has(s.id)) {
        ack({ ok: true, code: room.code });
        return room.broadcastState();
      }
      if (room.isKicked(s.token)) return ack({ ok: false, error: 'Você foi removido desta sala.' });
      if (room.isFull()) return ack({ ok: false, error: 'Sala cheia.' });
      if (s.roomCode) this.leaveRoom(s);
      ack({ ok: true, code: room.code });
      room.add(s);
      log.info(`${s.nickname} entrou na sala ${room.code}`);
    });

    handle('room:leave', (_d, ack) => {
      this.leaveRoom(session!);
      ack({ ok: true });
    });

    handle('room:kick', (d, ack) => {
      const room = this.roomOf(session!);
      if (!room) return ack({ ok: false, error: 'Fora de sala.' });
      if (room.hostId !== session!.id) return ack({ ok: false, error: 'Apenas o anfitrião pode expulsar.' });
      ack(room.kick(d.playerId) ? { ok: true } : { ok: false, error: 'Jogador inválido.' });
    });

    handle('room:update', (d, ack) => {
      const room = this.roomOf(session!);
      if (!room) return ack({ ok: false, error: 'Fora de sala.' });
      if (room.hostId !== session!.id) return ack({ ok: false, error: 'Apenas o anfitrião altera a sala.' });
      if (room.phase !== 'lobby') return ack({ ok: false, error: 'Partida em andamento.' });
      if (d.settings.maxPlayers < room.members.size) return ack({ ok: false, error: 'Há mais jogadores do que esse limite.' });
      room.settings = d.settings;
      ack({ ok: true });
      room.broadcastState();
    });

    handle('match:start', (_d, ack) => {
      const room = this.roomOf(session!);
      if (!room) return ack({ ok: false, error: 'Fora de sala.' });
      if (room.hostId !== session!.id) return ack({ ok: false, error: 'Apenas o anfitrião inicia a partida.' });
      if (room.phase === 'playing') return ack({ ok: false, error: 'A partida já começou.' });
      if (room.connectedCount < 2) return ack({ ok: false, error: 'São necessários pelo menos 2 jogadores.' });
      ack({ ok: true });
      room.startMatch();
    });

    handle('match:end', (_d, ack) => {
      const room = this.roomOf(session!);
      if (!room || !room.match) return ack({ ok: false, error: 'Sem partida.' });
      if (room.hostId !== session!.id) return ack({ ok: false, error: 'Apenas o anfitrião encerra a partida.' });
      ack({ ok: true });
      room.match.finish('host');
    });

    handle('input', (cmds) => {
      const room = this.roomOf(session!);
      if (room?.match && room.phase === 'playing') room.match.enqueueInputs(session!.id, cmds);
    });

    handle('pong', (d) => session!.onPong(d.n, serverNow()));

    handle('clock', (d, ack) => ack({ ok: true, c: d.c, s: serverNow() }));

    socket.on('disconnect', (reason) => {
      if (!session) return;
      const s = session;
      if (s.socket !== socket) return; // já substituído por outra conexão
      s.detach(serverNow());
      log.info(`${s.nickname} desconectou (${reason}); janela de reconexão de ${this.cfg.reconnectWindowMs / 1000}s`);
      const room = this.roomOf(s);
      if (room) room.onMemberDisconnected(s.id);
    });
  }

  private roomOf(s: PlayerSession): Room | null {
    return s.roomCode ? (this.rooms.get(s.roomCode) ?? null) : null;
  }

  private leaveRoom(s: PlayerSession): void {
    const room = this.roomOf(s);
    if (!room) return;
    room.remove(s.id);
    log.info(`${s.nickname} saiu da sala ${room.code}`);
    if (room.members.size === 0) {
      room.dispose();
      this.rooms.delete(room.code);
    }
  }
}
