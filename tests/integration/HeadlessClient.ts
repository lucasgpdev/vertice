import { io, type Socket } from 'socket.io-client';
import {
  Buttons,
  CollisionWorld,
  DEFAULT_ROOM_SETTINGS,
  InterpolationBuffer,
  PROTOCOL_VERSION,
  Predictor,
  SnapshotClock,
  TICK_MS,
  eyePosition,
  getMap,
} from '@vertice/shared';
import type {
  Ack,
  GameEvent,
  HelloOk,
  InputCmd,
  InterpolatedEntity,
  MatchEndMsg,
  MatchStartMsg,
  RoomSettings,
  RoomState,
  ScoreRow,
  SnapshotMsg,
} from '@vertice/shared';

const now = (): number => performance.now();

/**
 * Cliente headless usado nos testes de integração. Usa o MESMO código de
 * predição, reconciliação e interpolação do cliente do navegador (shared/net).
 */
export class HeadlessClient {
  socket!: Socket;
  id = '';
  session = '';
  room: RoomState | null = null;
  match: MatchStartMsg | null = null;
  matchEnd: MatchEndMsg | null = null;
  lastSnap: SnapshotMsg | null = null;
  score: ScoreRow[] = [];
  events: GameEvent[] = [];
  snapCount = 0;
  kicked = false;
  readonly world = new CollisionWorld(getMap('arena-patio7').boxes);
  readonly predictor = new Predictor(this.world);
  readonly clock = new SnapshotClock();
  readonly interp = new InterpolationBuffer();
  buttons = 0;
  yaw = 0;
  pitch = 0;
  /** Chamado antes de cada input (para controlar mira/botões a 60 Hz). */
  onTick: ((c: HeadlessClient) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  sentInputs = 0;

  constructor(
    readonly url: string,
    readonly nickname: string,
  ) {}

  async connect(session?: string): Promise<HelloOk> {
    this.socket = io(this.url, { transports: ['websocket'], reconnection: false, forceNew: true });
    this.socket.on('room:state', (s: RoomState) => (this.room = s));
    this.socket.on('room:kicked', () => (this.kicked = true));
    this.socket.on('match:start', (m: MatchStartMsg) => {
      this.match = m;
      this.matchEnd = null;
      this.predictor.resetForMatch();
      this.interp.clear();
      this.clock.reset();
    });
    this.socket.on('match:end', (m: MatchEndMsg) => (this.matchEnd = m));
    this.socket.on('score', (r: ScoreRow[]) => (this.score = r));
    this.socket.on('ping', (m: { n: number }) => this.socket.emit('pong', { n: m.n }));
    this.socket.on('snap', (s: SnapshotMsg) => this.onSnap(s));
    await new Promise<void>((res, rej) => {
      this.socket.once('connect', () => res());
      this.socket.once('connect_error', rej);
    });
    const r = await this.call<HelloOk>('hello', { v: PROTOCOL_VERSION, nickname: this.nickname, ...(session ? { session } : {}) });
    if (!r.ok) throw new Error(r.error);
    this.id = r.playerId;
    this.session = r.session;
    return r;
  }

  private onSnap(s: SnapshotMsg): void {
    this.snapCount++;
    this.lastSnap = s;
    this.clock.observe(s.st, now());
    this.interp.push(s.st, s.ents);
    if (s.self) {
      const rr = this.predictor.reconcile(s.self);
      if (rr.teleported) this.yaw = s.self.sy;
    }
    this.events.push(...s.ev);
  }

  call<T = object>(event: string, data: unknown, timeoutMs = 5000): Promise<Ack<T>> {
    return this.socket.timeout(timeoutMs).emitWithAck(event, data) as Promise<Ack<T>>;
  }

  async createRoom(settings: Partial<RoomSettings> = {}): Promise<string> {
    const r = await this.call<{ code: string }>('room:create', { settings: { ...DEFAULT_ROOM_SETTINGS, ...settings } });
    if (!r.ok) throw new Error(r.error);
    return r.code;
  }

  async join(code: string): Promise<Ack<{ code: string }>> {
    return this.call<{ code: string }>('room:join', { code });
  }

  /** Inicia o envio de inputs a 60 Hz (como o navegador). */
  startInput(): void {
    this.stopInput();
    let next = now();
    const loop = (): void => {
      const t = now();
      while (next <= t) {
        this.onTick?.(this);
        const vt = this.clock.ready ? this.clock.renderTime(t) : 0;
        const { cmd } = this.predictor.step(this.buttons, this.yaw, this.pitch, vt);
        this.sendInputs([cmd]);
        next += TICK_MS;
      }
      this.timer = setTimeout(loop, Math.max(0, next - now()));
    };
    loop();
  }

  stopInput(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  sendInputs(cmds: InputCmd[]): void {
    this.sentInputs += cmds.length;
    this.socket.emit('input', cmds);
  }

  /** Entidade remota como este cliente a vê agora (interpolada). */
  view(id: string): InterpolatedEntity | undefined {
    return this.interp.sample(this.clock.renderTime(now())).get(id);
  }

  /** Mira no tronco da entidade `id` como vista agora. */
  aimAt(id: string, height = 1.15): boolean {
    const e = this.view(id);
    if (!e) return false;
    const eye = eyePosition(this.predictor.state.move);
    const dx = e.x - eye.x;
    const dy = e.y + height - eye.y;
    const dz = e.z - eye.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return true;
  }

  pressFire(on: boolean): void {
    this.buttons = on ? this.buttons | Buttons.Fire : this.buttons & ~Buttons.Fire;
  }

  disconnect(): void {
    this.stopInput();
    this.socket.disconnect();
  }
}

export const waitFor = async (pred: () => boolean, timeoutMs = 5000, label = 'condição'): Promise<void> => {
  const start = now();
  while (!pred()) {
    if (now() - start > timeoutMs) throw new Error(`timeout esperando ${label}`);
    await sleep(10);
  }
};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
