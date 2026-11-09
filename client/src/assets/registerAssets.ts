import type { AssetManager } from './AssetManager.js';
import { texConcrete, texCrate, texFloor, texMetal, texTrim } from './proceduralTextures.js';
import { buildPistol } from '../weapons/pistolModel.js';
import { buildOperator } from '../characters/operatorModel.js';
import { buildArms } from '../weapons/ViewModel.js';
import { RELATION_COLORS } from '../characters/RemotePlayer.js';

/**
 * Liga os ids "builder" do manifesto aos construtores procedurais.
 * Contrato para o modelo final (GLB): os mesmos nós nomeados
 * (slide, magazine, trigger, muzzle / hips, spine, head, thighL…).
 */
export const registerProceduralAssets = (assets: AssetManager): void => {
  assets.registerTexture('texFloor', texFloor);
  assets.registerTexture('texConcrete', () => texConcrete(false));
  assets.registerTexture('texConcreteDark', () => texConcrete(true));
  assets.registerTexture('texMetal', texMetal);
  assets.registerTexture('texCrate', texCrate);
  assets.registerTexture('texTrim', texTrim);
  assets.registerModel('pistolCorvo', () => buildPistol().root);
  assets.registerModel('operator', () => buildOperator(RELATION_COLORS.enemy).root);
  assets.registerModel('fpArms', () => buildArms(RELATION_COLORS.ally));
};
