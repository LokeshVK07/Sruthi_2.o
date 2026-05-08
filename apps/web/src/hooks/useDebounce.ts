import { useEffect, useState } from "react";

/**
 * Returns `value` after it has remained unchanged for `delayMs` milliseconds.
 *
 * Use this to keep an input snappy while debouncing the heavy work (search
 * filtering, API calls) that follows from the input's value. The visible
 * `value` updates instantly because the caller still passes it straight to the
 * `<input>`; only the *debounced* version drives effects/queries.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
