import { useLayoutEffect, useRef } from 'react';
const panels: HTMLElement[] = [];
const focusable =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';
export function usePanelFocus(onClose?: () => void, modal = true, enabled = true) {
  const ref = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    const previous = document.activeElement;
    panels.push(root);
    (root.querySelector<HTMLElement>(focusable) ?? root).focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (panels.at(-1) !== root) return;
      if (event.key === 'Escape' && close.current) {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== 'Tab' || !modal) return;
      const elements = [...root.querySelectorAll<HTMLElement>(focusable)].filter(
        (el) => el.getClientRects().length > 0,
      );
      if (!elements.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = elements[0],
        last = elements.at(-1)!;
      if (
        event.shiftKey &&
        (document.activeElement === first || !root.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !root.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      const index = panels.indexOf(root);
      if (index >= 0) panels.splice(index, 1);
      document.removeEventListener('keydown', keydown, true);
      if (
        (previous instanceof HTMLElement || previous instanceof SVGElement) &&
        previous.isConnected
      )
        previous.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>('nav [aria-current="page"]')
          ?.focus({ preventScroll: true });
    };
  }, [modal, enabled]);
  return ref;
}
