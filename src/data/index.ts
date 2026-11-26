import type { GameDataCatalog } from '../contracts/index.ts';
import { CHALLENGES } from './challenges.ts';
import { CHARACTERS, CHARACTERS_BY_ID } from './characters.ts';
import { DIFFICULTIES } from './difficulties.ts';
import { ENEMIES, ENEMIES_BY_ID } from './enemies.ts';
import { ITEMS, ITEMS_BY_ID } from './items.ts';
import { SETS, SETS_BY_ID } from './sets.ts';
import { UPGRADES, UPGRADES_BY_ID } from './upgrades.ts';
import { createEndlessWaveDef, getWaveDef, WAVES } from './waves.ts';
import { WEAPONS, WEAPONS_BY_ID } from './weapons.ts';
import { ZONES } from './zones.ts';

export const GAME_CATALOG: GameDataCatalog = {
  characters: CHARACTERS,
  weapons: WEAPONS,
  sets: SETS,
  items: ITEMS,
  upgrades: UPGRADES,
  enemies: ENEMIES,
  waves: WAVES,
  difficulties: DIFFICULTIES,
  zones: ZONES,
  challenges: CHALLENGES,
  charactersById: CHARACTERS_BY_ID,
  weaponsById: WEAPONS_BY_ID,
  setsById: SETS_BY_ID,
  itemsById: ITEMS_BY_ID,
  upgradesById: UPGRADES_BY_ID,
  enemiesById: ENEMIES_BY_ID,
};

export {
  CHALLENGES,
  CHARACTERS,
  CHARACTERS_BY_ID,
  createEndlessWaveDef,
  DIFFICULTIES,
  ENEMIES,
  ENEMIES_BY_ID,
  getWaveDef,
  ITEMS,
  ITEMS_BY_ID,
  SETS,
  SETS_BY_ID,
  UPGRADES,
  UPGRADES_BY_ID,
  WAVES,
  WEAPONS,
  WEAPONS_BY_ID,
  ZONES,
};
