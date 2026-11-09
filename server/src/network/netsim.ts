/**
 * Simulador de rede: aplica atraso (e jitter) em cada direção, preservando a
 * ordem das mensagens (como o TCP faz). Usado em testes e com
 * NET_SIM_LATENCY_MS para avaliar o netcode sob latência.
 */
export class DelayLine {
  private lastDelivery = 0;
  constructor(
    private readonly oneWayMs: number,
    private readonly jitterMs: number,
  ) {}

  get enabled(): boolean {
    return this.oneWayMs > 0 || this.jitterMs > 0;
  }

  run(fn: () => void): void {
    if (!this.enabled) {
      fn();
      return;
    }
    const now = Date.now();
    const jitter = this.jitterMs > 0 ? (Math.random() * 2 - 1) * this.jitterMs : 0;
    const at = Math.max(this.lastDelivery, now + this.oneWayMs + jitter);
    this.lastDelivery = at;
    setTimeout(fn, Math.max(0, at - now));
  }
}
