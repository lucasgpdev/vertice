import { describe, expect, it } from 'vitest';
import { ClientEventSchemas, HISTORY_TICKS, InputBatchSchema, ROOM_CODE_ALPHABET, TICK_MS } from '@vertice/shared';
import { ConnectionRateLimiter, RATE_LIMITS } from './rateLimiter.js';
import { generateRoomCode } from '../rooms/roomCode.js';
import { PositionHistory } from '../combat/LagCompensation.js';

describe('validação de mensagens (Zod, estrita)', () => {
  it('aceita input válido', () => {
    expect(InputBatchSchema.safeParse([{ s: 1, b: 3, y: 0.5, p: -0.2, vt: 1000 }]).success).toBe(true);
  });
  it('rejeita campos extras (ex.: posição enviada pelo cliente)', () => {
    expect(InputBatchSchema.safeParse([{ s: 1, b: 0, y: 0, p: 0, vt: 0, pos: { x: 1, y: 2, z: 3 } }]).success).toBe(false);
  });
  it('rejeita valores fora da faixa / tipos errados', () => {
    expect(InputBatchSchema.safeParse([{ s: -1, b: 0, y: 0, p: 0, vt: 0 }]).success).toBe(false);
    expect(InputBatchSchema.safeParse([{ s: 1, b: 1 << 12, y: 0, p: 0, vt: 0 }]).success).toBe(false);
    expect(InputBatchSchema.safeParse([{ s: 1, b: 0, y: Number.NaN, p: 0, vt: 0 }]).success).toBe(false);
    expect(InputBatchSchema.safeParse([{ s: 1, b: 0, y: 0, p: 3, vt: 0 }]).success).toBe(false);
    expect(InputBatchSchema.safeParse(Array(5).fill({ s: 1, b: 0, y: 0, p: 0, vt: 0 })).success).toBe(false);
  });
  it('nickname e código de sala', () => {
    expect(ClientEventSchemas.hello.safeParse({ v: 1, nickname: 'ab' }).success).toBe(false);
    expect(ClientEventSchemas.hello.safeParse({ v: 1, nickname: '<script>' }).success).toBe(false);
    expect(ClientEventSchemas.hello.safeParse({ v: 1, nickname: 'Operador_1' }).success).toBe(true);
    expect(ClientEventSchemas['room:join'].safeParse({ code: 'abc234' }).success).toBe(true);
    expect(ClientEventSchemas['room:join'].safeParse({ code: 'ABC10O' }).success).toBe(false);
  });
});

describe('limite de taxa', () => {
  it('libera a rajada e depois limita ao ritmo configurado', () => {
    const rl = new ConnectionRateLimiter();
    let ok = 0;
    for (let i = 0; i < 100; i++) if (rl.allow('room:create', 0)) ok++;
    expect(ok).toBe(RATE_LIMITS['room:create'].burst);
    // 1 s depois, recupera `rate` fichas.
    let ok2 = 0;
    for (let i = 0; i < 100; i++) if (rl.allow('room:create', 1000)) ok2++;
    expect(ok2).toBe(RATE_LIMITS['room:create'].rate);
  });
  it('conexão com abuso persistente é marcada', () => {
    const rl = new ConnectionRateLimiter();
    for (let i = 0; i < 400; i++) rl.allow('hello', 0);
    expect(rl.abusive).toBe(true);
  });
});

describe('código de sala', () => {
  it('6 caracteres do alfabeto sem ambíguos e sem colisão', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generateRoomCode((x) => seen.has(x));
      expect(c).toHaveLength(6);
      expect([...c].every((ch) => ROOM_CODE_ALPHABET.includes(ch))).toBe(true);
      expect(seen.has(c)).toBe(false);
      seen.add(c);
    }
  });
});

describe('histórico de posições (rewind)', () => {
  it('interpola entre ticks e respeita vidas diferentes', () => {
    const h = new PositionHistory();
    for (let t = 0; t < 10; t++) h.record(t * TICK_MS, { x: t, y: 0, z: 0 }, 0, true, 1);
    expect(h.sample(4.5 * TICK_MS)!.pos.x).toBeCloseTo(4.5, 5);
    h.record(10 * TICK_MS, { x: 100, y: 0, z: 0 }, 0, true, 2); // renasceu longe
    const s = h.sample(9.9 * TICK_MS)!;
    expect(s.pos.x === 9 || s.pos.x === 100).toBe(true); // nunca um ponto intermediário
  });
  it('não ressuscita: amostra de jogador morto retorna null', () => {
    const h = new PositionHistory();
    h.record(0, { x: 0, y: 0, z: 0 }, 0, false, 1);
    h.record(TICK_MS, { x: 0, y: 0, z: 0 }, 0, false, 1);
    expect(h.sample(TICK_MS / 2)).toBeNull();
  });
  it('mantém no máximo HISTORY_TICKS amostras', () => {
    const h = new PositionHistory();
    for (let t = 0; t < HISTORY_TICKS * 3; t++) h.record(t * TICK_MS, { x: t, y: 0, z: 0 }, 0, true, 1);
    // A mais antiga disponível é HISTORY_TICKS atrás; pedir antes devolve a mais antiga.
    expect(h.sample(0)!.pos.x).toBe(HISTORY_TICKS * 2);
  });
});
