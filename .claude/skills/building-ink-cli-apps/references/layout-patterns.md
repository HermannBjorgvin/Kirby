# Ink Layout Patterns Reference

## Table of Contents

- [Flexbox mental model](#flexbox-mental-model)
- [Common layouts](#common-layouts)
- [Scrolling](#scrolling)
- [Full-screen apps](#full-screen-apps)
- [Responsive design](#responsive-design)
- [Borders and panels](#borders-and-panels)
- [Performance patterns](#performance-patterns)

---

## Flexbox mental model

Every Ink element is `display: flex`. There is no block, inline, or grid.

Key differences from CSS flexbox:

- **No `order` property** — source order only
- **No `z-index`** — paint order follows source order
- **No CSS cascade or inheritance** — each element's style is self-contained
- **`alignContent` defaults to `flex-start`** (CSS defaults to `stretch`)
- **`flexDirection` defaults to `row`** in current Ink versions

Units: width/minWidth use character columns, height/minHeight use terminal lines.

---

## Common layouts

### Horizontal row with gap

```tsx
<Box flexDirection="row" gap={2}>
  <Text color="green">✓</Text>
  <Text>Build succeeded</Text>
  <Text dimColor>(42ms)</Text>
</Box>
```

### Vertical stack

```tsx
<Box flexDirection="column" gap={1}>
  <Text bold>Options:</Text>
  <Text> 1. New project</Text>
  <Text> 2. Open existing</Text>
  <Text> 3. Settings</Text>
</Box>
```

### Header / content / footer

```tsx
<Box flexDirection="column" height={rows}>
  <Box paddingX={1}>
    <Text bold inverse>
      {' '}
      MY CLI{' '}
    </Text>
  </Box>

  <Box flexGrow={1} flexDirection="column" overflow="hidden">
    {/* Main content fills remaining space */}
  </Box>

  <Box
    paddingX={1}
    borderStyle="single"
    borderTop
    borderBottom={false}
    borderLeft={false}
    borderRight={false}
  >
    <Text dimColor>Press q to quit</Text>
    <Spacer />
    <Text dimColor>v1.0.0</Text>
  </Box>
</Box>
```

### Sidebar + main content

```tsx
<Box flexDirection="row" height={rows}>
  <Box
    width={25}
    flexDirection="column"
    borderStyle="single"
    borderRight
    borderTop={false}
    borderBottom={false}
    borderLeft={false}
  >
    <Text bold> Navigation</Text>
    {navItems.map((item) => (
      <Text key={item.id}>
        {item === active ? '❯ ' : '  '}
        {item.label}
      </Text>
    ))}
  </Box>
  <Box flexGrow={1} flexDirection="column" paddingX={1}>
    <Text>{activeContent}</Text>
  </Box>
</Box>
```

### Centered content

```tsx
<Box alignItems="center" justifyContent="center" width="100%" height={rows}>
  <Box flexDirection="column" alignItems="center" gap={1}>
    <Text bold>Welcome</Text>
    <Text dimColor>Press Enter to continue</Text>
  </Box>
</Box>
```

### Two-column layout with equal widths

```tsx
<Box flexDirection="row" width="100%">
  <Box flexGrow={1} flexBasis={0}>
    <Text>Left column</Text>
  </Box>
  <Box flexGrow={1} flexBasis={0}>
    <Text>Right column</Text>
  </Box>
</Box>
```

### Status bar (pushed to bottom)

```tsx
<Box flexDirection="column" height={rows}>
  <Box flexGrow={1}>{/* content */}</Box>
  <Box>
    <Text inverse bold>
      {' '}
      INSERT{' '}
    </Text>
    <Text> </Text>
    <Text>file.txt</Text>
    <Spacer />
    <Text dimColor>Ln 42, Col 8</Text>
  </Box>
</Box>
```

---

## Scrolling

Ink has no built-in scroll view. Implement windowing manually.

### Basic scroll with cursor tracking

```tsx
function ScrollableList({
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
    if (key.pageUp) setCursor((c) => Math.max(0, c - height));
    if (key.pageDown) setCursor((c) => Math.min(items.length - 1, c + height));
    if (key.home) setCursor(0);
    if (key.end) setCursor(items.length - 1);
  });

  // Keep cursor centered in viewport
  const halfHeight = Math.floor(height / 2);
  const start = Math.max(
    0,
    Math.min(cursor - halfHeight, items.length - height)
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

### Scroll indicator

```tsx
function ScrollIndicator({ total, visible, offset, height }: Props) {
  const thumbSize = Math.max(1, Math.round((visible / total) * height));
  const thumbPos = Math.round(
    (offset / Math.max(1, total - visible)) * (height - thumbSize)
  );

  return (
    <Box flexDirection="column" width={1}>
      {Array.from({ length: height }, (_, i) => (
        <Text
          key={i}
          color={i >= thumbPos && i < thumbPos + thumbSize ? 'blue' : 'gray'}
        >
          {i >= thumbPos && i < thumbPos + thumbSize ? '█' : '░'}
        </Text>
      ))}
    </Box>
  );
}
```

### Text scrolling (for long text blocks)

```tsx
function ScrollableText({
  text,
  height = 15,
}: {
  text: string;
  height?: number;
}) {
  const lines = text.split('\n');
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, lines.length - height);

  useInput((_, key) => {
    if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
    if (key.downArrow) setOffset((o) => Math.min(maxOffset, o + 1));
  });

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {lines.slice(offset, offset + height).map((line, i) => (
        <Text key={offset + i}>{line}</Text>
      ))}
    </Box>
  );
}
```

---

## Full-screen apps

Use the alternate screen buffer for vim-like full-screen apps.

```tsx
const instance = render(<App />, {
  alternateScreen: true, // original terminal content restored on exit
  exitOnCtrlC: true,
});
```

Combine with `useWindowSize()` to fill the terminal:

```tsx
function FullScreenApp() {
  const { columns, rows } = useWindowSize();

  return (
    <Box width={columns} height={rows} flexDirection="column">
      <Box>
        <Text bold inverse>
          {' '}
          FULL SCREEN APP{' '}
        </Text>
        <Spacer />
        <Text inverse> v1.0 </Text>
      </Box>
      <Box flexGrow={1} overflow="hidden">
        {/* main content */}
      </Box>
      <Box>
        <Text dimColor>q: quit | ↑↓: navigate | enter: select</Text>
      </Box>
    </Box>
  );
}
```

Notes:

- `alternateScreen` only works in interactive mode (ignored in CI).
- Scrollback is unavailable — the user can't scroll up to see previous output.
- The original terminal content is restored when the app exits.
- Always provide a visible way to exit (display keybinding hint).

---

## Responsive design

Use `useWindowSize()` to adapt layout to terminal size.

```tsx
function ResponsiveLayout() {
  const { columns } = useWindowSize();
  const isWide = columns >= 80;

  return isWide ? (
    <Box flexDirection="row">
      <Box width={30}>
        <Sidebar />
      </Box>
      <Box flexGrow={1}>
        <MainContent />
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column">
      <MainContent />
    </Box>
  );
}
```

### Percentage-based widths

```tsx
<Box flexDirection="row">
  <Box width="30%">
    <Text>Sidebar</Text>
  </Box>
  <Box width="70%">
    <Text>Content</Text>
  </Box>
</Box>
```

---

## Borders and panels

### Labeled panel

```tsx
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold color="blue">
        {title}
      </Text>
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
}
```

### Dashboard grid

```tsx
<Box flexDirection="column" gap={1}>
  <Box flexDirection="row" gap={1}>
    <Box flexGrow={1} borderStyle="single" paddingX={1}>
      <Text bold>CPU: </Text>
      <Text color="green">42%</Text>
    </Box>
    <Box flexGrow={1} borderStyle="single" paddingX={1}>
      <Text bold>MEM: </Text>
      <Text color="yellow">68%</Text>
    </Box>
  </Box>
  <Box borderStyle="single" paddingX={1} flexGrow={1}>
    <Text>Logs...</Text>
  </Box>
</Box>
```

---

## Performance patterns

### Use Static for growing output

```tsx
// ❌ BAD — unbounded state array, everything re-renders
const [logs, setLogs] = useState<string[]>([]);
// ...
<Box flexDirection="column">
  {logs.map((log, i) => <Text key={i}>{log}</Text>)}
</Box>

// ✅ GOOD — items render once and are freed
<Static items={logs}>
  {(log) => <Text key={log.id}>{log.text}</Text>}
</Static>
```

### Throttle high-frequency updates

```tsx
// Use the maxFps render option to cap frame rate
render(<App />, { maxFps: 15 }); // 15fps for less critical UIs

// Enable incremental rendering to only repaint changed lines
render(<App />, { incrementalRendering: true });
```

### Colocate state

Keep state in the component that needs it. Avoid lifting rapidly-changing state (e.g., cursor position, input text) higher than necessary.

### React.memo for expensive subtrees

```tsx
const ExpensiveList = React.memo(function ExpensiveList({
  items,
}: {
  items: Item[];
}) {
  return (
    <Box flexDirection="column">
      {items.map((item) => (
        <Text key={item.id}>{item.name}</Text>
      ))}
    </Box>
  );
});
```
