import { Buttons } from '@vertice/shared';
import type { Action } from '../config/settings.js';
import { settings } from '../config/settings.js';

/**
 * Entrada de teclado e mouse com Pointer Lock. Mapeia teclas → ações
 * (remapeáveis nas configurações) → bitmask de botões do protocolo.
 */
export class Input {
  private readonly down = new Set<string>();
  private mouseButtons = 0;
  lookDX = 0;
  lookDY = 0;
  yaw = 0;
  pitch = 0;
  locked = false;
  /** Modo de teste automatizado (?e2e=1): aceita teclado sem Pointer Lock. */
  readonly e2e = new URLSearchParams(location.search).has('e2e');
  private pressedOnce = new Set<string>();
  private readonly disposers: (() => void)[] = [];
  enabled = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof DocumentEventMap>(t: EventTarget, ev: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opts);
      this.disposers.push(() => t.removeEventListener(ev, fn as EventListener, opts));
    };
    on(document, 'keydown', (e) => {
      if (!this.active) return;
      if (e.target instanceof HTMLInputElement) return;
      if (!this.down.has(e.code)) this.pressedOnce.add(e.code);
      this.down.add(e.code);
      // Evita ações do navegador durante o jogo (Tab, Espaço, Ctrl+…).
      if (this.isBound(e.code) || e.code === 'Tab') e.preventDefault();
    });
    on(document, 'keyup', (e) => {
      this.down.delete(e.code);
    });
    on(window, 'blur', () => {
      this.down.clear();
      this.mouseButtons = 0;
    });
    on(document, 'mousedown', (e) => {
      if (!this.locked) return;
      this.mouseButtons |= 1 << e.button;
    });
    on(document, 'mouseup', (e) => {
      this.mouseButtons &= ~(1 << e.button);
    });
    on(document, 'contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      const s = settings.value;
      const k = 0.0022 * s.sensitivity;
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k * (s.invertY ? -1 : 1);
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
      this.lookDX += e.movementX * k;
      this.lookDY += e.movementY * k;
    });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mouseButtons = 0;
        this.down.clear();
      }
      this.onLockChange?.(this.locked);
    });
  }

  onLockChange: ((locked: boolean) => void) | null = null;

  get active(): boolean {
    return this.enabled && (this.locked || this.e2e);
  }

  async lock(): Promise<void> {
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions);
    } catch {
      try {
        await this.canvas.requestPointerLock();
      } catch {
        /* navegador recusou (ex.: logo após sair com Esc) */
      }
    }
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private isBound(code: string): boolean {
    return Object.values(settings.value.keys).includes(code);
  }

  held(a: Action): boolean {
    return this.down.has(settings.value.keys[a]);
  }

  /** Verdadeiro uma vez por pressionamento. */
  pressed(a: Action): boolean {
    const code = settings.value.keys[a];
    if (this.pressedOnce.has(code)) {
      this.pressedOnce.delete(code);
      return true;
    }
    return false;
  }

  /** Bitmask para o InputCmd atual. */
  buttons(): number {
    if (!this.active) return 0;
    let b = 0;
    if (this.held('forward')) b |= Buttons.Forward;
    if (this.held('back')) b |= Buttons.Back;
    if (this.held('left')) b |= Buttons.Left;
    if (this.held('right')) b |= Buttons.Right;
    if (this.held('jump')) b |= Buttons.Jump;
    if (this.held('crouch') || this.held('crouchAlt')) b |= Buttons.Crouch;
    if (this.held('sprint')) b |= Buttons.Sprint;
    if (this.held('reload')) b |= Buttons.Reload;
    if (this.mouseButtons & 1) b |= Buttons.Fire;
    if (this.mouseButtons & 4) b |= Buttons.Aim;
    return b | this.extraButtons;
  }

  /** Usado apenas pelo modo e2e para simular o mouse. */
  extraButtons = 0;

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  clearPressed(): void {
    this.pressedOnce.clear();
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
  }
}
