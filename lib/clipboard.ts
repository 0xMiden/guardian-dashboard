/**
 * Copying that also works when the page is not a secure context.
 *
 * `navigator.clipboard` exists only over https and on localhost, so a
 * self-hosted dashboard on plain http, or a phone pointed at the dev server by
 * LAN address, has no Clipboard API at all: in Chrome 151 such a page reports
 * `isSecureContext: false` and `navigator.clipboard: undefined`.
 * `document.execCommand` is deprecated but it is the only path left there, and
 * it has to run synchronously while the click's user gesture is still intact,
 * which is why it comes first rather than second.
 *
 * Returns whether the text actually reached the clipboard, so a caller only
 * confirms a copy that happened.
 */
export async function copyText(value: string): Promise<boolean> {
  // Selecting the scratch textarea takes focus away from whatever the user was
  // on, and removing it would drop focus to the body, sending the next Tab back
  // to the top of the page. Keyboard users copy from table rows too.
  const previous = document.activeElement as HTMLElement | null;
  const el = document.createElement("textarea");
  try {
    Object.assign(el, {
      value,
      style: "position:fixed;top:0;left:0;opacity:0;pointer-events:none",
    });
    document.body.appendChild(el);
    el.focus();
    el.select();
    if (document.execCommand("copy")) return true;
  } catch {
    // no execCommand, or the document refused the copy: fall through
  } finally {
    el.remove();
    previous?.focus?.();
  }
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // denied, or the document is not focused
    return false;
  }
}
