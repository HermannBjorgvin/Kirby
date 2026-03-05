import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { AppConfig, VcsProvider } from './types.js';

const WM_DIR = join(homedir(), '.kirby');
const GLOBAL_CONFIG_PATH = join(WM_DIR, 'config.json');

// ── Internal file helpers ──────────────────────────────────────────

/** Hash CWD to a 16-char hex key for per-project config */
export function projectKey(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

function projectConfigPath(cwd: string): string {
  return join(WM_DIR, 'projects', projectKey(cwd), 'config.json');
}

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    const data = readFileSync(path, 'utf8');
    return { ...fallback, ...JSON.parse(data) };
  } catch {
    return { ...fallback };
  }
}

function writeJsonFile<T>(path: string, data: T): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

// ── Raw config shapes (on-disk) ────────────────────────────────────

interface RawGlobalConfig {
  pat?: string;
  prPollInterval?: number;
  aiCommand?: string;
  vendorAuth?: Record<string, Record<string, string>>;
  autoDeleteOnMerge?: boolean;
  autoRebase?: boolean;
  mergePollInterval?: number;
}

interface RawProjectConfig {
  org?: string;
  project?: string;
  repo?: string;
  email?: string;
  vendor?: string;
  vendorProject?: Record<string, string>;
}

// ── Migration from old flat format ─────────────────────────────────

function migrateGlobalConfig(raw: RawGlobalConfig): RawGlobalConfig {
  if (raw.pat && !raw.vendorAuth) {
    raw.vendorAuth = {
      'azure-devops': { pat: raw.pat },
    };
    delete raw.pat;
  }
  return raw;
}

function migrateProjectConfig(raw: RawProjectConfig): RawProjectConfig {
  if ((raw.org || raw.project || raw.repo) && !raw.vendorProject) {
    raw.vendor = 'azure-devops';
    raw.vendorProject = {};
    if (raw.org) {
      raw.vendorProject.org = raw.org;
      delete raw.org;
    }
    if (raw.project) {
      raw.vendorProject.project = raw.project;
      delete raw.project;
    }
    if (raw.repo) {
      raw.vendorProject.repo = raw.repo;
      delete raw.repo;
    }
  }
  return raw;
}

// ── Public API ──────────────────────────────────────────────────────

export function readGlobalConfig(): RawGlobalConfig {
  const raw = readJsonFile<RawGlobalConfig>(GLOBAL_CONFIG_PATH, {});
  return migrateGlobalConfig(raw);
}

export function writeGlobalConfig(config: RawGlobalConfig): void {
  writeJsonFile(GLOBAL_CONFIG_PATH, config);
}

export function readProjectConfig(cwd = process.cwd()): RawProjectConfig {
  const raw = readJsonFile<RawProjectConfig>(projectConfigPath(cwd), {});
  return migrateProjectConfig(raw);
}

export function writeProjectConfig(
  config: RawProjectConfig,
  cwd = process.cwd()
): void {
  writeJsonFile(projectConfigPath(cwd), config);
}

/** Read merged config: global + project → AppConfig */
export function readConfig(cwd = process.cwd()): AppConfig {
  const global = readGlobalConfig();
  const project = readProjectConfig(cwd);

  const vendor = project.vendor;
  const vendorAuth = (vendor ? global.vendorAuth?.[vendor] : undefined) ?? {};
  const vendorProject = project.vendorProject ?? {};

  return {
    email: project.email,
    prPollInterval: global.prPollInterval,
    aiCommand: global.aiCommand,
    vendor,
    vendorAuth,
    vendorProject,
    autoDeleteOnMerge: global.autoDeleteOnMerge,
    autoRebase: global.autoRebase,
    mergePollInterval: global.mergePollInterval,
  };
}

/** Check if the given provider is fully configured */
export function isVcsConfigured(
  config: AppConfig,
  provider: VcsProvider | null
): boolean {
  if (!provider) return false;
  return provider.isConfigured(config.vendorAuth, config.vendorProject);
}

/**
 * Auto-detect project config from the git repo.
 * Tries each provider's parseRemoteUrl to fill vendor + vendorProject.
 * Fills email from `git config user.email`.
 * Writes back if any field was updated.
 */
export function autoDetectProjectConfig(
  cwd = process.cwd(),
  providers: VcsProvider[] = []
): {
  updated: boolean;
  detected: Record<string, string>;
} {
  const cfg = readProjectConfig(cwd);
  const detected: Record<string, string> = {};

  // Auto-detect vendor + project fields from git remote
  if (!cfg.vendor || !cfg.vendorProject) {
    try {
      const remoteUrl = execSync('git remote get-url origin', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      for (const provider of providers) {
        const parsed = provider.parseRemoteUrl(remoteUrl);
        if (parsed) {
          cfg.vendor = provider.id;
          cfg.vendorProject = parsed;
          detected.vendor = provider.id;
          for (const [k, v] of Object.entries(parsed)) {
            detected[k] = v;
          }
          break;
        }
      }
    } catch {
      // git remote may fail — not critical
    }
  }

  // Auto-detect provider-specific fields (e.g., GitHub username)
  const matchedProvider = providers.find((p) => p.id === cfg.vendor);
  if (matchedProvider?.autoDetectFields) {
    try {
      const extra = matchedProvider.autoDetectFields();
      if (extra) {
        cfg.vendorProject ??= {};
        for (const [k, v] of Object.entries(extra)) {
          if (!cfg.vendorProject[k]) {
            cfg.vendorProject[k] = v;
            detected[k] = v;
          }
        }
      }
    } catch {
      // autoDetectFields may fail — not critical
    }
  }

  // Auto-detect email from git config
  if (!cfg.email) {
    try {
      const email = execSync('git config user.email', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      if (email) {
        cfg.email = email;
        detected.email = email;
      }
    } catch {
      // git config may fail — not critical
    }
  }

  const updated = Object.keys(detected).length > 0;
  if (updated) {
    writeProjectConfig(cfg, cwd);
  }

  return { updated, detected };
}
