---
name: Ink 6.8 inset props (top/right/bottom/left) are not implemented
description: Ink 6.8.0 readme advertises top/right/bottom/left for absolute positioning, but the runtime does not implement them. Affects modal/overlay patterns.
type: reference
---

In Ink 6.8.0 (currently installed in this repo), `position="absolute"` is supported but the four inset offsets `top`/`right`/`bottom`/`left` are NOT yet implemented:

- `node_modules/ink/build/styles.d.ts` — `Styles` type only declares `position`, no inset props
- `node_modules/ink/build/components/Box.d.ts` — `Box` props omit them too
- `node_modules/ink/build/styles.js` — layout pipeline only forwards `style.position` to Yoga via `setPositionType`; no code reads or forwards offsets

The Ink readme on `master` advertises these props (lines ~970-996 of the upstream readme), but they haven't shipped to the released 6.8 runtime. Code that spreads `{...({ top: 0, left: 0 } as object)}` onto a Box is doing nothing — Ink simply ignores it.

**Practical idiom for overlays in Ink 6.8:** `position="absolute"` + `width={termCols}` + `height={termRows}` to span the viewport, then use `alignItems`/`justifyContent` to push content inside the chosen anchor. This is the pattern Modal and ToastContainer use, and it's correct _for this version_. Switch to real inset offsets when Ink ships them.

Also relevant: Ink 6.8.0 does NOT export `useWindowSize` (advertised in master readme but not in installed `index.d.ts`). The repo's `useTerminalDimensions` hook is necessary, not redundant.

How to apply: when reviewing positioning code, check the installed Ink version's `styles.d.ts` and `styles.js` before recommending readme-advertised features. Watch for misleading comments that frame missing features as "type lag."
