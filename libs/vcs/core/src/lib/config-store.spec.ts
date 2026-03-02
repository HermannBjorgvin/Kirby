import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  projectKey,
  readGlobalConfig,
  readProjectConfig,
  readConfig,
  isVcsConfigured,
  autoDetectProjectConfig,
} from './config-store.js';
import type { AppConfig, VcsProvider } from './types.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('projectKey', () => {
  it('should return a deterministic 16-char hex string', () => {
    const key = projectKey('/home/user/project');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should return the same key for the same input', () => {
    const key1 = projectKey('/home/user/project');
    const key2 = projectKey('/home/user/project');
    expect(key1).toBe(key2);
  });

  it('should return different keys for different inputs', () => {
    const key1 = projectKey('/home/user/project-a');
    const key2 = projectKey('/home/user/project-b');
    expect(key1).not.toBe(key2);
  });
});

describe('migrateGlobalConfig (via readGlobalConfig)', () => {
  it('should migrate flat pat field to vendorAuth', () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ pat: 'my-token' }));

    const config = readGlobalConfig();
    expect(config.vendorAuth).toEqual({
      'azure-devops': { pat: 'my-token' },
    });
    expect(config.pat).toBeUndefined();
  });

  it('should not migrate when vendorAuth already exists', () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        pat: 'old-token',
        vendorAuth: { github: { token: 'gh-token' } },
      })
    );

    const config = readGlobalConfig();
    expect(config.vendorAuth).toEqual({ github: { token: 'gh-token' } });
    // pat is preserved because vendorAuth exists — migration skipped
    expect(config.pat).toBe('old-token');
  });

  it('should return empty config when file does not exist', () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    const config = readGlobalConfig();
    expect(config).toEqual({});
  });
});

describe('migrateProjectConfig (via readProjectConfig)', () => {
  it('should migrate flat org/project/repo to vendorProject', () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        org: 'my-org',
        project: 'my-project',
        repo: 'my-repo',
      })
    );

    const config = readProjectConfig('/tmp/test');
    expect(config.vendor).toBe('azure-devops');
    expect(config.vendorProject).toEqual({
      org: 'my-org',
      project: 'my-project',
      repo: 'my-repo',
    });
    expect(config.org).toBeUndefined();
    expect(config.project).toBeUndefined();
    expect(config.repo).toBeUndefined();
  });

  it('should migrate partial fields (only org)', () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ org: 'just-org' }));

    const config = readProjectConfig('/tmp/test');
    expect(config.vendor).toBe('azure-devops');
    expect(config.vendorProject).toEqual({ org: 'just-org' });
  });

  it('should not migrate when vendorProject already exists', () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        vendor: 'github',
        vendorProject: { owner: 'me', repo: 'my-repo' },
      })
    );

    const config = readProjectConfig('/tmp/test');
    expect(config.vendor).toBe('github');
    expect(config.vendorProject).toEqual({ owner: 'me', repo: 'my-repo' });
  });
});

describe('readConfig', () => {
  it('should merge global vendorAuth with project vendorProject', () => {
    // Global config
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        vendorAuth: { 'azure-devops': { pat: 'token123' } },
        prPollInterval: 30000,
        aiCommand: 'claude',
      })
    );
    // Project config
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        vendor: 'azure-devops',
        vendorProject: { org: 'myorg', project: 'myproj', repo: 'myrepo' },
        email: 'user@example.com',
      })
    );

    const config = readConfig('/tmp/test');
    expect(config).toEqual({
      email: 'user@example.com',
      prPollInterval: 30000,
      aiCommand: 'claude',
      vendor: 'azure-devops',
      vendorAuth: { pat: 'token123' },
      vendorProject: { org: 'myorg', project: 'myproj', repo: 'myrepo' },
      autoDeleteOnMerge: undefined,
      autoRebase: undefined,
      mergePollInterval: undefined,
    });
  });

  it('should return empty vendorAuth when vendor has no auth entry', () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ vendorAuth: { github: { token: 'gh' } } })
    );
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ vendor: 'azure-devops', vendorProject: {} })
    );

    const config = readConfig('/tmp/test');
    expect(config.vendorAuth).toEqual({});
  });

  it('should return empty vendorAuth when no vendor is set', () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({}));
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({}));

    const config = readConfig('/tmp/test');
    expect(config.vendorAuth).toEqual({});
    expect(config.vendorProject).toEqual({});
  });
});

describe('isVcsConfigured', () => {
  it('should return false for null provider', () => {
    const config: AppConfig = {
      vendorAuth: {},
      vendorProject: {},
    };
    expect(isVcsConfigured(config, null)).toBe(false);
  });

  it('should delegate to provider.isConfigured', () => {
    const mockProvider: VcsProvider = {
      id: 'test',
      displayName: 'Test',
      authFields: [],
      projectFields: [],
      parseRemoteUrl: () => null,
      isConfigured: vi.fn(() => true),
      matchesUser: () => false,
      fetchPullRequests: async () => ({}),
      getPullRequestUrl: () => '',
    };

    const config: AppConfig = {
      vendorAuth: { pat: 'token' },
      vendorProject: { org: 'org' },
    };

    expect(isVcsConfigured(config, mockProvider)).toBe(true);
    expect(mockProvider.isConfigured).toHaveBeenCalledWith(
      { pat: 'token' },
      { org: 'org' }
    );
  });

  it('should return false when provider says not configured', () => {
    const mockProvider: VcsProvider = {
      id: 'test',
      displayName: 'Test',
      authFields: [],
      projectFields: [],
      parseRemoteUrl: () => null,
      isConfigured: vi.fn(() => false),
      matchesUser: () => false,
      fetchPullRequests: async () => ({}),
      getPullRequestUrl: () => '',
    };

    const config: AppConfig = {
      vendorAuth: {},
      vendorProject: {},
    };

    expect(isVcsConfigured(config, mockProvider)).toBe(false);
  });
});

describe('autoDetectProjectConfig', () => {
  it('should detect vendor from git remote URL', () => {
    // readProjectConfig call (returns empty)
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({}));
    // git remote get-url origin
    mockExecSync.mockReturnValueOnce(
      'https://dev.azure.com/myorg/myproject/_git/myrepo\n'
    );
    // git config user.email
    mockExecSync.mockReturnValueOnce('user@example.com\n');

    const mockProvider: VcsProvider = {
      id: 'azure-devops',
      displayName: 'Azure DevOps',
      authFields: [],
      projectFields: [],
      parseRemoteUrl: vi.fn((url: string) => {
        if (url.includes('dev.azure.com')) {
          return { org: 'myorg', project: 'myproject', repo: 'myrepo' };
        }
        return null;
      }),
      isConfigured: () => false,
      matchesUser: () => false,
      fetchPullRequests: async () => ({}),
      getPullRequestUrl: () => '',
    };

    const { updated, detected } = autoDetectProjectConfig('/tmp/test', [
      mockProvider,
    ]);

    expect(updated).toBe(true);
    expect(detected.vendor).toBe('azure-devops');
    expect(detected.org).toBe('myorg');
    expect(detected.project).toBe('myproject');
    expect(detected.repo).toBe('myrepo');
    expect(detected.email).toBe('user@example.com');
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('should skip detection when vendor already configured', () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        vendor: 'github',
        vendorProject: { owner: 'me', repo: 'my-repo' },
        email: 'existing@example.com',
      })
    );

    const { updated, detected } = autoDetectProjectConfig('/tmp/test', []);

    expect(updated).toBe(false);
    expect(detected).toEqual({});
    expect(mockExecSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('should handle git remote failure gracefully', () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({}));
    // git remote fails
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('not a git repository');
    });
    // git config user.email also fails
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('no email configured');
    });

    const { updated, detected } = autoDetectProjectConfig('/tmp/test', []);

    expect(updated).toBe(false);
    expect(detected).toEqual({});
  });

  it('should detect only email when remote has no matching provider', () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({}));
    // git remote returns URL
    mockExecSync.mockReturnValueOnce('https://unknown.host/repo.git\n');
    // git config user.email
    mockExecSync.mockReturnValueOnce('test@test.com\n');

    const mockProvider: VcsProvider = {
      id: 'azure-devops',
      displayName: 'Azure DevOps',
      authFields: [],
      projectFields: [],
      parseRemoteUrl: vi.fn(() => null),
      isConfigured: () => false,
      matchesUser: () => false,
      fetchPullRequests: async () => ({}),
      getPullRequestUrl: () => '',
    };

    const { updated, detected } = autoDetectProjectConfig('/tmp/test', [
      mockProvider,
    ]);

    expect(updated).toBe(true);
    expect(detected).toEqual({ email: 'test@test.com' });
    expect(detected.vendor).toBeUndefined();
  });
});
