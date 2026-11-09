import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '@assets/manifest.json';
import type { PbrSet } from './proceduralTextures.js';

/**
 * AssetManager central: lê `assets/manifest.json`, constrói ou carrega cada
 * asset uma vez (cache) e libera memória (dispose) ao sair da partida.
 *
 * - `procedural`: um construtor registrado em código (provisório).
 * - `gltf`: arquivo GLB/GLTF servido de /assets (caminho pronto para os
 *   modelos finais; ainda NÃO exercitado com um arquivo real na Fase 1).
 *
 * Trocar um modelo = trocar a entrada no manifesto. A lógica de jogo só
 * conhece os ids.
 */

interface ManifestEntry {
  id: string;
  type: 'procedural' | 'gltf';
  builder?: string;
  src?: string;
  version: number;
  provisional?: boolean;
}

type ModelBuilder = () => THREE.Object3D;
type TextureBuilder = () => PbrSet;

export class AssetManager {
  private readonly entries = new Map<string, ManifestEntry>();
  private readonly modelBuilders = new Map<string, ModelBuilder>();
  private readonly textureBuilders = new Map<string, TextureBuilder>();
  private readonly textureCache = new Map<string, PbrSet>();
  private readonly gltfCache = new Map<string, Promise<THREE.Object3D>>();
  private readonly loader = new GLTFLoader();

  constructor() {
    for (const e of (manifest as { assets: ManifestEntry[] }).assets) this.entries.set(e.id, e);
  }

  registerModel(builder: string, fn: ModelBuilder): void {
    this.modelBuilders.set(builder, fn);
  }

  registerTexture(builder: string, fn: TextureBuilder): void {
    this.textureBuilders.set(builder, fn);
  }

  entry(id: string): ManifestEntry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Asset não registrado no manifesto: ${id}`);
    return e;
  }

  /** Lista de ids provisórios (para o painel de depuração). */
  provisional(): string[] {
    return [...this.entries.values()].filter((e) => e.provisional).map((e) => e.id);
  }

  /** Instância nova de um modelo (procedural síncrono). */
  model(id: string): THREE.Object3D {
    const e = this.entry(id);
    if (e.type !== 'procedural') throw new Error(`Modelo ${id} é ${e.type}; use modelAsync()`);
    const fn = this.modelBuilders.get(e.builder ?? '');
    if (!fn) throw new Error(`Construtor procedural ausente: ${e.builder}`);
    return fn();
  }

  /** Modelo de qualquer tipo; GLTF é carregado uma vez e clonado. */
  async modelAsync(id: string): Promise<THREE.Object3D> {
    const e = this.entry(id);
    if (e.type === 'procedural') return this.model(id);
    let p = this.gltfCache.get(id);
    if (!p) {
      p = this.loader.loadAsync(`/assets/${e.src}?v=${e.version}`).then((g) => g.scene);
      this.gltfCache.set(id, p);
    }
    return (await p).clone(true);
  }

  texture(id: string): PbrSet {
    let t = this.textureCache.get(id);
    if (t) return t;
    const e = this.entry(id);
    const fn = this.textureBuilders.get(e.builder ?? '');
    if (!fn) throw new Error(`Construtor de textura ausente: ${e.builder}`);
    t = fn();
    this.textureCache.set(id, t);
    return t;
  }

  /** Libera texturas e modelos em cache (chamado ao sair do mapa). */
  dispose(): void {
    for (const t of this.textureCache.values()) {
      t.map.dispose();
      t.normalMap.dispose();
      t.roughnessMap.dispose();
    }
    this.textureCache.clear();
    for (const p of this.gltfCache.values()) void p.then((o) => disposeObject(o)).catch(() => undefined);
    this.gltfCache.clear();
  }
}

/** Libera geometrias e materiais de uma árvore de objetos. */
export const disposeObject = (root: THREE.Object3D): void => {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
};
