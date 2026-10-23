import { createContext, Fragment, useCallback, useContext, useMemo, useState } from "react";
import ta from "./ta";

// The English text is the key, so a string with no Tamil entry yet still shows (in English).
// The choice is saved per browser, like the theme.
const LANG_KEY = "upi_tracker_lang";

export const LANGUAGES = [
  { code: "en", label: "English", short: "EN" },
  { code: "ta", label: "தமிழ்", short: "த" },
];

function storedLang() {
  try {
    return localStorage.getItem(LANG_KEY) === "ta" ? "ta" : "en";
  } catch {
    return "en";
  }
}

let current = storedLang();
document.documentElement.lang = current;

const missing = new Set();

/** Translate an English UI string; {name} placeholders are filled from `vars`. */
export function t(text, vars) {
  let out = text;
  if (current === "ta") {
    out = ta[text];
    if (out === undefined) {
      out = text;
      if (import.meta.env.DEV && !missing.has(text)) {
        missing.add(text);
        console.debug(`[i18n] no Tamil for ${JSON.stringify(text)}`);
      }
    }
  }
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : out;
}

/** Like t(), but placeholders may be React elements, e.g. tx("Return change {amount}", { amount: <b>₹40</b> }). */
export function tx(text, vars) {
  return t(text)
    .split(/(\{\w+\})/)
    .map((part, i) => {
      const key = part.match(/^\{(\w+)\}$/)?.[1];
      return key && key in vars ? <Fragment key={i}>{vars[key]}</Fragment> : part;
    });
}

/** Locale for dates and month names in the current language (numbers and money stay en-IN). */
export const dateLocale = () => (current === "ta" ? "ta-IN" : "en-IN");

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(current);

  const setLang = useCallback((l) => {
    current = l; // before the re-render, so every t() call in it sees the new language
    document.documentElement.lang = l;
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* storage unavailable (private mode) - choice lasts for this visit only */
    }
    setLangState(l);
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Current language. Calling it also re-renders the component when the language changes. */
export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside LanguageProvider");
  return ctx;
}
