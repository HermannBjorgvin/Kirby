import { describe, it, expect, vi } from 'vitest';
import { buildMenuTemplate } from './menu.js';

const env = (platform: NodeJS.Platform) => ({
  platform,
  isDev: false,
  theme: 'system' as const,
  appVersion: '1.0.0',
});

function labels(template: ReturnType<typeof buildMenuTemplate>): string[] {
  return template.map((m) => String(m.label ?? m.role));
}

describe('buildMenuTemplate', () => {
  it('puts the app menu first on macOS only', () => {
    expect(labels(buildMenuTemplate(env('darwin'), vi.fn()))[0]).toBe('Kirby');
    expect(labels(buildMenuTemplate(env('linux'), vi.fn()))[0]).toBe('&File');
  });

  it('routes clicks to menu commands', () => {
    const send = vi.fn();
    const template = buildMenuTemplate(env('linux'), send);
    const file = template.find((m) => m.label === '&File');
    const open = (
      file?.submenu as { label?: string; click?: () => void }[]
    ).find((i) => i.label === 'Open Repository…');
    open?.click?.();
    expect(send).toHaveBeenCalledWith('open-repo');
  });

  it('reflects the current theme in the radio group', () => {
    const template = buildMenuTemplate(
      { ...env('linux'), theme: 'dark' },
      vi.fn()
    );
    const view = template.find((m) => m.label === '&View');
    const theme = (
      view?.submenu as { label?: string; submenu?: unknown }[]
    ).find((i) => i.label === 'Theme');
    const items = theme?.submenu as { label: string; checked?: boolean }[];
    expect(items.find((i) => i.label === 'Dark')?.checked).toBe(true);
    expect(items.find((i) => i.label === 'Light')?.checked).toBe(false);
  });

  it('only exposes dev tools in dev builds', () => {
    const roles = (t: ReturnType<typeof buildMenuTemplate>) =>
      (t.find((m) => m.label === '&View')?.submenu as { role?: string }[]).map(
        (i) => i.role
      );
    expect(roles(buildMenuTemplate(env('linux'), vi.fn()))).not.toContain(
      'toggleDevTools'
    );
    expect(
      roles(buildMenuTemplate({ ...env('linux'), isDev: true }, vi.fn()))
    ).toContain('toggleDevTools');
  });
});
