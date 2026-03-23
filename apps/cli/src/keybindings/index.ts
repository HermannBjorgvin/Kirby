export {
  ACTIONS,
  PRESETS,
  NORMIE_PRESET,
  VIM_PRESET,
  DEFAULT_PRESET_ID,
  getPreset,
} from './registry.js';
export type {
  KeyDescriptor,
  InputContext,
  ActionDef,
  ActionId,
  KeybindPreset,
} from './registry.js';
export {
  matchesKey,
  resolveAction,
  findConflict,
  descriptorFromKeypress,
} from './resolver.js';
export {
  keyDescriptorToString,
  keysToDisplayString,
  getHintsForContext,
  getNavHintKeys,
} from './hints.js';
export type { HintEntry } from './hints.js';
