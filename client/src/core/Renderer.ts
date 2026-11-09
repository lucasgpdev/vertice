import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { settings } from '../config/settings.js';

/** WebGLRenderer único da aplicação (reaproveitado entre partidas). */
export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  /** Antialias só muda recriando o contexto → aplicado ao recarregar. */
  readonly antialiasAtStart: boolean;

  constructor(readonly canvas: HTMLCanvasElement) {
    const g = settings.value.graphics;
    this.antialiasAtStart = g.antialias;
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: g.antialias, powerPreference: 'high-performance', stencil: false });
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.05;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.info.autoReset = false;
    this.apply();
    settings.subscribe(() => this.apply());
  }

  private envMap: THREE.Texture | null = null;

  /** Mapa de ambiente (reflexos difusos para metais), gerado uma vez. */
  environment(): THREE.Texture {
    if (!this.envMap) {
      const pmrem = new THREE.PMREMGenerator(this.webgl);
      const room = new RoomEnvironment();
      this.envMap = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
    }
    return this.envMap;
  }

  apply(): void {
    const g = settings.value.graphics;
    this.webgl.shadowMap.enabled = g.shadows !== 'off';
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * g.renderScale);
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(w: number, h: number): void {
    this.webgl.setSize(w, h, false);
  }

  /** Fundo animado leve no menu (sem cena 3D). */
  clear(): void {
    this.webgl.setClearColor(0x07090c, 1);
    this.webgl.clear();
  }
}
