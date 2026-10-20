/**
 * toastTimer.mjs (renderer, pure)
 * -------------------------------
 * Optional auto-close for notifications (Settings → "Automatically close
 * notifications", off by default). Only success/info messages close on their
 * own; warnings and errors always wait for the user. Each notification gets
 * its own timer, which pauses while hovered and is cancelled when the
 * notification is closed in any other way.
 */

export const AUTO_CLOSE_MS = 5000;

/** Which notification types may close by themselves. */
export function autoClosesType(type) {
  return type === 'success' || type === 'info';
}

/**
 * Start a timer for one notification.
 * @param {() => void} onExpire  remove that one notification
 * @returns {{pause: () => void, resume: () => void, cancel: () => void}}
 */
export function armAutoClose(onExpire, { ms = AUTO_CLOSE_MS, set = setTimeout, clear = clearTimeout } = {}) {
  let timer = null;
  let finished = false;
  const resume = () => {
    if (finished || timer != null) return;
    timer = set(() => {
      timer = null;
      finished = true;
      onExpire();
    }, ms);
  };
  const pause = () => {
    if (timer != null) {
      clear(timer);
      timer = null;
    }
  };
  const cancel = () => {
    finished = true;
    pause();
  };
  resume();
  return { pause, resume, cancel };
}
