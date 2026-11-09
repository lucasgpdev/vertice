/** Configurações do jogador (persistidas no localStorage deste navegador). */

export type Quality = 'low' | 'medium' | 'high' | 'custom';

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'crouchAlt'
  | 'sprint'
  | 'reload'
  | 'scoreboard'
  | 'debug';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Mover para frente',
  back: 'Mover para trás',
  left: 'Mover para a esquerda',
  right: 'Mover para a direita',
  jump: 'Pular',
  crouch: 'Agachar',
  crouchAlt: 'Agachar (alternativo)',
  sprint: 'Correr',
  reload: 'Recarregar',
  scoreboard: 'Placar',
  debug: 'Painel de depuração',
};

export interface GraphicsSettings {
  shadows: 'off' | 'low' | 'high';
  renderScale: number;
  antialias: boolean;
}

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  showNames: boolean;
  showDebug: boolean;
  quality: Quality;
  graphics: GraphicsSettings;
  volume: { master: number; effects: number; ui: number };
  crosshair: { color: string; size: number; gap: number; thickness: number; dot: boolean };
  keys: Record<Action, string>;
}

export const QUALITY_PRESETS: Record<Exclude<Quality, 'custom'>, GraphicsSettings> = {
  low: { shadows: 'off', renderScale: 0.75, antialias: false },
  medium: { shadows: 'low', renderScale: 1, antialias: false },
  high: { shadows: 'high', renderScale: 1, antialias: true },
};

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  crouch: 'ControlLeft',
  crouchAlt: 'KeyC',
  sprint: 'ShiftLeft',
  reload: 'KeyR',
  scoreboard: 'Tab',
  debug: 'F3',
};

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1.0,
  invertY: false,
  fov: 95,
  showNames: true,
  showDebug: false,
  quality: 'medium',
  graphics: { ...QUALITY_PRESETS.medium },
  volume: { master: 0.8, effects: 0.9, ui: 0.7 },
  crosshair: { color: '#6dffb0', size: 7, gap: 4, thickness: 2, dot: false },
  keys: { ...DEFAULT_KEYS },
};

const KEY = 'vertice.settings.v1';

type Listener = (s: Settings) => void;

class SettingsStore {
  private s: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    this.s = structuredClone(DEFAULT_SETTINGS);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Settings>;
        this.s = {
          ...this.s,
          ...saved,
          graphics: { ...this.s.graphics, ...saved.graphics },
          volume: { ...this.s.volume, ...saved.volume },
          crosshair: { ...this.s.crosshair, ...saved.crosshair },
          keys: { ...this.s.keys, ...saved.keys },
        };
      }
    } catch {
      /* armazenamento indisponível: usa padrões */
    }
  }

  get value(): Settings {
    return this.s;
  }

  update(fn: (s: Settings) => void): void {
    fn(this.s);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* ignora */
    }
    for (const l of this.listeners) l(this.s);
  }

  setQuality(q: Quality): void {
    this.update((s) => {
      s.quality = q;
      if (q !== 'custom') s.graphics = { ...QUALITY_PRESETS[q] };
    });
  }

  reset(): void {
    this.update((s) => Object.assign(s, structuredClone(DEFAULT_SETTINGS)));
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const settings = new SettingsStore();

/** Nome legível de uma tecla (KeyboardEvent.code). */
export const keyLabel = (code: string): string => {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Espaço',
    ShiftLeft: 'Shift Esq.',
    ShiftRight: 'Shift Dir.',
    ControlLeft: 'Ctrl Esq.',
    ControlRight: 'Ctrl Dir.',
    AltLeft: 'Alt',
    Tab: 'Tab',
    Enter: 'Enter',
    Backquote: '`',
  };
  return map[code] ?? code;
};
