export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "accuenergyMetering.theme";

export function readTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}
