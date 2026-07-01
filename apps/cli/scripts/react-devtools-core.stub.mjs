// Build-time stand-in for `react-devtools-core`, wired up via the esbuild
// `alias` option in the build target. Ink only imports the real package when
// DEV=true, but bundling to a single ESM file hoists that import to the top
// level, where Node would try to resolve it at startup. Aliasing to this stub
// keeps the bundle self-contained; the no-op methods match the two calls in
// ink's devtools.js.
export default {
  initialize() {
    // intentionally empty — devtools are never connected in the bundled CLI
  },
  connectToDevTools() {
    // intentionally empty — devtools are never connected in the bundled CLI
  },
};
