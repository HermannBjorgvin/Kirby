export const TEST_REPO =
  process.env.TEST_REPO ??
  'kirby-test-runner/kirby-integration-test-repository';

export function testBranchPrefix(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-${ts}-${rand}`;
}

/**
 * Where the wterm host is served. Playwright supplies `baseURL` from
 * the config; the fallback is the dev default, for a run started by
 * hand against `nx serve cli-wterm-host`.
 */
export function wtermHost(baseURL: string | undefined): string {
  return baseURL ?? 'http://localhost:5174';
}
