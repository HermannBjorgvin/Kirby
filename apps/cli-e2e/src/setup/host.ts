// The wterm host's base URL — must match playwright.config.ts's
// derivation so tests that talk to the host directly (GET /output)
// target the same server the fixture spawned Kirby on.
const port = Number(process.env.KIRBY_E2E_PORT ?? 5174);
export const HOST = process.env.BASE_URL ?? `http://localhost:${port}`;
