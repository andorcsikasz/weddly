// Two small scroll observers for long profile pages.
//
// Both read layout from the DOM on demand and guard every browser API, because
// they also run under happy-dom in the test suite, where IntersectionObserver
// does not exist. Neither renders anything itself; a page that gets `undefined`
// or `false` from them simply shows its resting state.

import { type RefObject, useEffect, useState } from "react";

/** Which section the reader is in: the last one whose top edge has crossed the
 *  line `offset` px below the viewport top (the sticky chrome above the content).
 *  Falls back to the first id so a nav always has one tab lit. */
export function useActiveSection(ids: readonly string[], offset = 150): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const list = key ? key.split("|") : [];
    let frame = 0;

    const measure = () => {
      frame = 0;
      let current: string | null = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= offset) current = id;
      }
      // The last sections of a page can never climb to the line: the page runs
      // out first. At the very bottom the final one is the one being read.
      // (`scrollY > 0` keeps a page that fits on one screen from lighting the
      // last tab before anyone has scrolled.)
      const atBottom =
        window.scrollY > 0 &&
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom && list.length > 1) current = list[list.length - 1] ?? current;
      setActive(current);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [key, offset]);

  return active;
}

/** True once `ref`'s element has scrolled up out of the viewport (not merely
 *  been pushed below it). `resetKey` re-attaches the observer when the element
 *  is mounted later than the hook, e.g. after a page's loading skeleton. */
export function useScrolledPast(ref: RefObject<Element | null>, resetKey: unknown): boolean {
  const [past, setPast] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setPast(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, resetKey]);

  return past;
}
