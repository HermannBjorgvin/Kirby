import { test, type Page } from '@playwright/test';

/**
 * Hold for a fixed interval, with the reason recorded on the call.
 *
 * Almost every wait in this suite should be an auto-waiting assertion:
 * it is faster, and it cannot pass early against the state it was
 * supposed to wait past. These are the cases where that is not
 * available:
 *
 *  • **Proving a thing does not happen.** A toast that must never fire
 *    needs a window in which to not fire.
 *  • **Outlasting a debounce.** Until it elapses the post-change state
 *    does not exist yet, so an assertion would pass against the state
 *    before it and the test would prove nothing.
 *  • **Stability.** "still selected after the reorder" is a negative
 *    assertion wearing a positive one's clothes.
 *  • **Ink's useInput closure.** The handler captures its filter at
 *    render, so a key sent in the same React tick as the state change
 *    is dispatched against the stale closure and dropped. There is no
 *    DOM signal for "the re-render happened" — the frame is identical.
 *
 * The reason becomes a test step, so a trace of a flaky run says what
 * the pause was for. Keeping the rule exception in one file is what
 * keeps the list of real fixed waits auditable.
 */
export async function settleFor(
  page: Page,
  ms: number,
  reason: string
): Promise<void> {
  await test.step(`settle ${ms}ms — ${reason}`, async () => {
    await page.waitForTimeout(ms);
  });
}
