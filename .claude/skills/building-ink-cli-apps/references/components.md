# Ink Components Reference

## Table of Contents

- [Box](#box)
- [Text](#text)
- [Static](#static)
- [Spacer](#spacer)
- [Newline](#newline)
- [Transform](#transform)

---

## Box

The fundamental layout primitive. Every Box is a flex container — there is no `display: block`.

### Flex properties

| Prop             | Type                                                                                                         | Default        |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | -------------- |
| `flexDirection`  | `'row' \| 'column' \| 'row-reverse' \| 'column-reverse'`                                                     | `'row'`        |
| `flexGrow`       | `number`                                                                                                     | `0`            |
| `flexShrink`     | `number`                                                                                                     | `1`            |
| `flexBasis`      | `number \| string`                                                                                           | —              |
| `flexWrap`       | `'nowrap' \| 'wrap' \| 'wrap-reverse'`                                                                       | `'nowrap'`     |
| `alignItems`     | `'flex-start' \| 'center' \| 'flex-end' \| 'stretch' \| 'baseline'`                                          | —              |
| `alignSelf`      | `'auto' \| 'flex-start' \| 'center' \| 'flex-end' \| 'stretch' \| 'baseline'`                                | `'auto'`       |
| `alignContent`   | `'flex-start' \| 'flex-end' \| 'center' \| 'stretch' \| 'space-between' \| 'space-around' \| 'space-evenly'` | `'flex-start'` |
| `justifyContent` | `'flex-start' \| 'center' \| 'flex-end' \| 'space-between' \| 'space-around' \| 'space-evenly'`              | —              |

Note: `alignContent` defaults to `flex-start`, not `stretch` like CSS.

### Dimensions

| Prop          | Type               | Notes                                           |
| ------------- | ------------------ | ----------------------------------------------- |
| `width`       | `number \| string` | Characters or percentage (`"50%"`)              |
| `height`      | `number \| string` | Lines or percentage                             |
| `minWidth`    | `number`           | Numbers only — no percentages (Yoga limitation) |
| `maxWidth`    | `number`           | Numbers only                                    |
| `minHeight`   | `number \| string` | Supports percentages                            |
| `maxHeight`   | `number \| string` | Supports percentages                            |
| `aspectRatio` | `number`           | Width/height ratio (v6)                         |

### Spacing

All spacing props accept numbers (characters/lines).

| Prop                                                         | Shorthand for    |
| ------------------------------------------------------------ | ---------------- |
| `padding`                                                    | All sides        |
| `paddingX`                                                   | Left + Right     |
| `paddingY`                                                   | Top + Bottom     |
| `paddingTop`, `paddingBottom`, `paddingLeft`, `paddingRight` | Individual sides |
| `margin`                                                     | All sides        |
| `marginX`                                                    | Left + Right     |
| `marginY`                                                    | Top + Bottom     |
| `marginTop`, `marginBottom`, `marginLeft`, `marginRight`     | Individual sides |
| `gap`                                                        | Row + Column gap |
| `columnGap`                                                  | Horizontal gap   |
| `rowGap`                                                     | Vertical gap     |

### Borders

Set `borderStyle` to enable borders:

| Value            | Example |
| ---------------- | ------- |
| `'single'`       | `┌──┐`  |
| `'double'`       | `╔══╗`  |
| `'round'`        | `╭──╮`  |
| `'bold'`         | `┏━━┓`  |
| `'singleDouble'` | `╓──╖`  |
| `'doubleSingle'` | `╒══╕`  |
| `'classic'`      | `+--+`  |

Custom borders: pass an object with `topLeft`, `top`, `topRight`, `left`, `right`, `bottomLeft`, `bottom`, `bottomRight`.

Per-side control: `borderTop`, `borderRight`, `borderBottom`, `borderLeft` (booleans, default `true`).

Colors: `borderColor` (shorthand), or `borderTopColor`, `borderRightColor`, `borderBottomColor`, `borderLeftColor`. The `borderDimColor` prop (and per-side variants) dims the border.

### Position, display, overflow

| Prop              | Type                                   | Default      |
| ----------------- | -------------------------------------- | ------------ |
| `position`        | `'relative' \| 'absolute' \| 'static'` | `'relative'` |
| `display`         | `'flex' \| 'none'`                     | `'flex'`     |
| `overflow`        | `'visible' \| 'hidden'`                | `'visible'`  |
| `overflowX`       | `'visible' \| 'hidden'`                | `'visible'`  |
| `overflowY`       | `'visible' \| 'hidden'`                | `'visible'`  |
| `backgroundColor` | `string`                               | —            |

Position offsets: `top`, `right`, `bottom`, `left` (numbers).

### ARIA (v6)

`aria-label`, `aria-hidden`, `aria-role`, `aria-state` — activate with `isScreenReaderEnabled` render option or `INK_SCREEN_READER=true`.

---

## Text

All text must be in `<Text>`. Supports nesting other `<Text>` for inline styling but **cannot contain `<Box>`**.

| Prop              | Type      | Default  | Description                                                                      |
| ----------------- | --------- | -------- | -------------------------------------------------------------------------------- |
| `color`           | `string`  | —        | Named, hex (`"#005cc5"`), or RGB (`"rgb(232,131,136)"`)                          |
| `backgroundColor` | `string`  | —        | Same color values                                                                |
| `bold`            | `boolean` | `false`  | Bold weight                                                                      |
| `italic`          | `boolean` | `false`  | Italic style                                                                     |
| `underline`       | `boolean` | `false`  | Underlined                                                                       |
| `strikethrough`   | `boolean` | `false`  | Strikethrough                                                                    |
| `dimColor`        | `boolean` | `false`  | Dimmed/faded                                                                     |
| `inverse`         | `boolean` | `false`  | Swap fg/bg                                                                       |
| `wrap`            | `string`  | `'wrap'` | `'wrap'`, `'truncate'`/`'truncate-end'`, `'truncate-start'`, `'truncate-middle'` |

Inline styling example:

```tsx
<Text>
  Status:{' '}
  <Text bold color="green">
    OK
  </Text>{' '}
  — <Text dimColor>updated 5s ago</Text>
</Text>
```

---

## Static

Permanently renders output above the dynamic UI. Items write once and never re-render.

```tsx
<Static items={completedTasks}>
  {(task) => (
    <Box key={task.id}>
      <Text color="green">✓</Text>
      <Text>
        {' '}
        {task.name} ({task.duration}ms)
      </Text>
    </Box>
  )}
</Static>
```

Rules:

- Only new items appended to the array are rendered.
- Changes to previously rendered items are ignored.
- At most one `<Static>` per component tree.
- Accepts a `style` prop with Box-like layout properties.
- Use for: build logs, test results, completed downloads, any growing list.

---

## Spacer

Expands along the main axis. Equivalent to `<Box flexGrow={1}>`.

```tsx
<Box>
  <Text>Left</Text>
  <Spacer />
  <Text>Right</Text>
</Box>
```

---

## Newline

Inserts line breaks. Must be inside `<Text>`.

```tsx
<Text>
  Line one
  <Newline />
  Line two
  <Newline count={2} />
  Line five
</Text>
```

---

## Transform

Transforms string output of children before terminal write. Must not change dimensions.

```tsx
<Transform transform={(output) => output.toUpperCase()}>
  <Text>hello</Text>
</Transform>
// Renders: HELLO
```

The transform function receives one line at a time (may contain ANSI codes).
