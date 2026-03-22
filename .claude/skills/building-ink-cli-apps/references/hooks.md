# Ink Hooks Reference

## Table of Contents

- [useInput](#useinput)
- [usePaste](#usepaste)
- [useApp](#useapp)
- [useFocus and useFocusManager](#usefocus-and-usefocusmanager)
- [useWindowSize](#usewindowsize)
- [useBoxMetrics](#useboxmetrics)
- [useStdin](#usestdin)
- [useStdout and useStderr](#usestdout-and-usestderr)
- [useCursor](#usecursor)

---

## useInput

Primary keyboard input hook.

```tsx
useInput((input: string, key: Key) => {
  // input is the character pressed (e.g., 'a', 'q', '1')
  // key contains modifier and special key booleans
}, options?);
```

### Key object properties

All boolean:
`leftArrow`, `rightArrow`, `upArrow`, `downArrow`, `return`, `escape`,
`ctrl`, `shift`, `meta`, `tab`, `backspace`, `delete`,
`pageUp`, `pageDown`, `home`, `end`.

With kitty keyboard protocol (v6): `super`, `hyper`, `capsLock`, `numLock`,
`eventType` (`'press' | 'repeat' | 'release'`).

### Options

```tsx
useInput(handler, {
  isActive: boolean, // default: true — set false to disable this handler
});
```

### Common patterns

```tsx
// Navigation with vi-style keys
useInput((input, key) => {
  if (key.upArrow || input === 'k') moveUp();
  if (key.downArrow || input === 'j') moveDown();
  if (key.return) select();
  if (input === 'q' || key.escape) exit();
});

// Routing input between components
function TabPanel({ isActive }: { isActive: boolean }) {
  useInput(
    (input, key) => {
      if (key.return) handleSelect();
    },
    { isActive }
  ); // only receives input when active
}
```

---

## usePaste

Handles pasted text via bracketed paste mode. Pasted content is NOT forwarded to `useInput`.

```tsx
usePaste((text: string) => {
  setContent(prev => prev + text);
}, options?);
```

Options: `{isActive: boolean}` — same as useInput.

---

## useApp

Returns app control functions.

```tsx
const { exit } = useApp();

// Clean exit
exit();

// Exit with error (rejects waitUntilExit)
exit(new Error('Something went wrong'));

// Exit with value (resolves waitUntilExit with value)
exit({ result: 'success' });
```

Also returns `waitUntilRenderFlush()` which resolves after pending output is flushed.

Always use `exit()` instead of `process.exit()` — it allows Ink to clean up (restore cursor, raw mode, alternate screen).

---

## useFocus and useFocusManager

### useFocus

Makes a component focusable. Tab cycles forward, Shift+Tab cycles backward.

```tsx
const { isFocused } = useFocus({
  autoFocus: boolean, // focus on mount
  isActive: boolean, // participate in focus cycle
  id: string, // for programmatic focus
});

return (
  <Box
    borderStyle={isFocused ? 'bold' : 'single'}
    borderColor={isFocused ? 'blue' : undefined}
  >
    <Text>{isFocused ? '▶ ' : '  '}Option A</Text>
  </Box>
);
```

### useFocusManager

Programmatic focus control.

```tsx
const { focusNext, focusPrevious, focus, enableFocus, disableFocus, activeId } =
  useFocusManager();

// Focus a specific component by id
focus('search-input');

// Disable focus system entirely (e.g., during a modal)
disableFocus();
enableFocus();
```

### Multi-component focus example

```tsx
function FocusableItem({ label, id }: { label: string; id: string }) {
  const { isFocused } = useFocus({ id });
  return (
    <Box>
      <Text color={isFocused ? 'blue' : undefined} bold={isFocused}>
        {isFocused ? '❯ ' : '  '}
        {label}
      </Text>
    </Box>
  );
}

function Menu() {
  return (
    <Box flexDirection="column">
      <FocusableItem id="new" label="New Project" />
      <FocusableItem id="open" label="Open Project" />
      <FocusableItem id="settings" label="Settings" />
    </Box>
  );
}
```

---

## useWindowSize

Returns terminal dimensions. Re-renders on resize.

```tsx
const { columns, rows } = useWindowSize();

return (
  <Box width={columns} height={rows} flexDirection="column">
    <Box>
      <Text bold>Header</Text>
    </Box>
    <Box flexGrow={1}>
      <Text>Content fills remaining space</Text>
    </Box>
    <Box>
      <Text dimColor>
        Footer — {columns}x{rows}
      </Text>
    </Box>
  </Box>
);
```

---

## useBoxMetrics

Reactive layout metrics for a Box element. Returns `{width, height, left, top, hasMeasured}`.

```tsx
import { useRef } from 'react';
import { Box, Text, useBoxMetrics } from 'ink';

function MeasuredBox() {
  const ref = useRef(null);
  const { width, height, hasMeasured } = useBoxMetrics(ref);

  return (
    <Box ref={ref} borderStyle="single" padding={1}>
      <Text>{hasMeasured ? `${width}x${height} chars` : 'Measuring...'}</Text>
    </Box>
  );
}
```

Replaces the older imperative `measureElement(ref)` function (which still works but returns `{width: 0, height: 0}` during render — must be called from useEffect).

---

## useStdin

Access raw stdin stream.

```tsx
const { stdin, isRawModeSupported, setRawMode } = useStdin();
```

- Always use Ink's `setRawMode()`, never `process.stdin.setRawMode()`.
- Check `isRawModeSupported` before enabling raw mode — it's false in CI/piped mode.
- In most cases, prefer `useInput` over raw stdin access.

---

## useStdout and useStderr

Safe output above the dynamic UI area.

```tsx
const { write } = useStdout();

// Output text above Ink's UI without corruption
write('Debug: processing file.txt\n');
```

Similar to `<Static>` but for string-only output. Use `<Static>` for structured React output, `write()` for quick debug strings.

`useStderr()` has the same API but writes to stderr.

---

## useCursor

Position the terminal cursor after each render. Essential for IME (Input Method Editor) support.

```tsx
const { setCursorPosition } = useCursor();

// Place cursor at a specific position
setCursorPosition({ x: 10, y: 3 });

// Hide cursor
setCursorPosition(undefined);
```
