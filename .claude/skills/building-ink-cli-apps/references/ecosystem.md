# Ink Ecosystem Reference

## Table of Contents

- [@inkjs/ui — official component library](#inkjsui--official-component-library)
- [Legacy standalone packages](#legacy-standalone-packages)
- [Testing with ink-testing-library](#testing-with-ink-testing-library)
- [CLI framework integration](#cli-framework-integration)
- [Useful companion libraries](#useful-companion-libraries)

---

## @inkjs/ui — official component library

`npm install @inkjs/ui` — the recommended UI library for new projects. Replaces most standalone ink-\* packages with a unified, themed component set.

### Input components

**TextInput** — uncontrolled text input with optional autocomplete:

```tsx
import { TextInput } from '@inkjs/ui';

<TextInput
  placeholder="Search..."
  suggestions={['react', 'react-native', 'redux']}
  onChange={(value) => setQuery(value)}
  onSubmit={(value) => handleSearch(value)}
/>;
```

Props: `placeholder`, `defaultValue`, `suggestions` (string[]), `isDisabled`, `onChange`, `onSubmit`.

**EmailInput** — auto-completes domains after `@`:

```tsx
<EmailInput placeholder="you@example.com" onSubmit={(email) => invite(email)} />
```

**PasswordInput** — displays asterisks:

```tsx
<PasswordInput
  placeholder="Enter password"
  onSubmit={(pw) => authenticate(pw)}
/>
```

**ConfirmInput** — Y/n confirmation:

```tsx
<ConfirmInput
  defaultChoice="cancel"
  submitOnEnter
  onConfirm={() => deleteAll()}
  onCancel={() => exit()}
/>
```

Props: `defaultChoice` (`'confirm' | 'cancel'`), `submitOnEnter`, `onConfirm`, `onCancel`.

**Select** — scrollable single-select list:

```tsx
<Select
  options={[
    { label: 'TypeScript', value: 'ts' },
    { label: 'JavaScript', value: 'js' },
    { label: 'Python', value: 'py' },
  ]}
  onChange={(value) => setLanguage(value)}
  visibleOptionCount={5}
/>
```

Props: `options` ({label, value}[]), `defaultValue`, `onChange`, `visibleOptionCount`, `isDisabled`.

**MultiSelect** — Space to toggle, Enter to submit:

```tsx
<MultiSelect
  options={[
    { label: 'ESLint', value: 'eslint' },
    { label: 'Prettier', value: 'prettier' },
    { label: 'TypeScript', value: 'typescript' },
  ]}
  defaultValue={['prettier']}
  onChange={(values) => setTools(values)}
/>
```

### Feedback components

**Spinner** — animated spinner:

```tsx
<Spinner label="Installing dependencies..." />
```

**ProgressBar** — progress indicator (0–100):

```tsx
<ProgressBar value={75} />
```

**Badge** — colored status badge:

```tsx
<Badge color="green">Pass</Badge>
<Badge color="red">Fail</Badge>
<Badge color="yellow">Warn</Badge>
```

**StatusMessage** — status with icon:

```tsx
<StatusMessage variant="success">Deployed to production</StatusMessage>
<StatusMessage variant="error">Build failed</StatusMessage>
<StatusMessage variant="warning">Deprecated API usage</StatusMessage>
<StatusMessage variant="info">3 updates available</StatusMessage>
```

Variants: `'success' | 'error' | 'warning' | 'info'`.

**Alert** — bordered attention box:

```tsx
<Alert variant="error">Your license has expired</Alert>
```

### List components

**UnorderedList** and **OrderedList**:

```tsx
import { UnorderedList, OrderedList } from '@inkjs/ui';

<UnorderedList>
  <UnorderedList.Item>First item</UnorderedList.Item>
  <UnorderedList.Item>
    Second item
    <UnorderedList>
      <UnorderedList.Item>Nested item</UnorderedList.Item>
    </UnorderedList>
  </UnorderedList.Item>
</UnorderedList>;
```

### Theming

All components support theming via React context:

```tsx
import { ThemeProvider, defaultTheme, extendTheme } from '@inkjs/ui';

const customTheme = extendTheme(defaultTheme, {
  components: {
    Spinner: {
      styles: {
        frame: () => ({ color: 'magenta' }),
      },
    },
    Select: {
      config: {
        indicatorComponent: ({ isSelected }) => (isSelected ? '●' : '○'),
      },
    },
  },
});

render(
  <ThemeProvider theme={customTheme}>
    <App />
  </ThemeProvider>
);
```

---

## Legacy standalone packages

These still work and are widely installed, but prefer `@inkjs/ui` for new projects.

**ink-text-input** (v6) — controlled text input:

```tsx
import TextInput from 'ink-text-input';

const [value, setValue] = useState('');
<TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />;
```

Props: `value`, `onChange`, `onSubmit`, `placeholder`, `mask` (char), `showCursor`, `highlightPastedText`. Also exports `UncontrolledTextInput`.

**ink-select-input** (v6) — select list:

```tsx
import SelectInput from 'ink-select-input';

<SelectInput
  items={[
    { label: 'Red', value: 'red' },
    { label: 'Blue', value: 'blue' },
  ]}
  onSelect={(item) => handleSelect(item.value)}
  limit={5}
/>;
```

Props: `items`, `onSelect`, `onHighlight`, `limit`, `indicatorComponent`, `itemComponent`.

**ink-spinner** (v5) — spinners from cli-spinners:

```tsx
import Spinner from 'ink-spinner';
<Text>
  <Spinner type="dots" /> Loading
</Text>;
```

Types: `dots`, `line`, `arc`, `bouncingBar`, `hamburger`, and all cli-spinners types.

**ink-table** (v3) — formatted data tables:

```tsx
import Table from 'ink-table';
<Table
  data={[
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 },
  ]}
/>;
```

**ink-link** — clickable terminal hyperlinks (OSC 8):

```tsx
import Link from 'ink-link';
<Link url="https://github.com">GitHub</Link>;
```

Works in iTerm2, Windows Terminal, GNOME Terminal.

**ink-gradient** — gradient text:

```tsx
import Gradient from 'ink-gradient';
<Gradient name="rainbow">
  <Text>Rainbow text</Text>
</Gradient>;
```

**ink-big-text** — ASCII art text:

```tsx
import BigText from 'ink-big-text';
<BigText text="CLI" font="chrome" />;
```

---

## Testing with ink-testing-library

`npm install --save-dev ink-testing-library`

Renders Ink components in a virtual terminal for testing with any test runner (Jest, Vitest, etc.).

### Basic test

```tsx
import { render } from 'ink-testing-library';
import App from './app.js';

test('renders greeting', () => {
  const { lastFrame } = render(<App name="World" />);
  expect(lastFrame()).toContain('Hello, World');
});
```

### API

`render(<Component />)` returns:

| Property           | Type       | Description                   |
| ------------------ | ---------- | ----------------------------- |
| `lastFrame()`      | `string`   | Last rendered frame as string |
| `frames`           | `string[]` | All rendered frames           |
| `rerender(tree)`   | `function` | Update rendered tree          |
| `unmount()`        | `function` | Unmount component             |
| `stdin.write(str)` | `function` | Simulate keyboard input       |

### Simulating input

```tsx
test('handles keyboard input', async () => {
  const { lastFrame, stdin } = render(<Counter />);

  expect(lastFrame()).toContain('Count: 0');

  stdin.write('\x1B[A'); // Up arrow
  await delay(100);
  expect(lastFrame()).toContain('Count: 1');

  stdin.write('q');
  await delay(100);
  expect(lastFrame()).toContain('Goodbye');
});
```

### Common key codes for stdin.write

| Key         | Code       |
| ----------- | ---------- |
| Enter       | `'\r'`     |
| Escape      | `'\x1B'`   |
| Up arrow    | `'\x1B[A'` |
| Down arrow  | `'\x1B[B'` |
| Right arrow | `'\x1B[C'` |
| Left arrow  | `'\x1B[D'` |
| Tab         | `'\t'`     |
| Backspace   | `'\x7F'`   |
| Space       | `' '`      |
| Ctrl+C      | `'\x03'`   |

### Testing rerender

```tsx
test('updates on prop change', () => {
  const { lastFrame, rerender } = render(<Greeting name="Alice" />);
  expect(lastFrame()).toContain('Alice');

  rerender(<Greeting name="Bob" />);
  expect(lastFrame()).toContain('Bob');
});
```

---

## CLI framework integration

### Commander.js

```tsx
import { Command } from 'commander';
import { render } from 'ink';
import App from './app.js';

const program = new Command();
program
  .name('my-cli')
  .version('1.0.0')
  .option('-v, --verbose', 'verbose output')
  .argument('[path]', 'target path', '.')
  .action((path, options) => {
    render(<App path={path} verbose={options.verbose} />);
  });

program.parse();
```

### Pastel (filesystem-based routing by Ink's author)

```
commands/
├── index.tsx          → my-cli
├── init.tsx           → my-cli init
├── deploy.tsx         → my-cli deploy
└── config/
    ├── get.tsx        → my-cli config get
    └── set.tsx        → my-cli config set
```

Each file exports a React component as default. Props are parsed from command-line arguments.

### meow (lightweight)

```tsx
import meow from 'meow';
import { render } from 'ink';

const cli = meow(
  `
  Usage: my-cli <name>
  Options:
    --color, -c  Set color
`,
  {
    importMeta: import.meta,
    flags: { color: { type: 'string', shortFlag: 'c' } },
  }
);

render(<App name={cli.input[0]} color={cli.flags.color} />);
```

---

## Useful companion libraries

| Library          | Purpose                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `chalk`          | Color/style strings outside of `<Text>` (Ink uses chalk internally) |
| `cli-spinners`   | Spinner animation frame data                                        |
| `figures`        | Unicode symbols with fallbacks (`✓`, `✗`, `●`, `❯`, etc.)           |
| `cli-boxes`      | Box drawing character sets                                          |
| `terminal-link`  | Detect and create clickable terminal links                          |
| `wrap-ansi`      | Word-wrap strings with ANSI escape codes                            |
| `slice-ansi`     | Slice strings with ANSI codes without breaking escapes              |
| `string-width`   | Get visual width of a string (accounts for CJK, emoji)              |
| `strip-ansi`     | Remove ANSI escape codes from strings                               |
| `supports-color` | Detect color support level                                          |
| `ansi-escapes`   | Terminal control sequences (Ink uses internally)                    |
| `fullscreen-ink` | Helper for alternate screen buffer management                       |
