/**
 * Git ref naming and shell-safety.
 *
 * Branch names are not always ours: they arrive from `git branch`
 * output and, for review work, from whoever opened the pull request.
 * Everything that interpolates a ref into a command string screens it
 * here first.
 */

/**
 * Characters that are legal in a git ref but dangerous once a ref is
 * interpolated into a shell command string.
 *
 * `git check-ref-format` rejects spaces, control characters, `~^:?*[`
 * and backslash — but it permits `` ` ``, `$`, quotes, `;`, `&`, `|`
 * and parentheses, all of which the shell acts on. Branch names are not
 * always ours: they arrive from `git branch` output and, for review
 * work, from whoever opened the pull request.
 *
 * The git commands in this library still build shell strings (see the
 * note on {@link assertShellSafeRef}), so every ref is screened here
 * first.
 */
const SHELL_UNSAFE_IN_REF = /[`$"'\\;&|<>()\n\r]/;

/**
 * Throw unless `ref` is safe to interpolate into a shell command.
 *
 * This is a guard, not the real fix: the commands in this library should
 * pass arguments as argv via `execFile` instead of composing strings,
 * which would make quoting irrelevant. That migration touches every
 * call site and its tests, so until then nothing reaches the shell
 * without passing through here.
 */
export function assertShellSafeRef(ref: string, what = 'branch'): void {
  if (SHELL_UNSAFE_IN_REF.test(ref)) {
    throw new Error(`Refusing to use an unsafe ${what} name: ${ref}`);
  }
}

/** Convert a git branch name to a safe session identifier (replace / with -) */
export function branchToSessionName(branch: string): string {
  return branch.replace(/\//g, '-');
}
