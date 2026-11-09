import { randomBytes } from 'node:crypto';
import type { Socket } from 'socket.io';
import type { ServerToClientEvents } from '@vertice/shared';
import { DelayLine } from '../network/netsim.js';

type Emit = <E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>) => void;

/**
 * Identidade de um jogador convidado. Sobrevive à queda da conexão durante a
 * janela de reconexão: o socket muda, a sessão (id, estatísticas, sala) não.
 */
export class PlayerSession {
  readonly id: string;
  readonly token: string;
  nickname: string;
  socket: Socket | null = null;
  roomCode: string | null = null;
  disconnectedAt: number | null = null;
  /** RTT medido pelo servidor (ms), suavizado. */
  rtt = 0;
  private out: DelayLine;
  private pingSent = new Map<number, number>();
  private pingN = 0;

  constructor(nickname: string, private readonly simOneWayMs: number, private readonly simJitterMs: number) {
    this.id = randomBytes(6).toString('hex');
    this.token = randomBytes(16).toString('hex');
    this.nickname = nickname;
    this.out = new DelayLine(simOneWayMs, simJitterMs);
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.connected;
  }

  attach(socket: Socket): void {
    this.socket = socket;
    this.disconnectedAt = null;
    // Nova conexão = nova linha de atraso.
    this.out = new DelayLine(this.simOneWayMs, this.simJitterMs);
    this.pingSent.clear();
  }

  detach(now: number): void {
    this.socket = null;
    this.disconnectedAt = now;
  }

  /** Envia uma mensagem (passando pelo simulador de latência, se ativo). */
  readonly emit: Emit = (event, ...args) => {
    const s = this.socket;
    if (!s) return;
    this.out.run(() => {
      if (this.socket === s && s.connected) (s.emit as (e: string, ...a: unknown[]) => void)(event, ...args);
    });
  };

  /** Executa `fn` respeitando o atraso de saída (para respostas de ack). */
  delayed(fn: () => void): void {
    this.out.run(fn);
  }

  sendPing(now: number): void {
    const n = ++this.pingN;
    this.pingSent.set(n, now);
    if (this.pingSent.size > 10) {
      const first = this.pingSent.keys().next().value;
      if (first !== undefined) this.pingSent.delete(first);
    }
    this.emit('ping', { n });
  }

  onPong(n: number, now: number): void {
    const sent = this.pingSent.get(n);
    if (sent === undefined) return;
    this.pingSent.delete(n);
    const sample = now - sent;
    this.rtt = this.rtt === 0 ? sample : this.rtt * 0.7 + sample * 0.3;
  }

  get ping(): number {
    return Math.round(this.rtt);
  }
}
