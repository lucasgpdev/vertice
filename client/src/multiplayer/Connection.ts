import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION } from '@vertice/shared';
import type { Ack, ClientEventName, HelloOk, InputCmd, ServerToClientEvents } from '@vertice/shared';

type Handler<E extends keyof ServerToClientEvents> = ServerToClientEvents[E];

const SESSION_KEY = 'vertice.session';

/**
 * Conexão com o servidor. Reenvia `hello` com o token de sessão a cada
 * (re)conexão automática do Socket.IO — é isso que devolve o jogador à partida.
 * O token fica no sessionStorage (por aba), então duas abas = dois jogadores.
 */
export class Connection {
  readonly socket: Socket;
  nickname = '';
  playerId = '';
  connected = false;
  /** RTT medido pelo cliente (ms). */
  rtt = 0;
  private clockTimer: number | null = null;
  private helloListeners = new Set<(h: HelloOk) => void>();
  private statusListeners = new Set<(connected: boolean) => void>();
  /** Fatal = sessão assumida por outra aba; não reconecta. */
  fatal: string | null = null;

  constructor(url?: string) {
    this.socket = io(url ?? '/', {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
    this.socket.on('connect', () => void this.onConnect());
    this.socket.on('disconnect', () => {
      this.connected = false;
      for (const l of this.statusListeners) l(false);
    });
    this.socket.on('ping', (m: { n: number }) => this.socket.emit('pong', { n: m.n }));
    this.socket.on('server:error', (m: { error: string }) => {
      this.fatal = m.error;
    });
  }

  get session(): string | null {
    try {
      return sessionStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }

  private set session(v: string | null) {
    try {
      if (v) sessionStorage.setItem(SESSION_KEY, v);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignora */
    }
  }

  /** Conecta e autentica como convidado. */
  start(nickname: string): Promise<HelloOk> {
    this.nickname = nickname;
    return new Promise((resolve, reject) => {
      const onHello = (h: HelloOk): void => {
        this.helloListeners.delete(onHello);
        resolve(h);
      };
      this.helloListeners.add(onHello);
      this.socket.once('connect_error', (e) => {
        this.helloListeners.delete(onHello);
        reject(e);
      });
      this.socket.connect();
    });
  }

  private async onConnect(): Promise<void> {
    const res = await this.call<HelloOk>('hello', {
      v: PROTOCOL_VERSION,
      nickname: this.nickname,
      ...(this.session ? { session: this.session } : {}),
    });
    if (!res.ok) {
      console.warn('hello recusado:', res.error);
      return;
    }
    this.playerId = res.playerId;
    this.session = res.session;
    this.connected = true;
    for (const l of this.statusListeners) l(true);
    for (const l of [...this.helloListeners]) l(res);
    this.startClock();
  }

  onHello(l: (h: HelloOk) => void): () => void {
    this.helloListeners.add(l);
    return () => this.helloListeners.delete(l);
  }

  onStatus(l: (connected: boolean) => void): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  on<E extends keyof ServerToClientEvents>(event: E, fn: Handler<E>): () => void {
    this.socket.on(event as string, fn as (...a: unknown[]) => void);
    return () => this.socket.off(event as string, fn as (...a: unknown[]) => void);
  }

  async call<T = object>(event: ClientEventName, data: unknown, timeoutMs = 6000): Promise<Ack<T>> {
    try {
      return (await this.socket.timeout(timeoutMs).emitWithAck(event, data)) as Ack<T>;
    } catch {
      return { ok: false, error: 'Sem resposta do servidor.' };
    }
  }

  sendInputs(cmds: InputCmd[]): void {
    if (this.socket.connected) this.socket.emit('input', cmds);
  }

  private startClock(): void {
    if (this.clockTimer !== null) return;
    const tick = async (): Promise<void> => {
      if (!this.socket.connected) return;
      const c = performance.now();
      const r = await this.call<{ c: number; s: number }>('clock', { c }, 3000);
      if (r.ok) {
        const sample = performance.now() - r.c;
        this.rtt = this.rtt === 0 ? sample : this.rtt * 0.75 + sample * 0.25;
      }
    };
    void tick();
    this.clockTimer = window.setInterval(() => void tick(), 2000);
  }
}
