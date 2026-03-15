export const TEST_REPO =
  process.env.TEST_REPO ??
  'kirby-test-runner/kirby-integration-test-repository';

export function testBranchPrefix(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-${ts}-${rand}`;
}
