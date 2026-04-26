// Tunable thresholds for the sidebar agent-activity indicator.
// A session counts as "active" when its PTY has emitted a string of at
// least MIN_DATA_BYTES code units within the last ACTIVITY_IDLE_MS —
// except during INPUT_ECHO_MS after a keystroke we sent, when the
// output is almost certainly the terminal echoing user input back.
export const ACTIVITY_IDLE_MS = 2000;
export const MIN_DATA_BYTES = 4;
// 50ms is tight: anything the PTY echoes slightly slower (slow apps,
// priming on first keystroke) will be miscounted as agent output and
// produce a brief spurious "active" flicker. Bump to 80–100ms if that
// turns out to be a problem in the wild.
export const INPUT_ECHO_MS = 50;

// "Needs attention" flashing: a session that produced output for at
// least MIN_ACTIVE_MS and then went idle without the user looking at
// it flashes its title between gray and white at FLASH_INTERVAL_MS.
export const MIN_ACTIVE_MS = 3000;
export const FLASH_INTERVAL_MS = 700;
