type ScrollLock = { count: number; overflow: string; priority: string };
const bodyLocks = new WeakMap<HTMLElement, ScrollLock>();

/** Overlapping dialogs may close in either order; only the last release restores scrolling. */
export function lockBodyScroll(body: HTMLElement = document.body): () => void {
  let lock = bodyLocks.get(body);
  if (!lock) {
    lock = {
      count: 0,
      overflow: body.style.getPropertyValue("overflow"),
      priority: body.style.getPropertyPriority("overflow")
    };
    bodyLocks.set(body, lock);
    body.style.setProperty("overflow", "hidden", lock.priority);
  }
  lock.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.count -= 1;
    if (lock.count > 0) return;
    if (lock.overflow) body.style.setProperty("overflow", lock.overflow, lock.priority);
    else body.style.removeProperty("overflow");
    bodyLocks.delete(body);
  };
}
