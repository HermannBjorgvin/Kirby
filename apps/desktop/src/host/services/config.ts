import { readConfig } from '@kirby/vcs-core';
import {
  updateConfigField,
  persistConfigField,
  type SettingsField,
} from '@kirby/app-core';
import { requireRepo } from './repo.js';

/**
 * Settings edits mirror the CLI's semantics exactly: app-core's
 * updateConfigField/persistConfigField decide which bag (global /
 * project / vendorAuth / vendorProject) each field lands in, so both
 * shells write identical files.
 */
export function getConfig(): ReturnType<typeof readConfig> {
  return readConfig(requireRepo());
}

export function updateSettingsField(
  field: SettingsField,
  value: string | undefined
): ReturnType<typeof readConfig> {
  const cwd = requireRepo();
  const current = readConfig(cwd);
  const updated = updateConfigField(current, field, value);
  persistConfigField(field, value, updated);
  return updated;
}
