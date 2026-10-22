import { useEffect, useState } from "react";

/** True while the CSS media query matches (e.g. "(min-width: 768px)"). */
export function useMediaQuery(query) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : true);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Tailwind breakpoints: sm 640, md 768 (tablet), lg 1024 (tablet landscape / laptop), xl 1280. */
export const useIsTabletUp = () => useMediaQuery("(min-width: 768px)");
export const useIsPhone = () => !useMediaQuery("(min-width: 640px)");
