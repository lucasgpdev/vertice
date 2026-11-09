import type { ClientEventName } from '@vertice/shared';

/** Balde de fichas: `rate` fichas por segundo, até `burst`. */
class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/** Limites por tipo de mensagem (por conexão). */
export const RATE_LIMITS: Record<ClientEventName, { rate: number; burst: number }> = {
  hello: { rate: 1, burst: 3 },
  'room:create': { rate: 1, burst: 3 },
  'room:join': { rate: 2, burst: 5 },
  'room:leave': { rate: 2, burst: 5 },
  'room:kick': { rate: 2, burst: 5 },
  'room:update': { rate: 4, burst: 8 },
  'match:start': { rate: 1, burst: 3 },
  'match:end': { rate: 1, burst: 3 },
  // O cliente envia 60 inputs/s; deixamos folga para rajadas de rede.
  input: { rate: 75, burst: 45 },
  pong: { rate: 3, burst: 5 },
  clock: { rate: 4, burst: 8 },
};

export class ConnectionRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private violations = 0;
  private windowStart = 0;

  /** Retorna true se a mensagem pode ser processada. */
  allow(event: ClientEventName, now: number): boolean {
    let b = this.buckets.get(event);
    if (!b) {
      const cfg = RATE_LIMITS[event];
      b = new TokenBucket(cfg.rate, cfg.burst, now);
      this.buckets.set(event, b);
    }
    const ok = b.take(now);
    if (!ok) this.flag(now);
    return ok;
  }

  /** Registra violação (mensagem inválida, desconhecida ou acima do limite). */
  flag(now: number): void {
    if (now - this.windowStart > 10_000) {
      this.windowStart = now;
      this.violations = 0;
    }
    this.violations++;
  }

  /** Conexões com abuso persistente são derrubadas. */
  get abusive(): boolean {
    return this.violations > 300;
  }
}
