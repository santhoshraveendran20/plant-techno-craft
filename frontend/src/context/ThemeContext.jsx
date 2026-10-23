import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// index.html reads the same key before first paint so the page never flashes the wrong theme
const THEME_KEY = "upi_tracker_theme";

function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(storedTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    // Receipts, labels and anything else printed always come out light on paper
    const beforePrint = () => root.classList.remove("dark");
    const afterPrint = () => root.classList.toggle("dark", theme === "dark");
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [theme]);

  const setTheme = useCallback((t) => {
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* storage unavailable (private mode) - choice lasts for this visit only */
    }
    setThemeState(t);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
