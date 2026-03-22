---
name: building-ink-cli-apps
description: >
  Build interactive command-line applications using Ink (React for the terminal)
  and TypeScript. Use this skill whenever the user wants to create, modify, or
  debug a CLI tool built with Ink, or when they mention terminal UI, CLI
  components, ink, ink-ui, React CLI, terminal rendering, or building
  interactive command-line interfaces. Also trigger when the user works with
  TUI (terminal user interface) development, terminal layouts, or asks about
  keyboard input handling in Node.js CLI apps.
---

# Building CLI Apps with Ink

Ink is a custom React renderer targeting the terminal via Facebook's Yoga layout engine. Every `<Box>` is a flex container — there is no `display: block`. All standard React features work: hooks, context, Suspense, concurrent rendering.

**Current version:** Ink 6.x (ESM-only, requires `"type": "module"` in package.json)

## Quick reference

| Need                                   | Reference                                                      |
| -------------------------------------- | -------------------------------------------------------------- |
| Box/Text props, all components         | [references/components.md](references/components.md)           |
| Hooks API (useInput, useFocus, etc.)   | [references/hooks.md](references/hooks.md)                     |
| Layout recipes, scrolling, full-screen | [references/layout-patterns.md](references/layout-patterns.md) |
| @inkjs/ui, ecosystem packages, testing | [references/ecosystem.md](references/ecosystem.md)             |

Read the relevant reference before writing component code.

## Critical rules

1. **All text must be inside `<Text>`** — bare strings in `<Box>` throw errors.
2. **`<Box>` cannot appear inside `<Text>`** — only nested `<Text>` for inline styling.
3. **Ink is ESM-only** — use `import`, set `"type": "module"` in package.json.
4. **Every element is `display: flex`** — no block, inline, or grid. Think flexbox for everything.
5. **No DOM APIs** — no `document`, `window`, `onClick`, `onMouseOver`. Input comes from `useInput`.
6. **`console.log` corrupts output** — leave `patchConsole: true` (default) or use `useStdout().write()`.
7. **Use `<Static>` for log-like output** — items render once and never re-render. Only one `<Static>` per tree.
8. **CI auto-detects as non-interactive** — only the final frame renders. Check `isRawModeSupported` before `useInput`.

## Project setup

```bash
npx create-ink-app --typescript my-cli
```

Minimal app:

```tsx
import React from 'react';
import { render, Text } from 'ink';

function App() {
  return <Text color="green">Hello, terminal</Text>;
}

render(<App />);
```

The `render()` function returns `{rerender, unmount, waitUntilExit, clear}`. Call `waitUntilExit()` to keep the process alive for interactive apps.

## Component decision guide

**Layout container** → `<Box>` (all flexbox props, borders, padding, margin, gap)
**Any text content** → `<Text>` (color, bold, italic, underline, dimColor, wrap/truncation)
**Push siblings apart** → `<Spacer />` (equivalent to `<Box flexGrow={1}>`)
**Permanent log output** → `<Static items={array}>` (write once, never re-render)
**String transformation** → `<Transform transform={fn}>` (must not change dimensions)
**Line breaks** → `<Newline count={n}>` (must be inside `<Text>`)

## Hook decision guide

| Need                 | Hook                                                     |
| -------------------- | -------------------------------------------------------- |
| Keyboard input       | `useInput(handler, {isActive})`                          |
| Exit the app         | `useApp().exit()`                                        |
| Focus management     | `useFocus({autoFocus, id})` + `useFocusManager()`        |
| Terminal dimensions  | `useWindowSize()` → `{columns, rows}`                    |
| Element measurements | `useBoxMetrics(ref)` → `{width, height}`                 |
| Safe logging         | `useStdout().write(str)`                                 |
| Raw stdin access     | `useStdin()` → `{stdin, setRawMode, isRawModeSupported}` |
| Paste handling       | `usePaste(handler)`                                      |
| Cursor positioning   | `useCursor()` → `setCursorPosition({x, y})`              |

## Keyboard input pattern

```tsx
import { useInput, useApp } from 'ink';

function MyComponent() {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'q') exit();
    if (key.return) handleSubmit();
    if (key.upArrow) moveUp();
    if (key.downArrow) moveDown();
    if (key.escape) cancel();
    if (key.ctrl && input === 'c') exit();
  });

  return <Text>Press q to quit</Text>;
}
```

The `key` object has booleans: `leftArrow`, `rightArrow`, `upArrow`, `downArrow`, `return`, `escape`, `ctrl`, `shift`, `meta`, `tab`, `backspace`, `delete`, `pageUp`, `pageDown`, `home`, `end`.

Pass `{isActive: false}` to disable input — essential when routing between multiple interactive components.

## State management

Use standard React state. Ink has no special state system.

**Local state** → `useState`, `useReducer`
**Shared state** → React Context, Zustand (both work in Ink)
**Async data** → `useEffect` + state, or any React data-fetching pattern

## Render options

```tsx
const instance = render(<App />, {
  exitOnCtrlC: true, // default: true (raw mode ignores Ctrl+C otherwise)
  patchConsole: true, // default: true (intercepts console.* above UI)
  maxFps: 30, // default: 30
  incrementalRendering: false, // default: false (only repaint changed lines)
  alternateScreen: false, // default: false (vim-like full screen)
  concurrent: false, // default: false (React concurrent mode)
});

await instance.waitUntilExit();
```

## Architecture pattern for CLI tools

Separate argument parsing from UI rendering:

```tsx
// cli.tsx — entry point
import { Command } from 'commander';
import { render } from 'ink';
import { App } from './app.js';

const program = new Command();
program.option('-n, --name <name>', 'user name');
program.parse();

render(<App name={program.opts().name} />);
```

```tsx
// app.tsx — pure React, no process concerns
import { Box, Text } from 'ink';

interface AppProps {
  name?: string;
}

export function App({ name }: AppProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Welcome, {name ?? 'stranger'}</Text>
    </Box>
  );
}
```

## Common patterns

### Spinner with status

```tsx
import { Text, Box } from 'ink';
import { Spinner } from '@inkjs/ui';

function Loading({ task }: { task: string }) {
  return (
    <Box gap={1}>
      <Spinner />
      <Text>{task}...</Text>
    </Box>
  );
}
```

### Scrollable list (manual windowing)

```tsx
function ScrollList({
  items,
  height = 10,
}: {
  items: string[];
  height?: number;
}) {
  const [cursor, setCursor] = useState(0);

  useInput((_, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(items.length - 1, c + 1));
  });

  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(height / 2), items.length - height)
  );
  const visible = items.slice(start, start + height);

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {visible.map((item, i) => {
        const idx = start + i;
        return (
          <Text key={idx} inverse={idx === cursor}>
            {idx === cursor ? '❯ ' : '  '}
            {item}
          </Text>
        );
      })}
    </Box>
  );
}
```

### Build log with Static

```tsx
function BuildOutput({ completedSteps, currentStep }: Props) {
  return (
    <Box flexDirection="column">
      <Static items={completedSteps}>
        {(step) => (
          <Text key={step.id} color="green">
            ✓ {step.name}
          </Text>
        )}
      </Static>
      <Box gap={1}>
        <Spinner />
        <Text>{currentStep}</Text>
      </Box>
    </Box>
  );
}
```

### Confirmation prompt

```tsx
import { ConfirmInput } from '@inkjs/ui';

function DeletePrompt({ onConfirm }: { onConfirm: () => void }) {
  return (
    <Box flexDirection="column">
      <Text bold color="red">
        Delete all files?
      </Text>
      <ConfirmInput
        defaultChoice="cancel"
        onConfirm={onConfirm}
        onCancel={() => process.exit(0)}
      />
    </Box>
  );
}
```

## Pitfalls checklist

Before shipping, verify:

- [ ] `"type": "module"` in package.json
- [ ] All text wrapped in `<Text>` (no bare strings in `<Box>`)
- [ ] No `<Box>` inside `<Text>`
- [ ] `useInput` guarded with `{isActive}` when multiple interactive components exist
- [ ] `useEffect` cleanup for all timers/intervals/listeners
- [ ] Growing output uses `<Static>`, not unbounded state arrays
- [ ] CI/piped mode handled — check `isRawModeSupported` before interactive features
- [ ] `exit()` called from `useApp()`, not `process.exit()` (allows cleanup)
- [ ] No `console.log` with `patchConsole: false`
