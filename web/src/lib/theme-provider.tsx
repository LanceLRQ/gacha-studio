import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * 主题偏好——界面设计方向 §3.3「浅色优先，深色完整可切，两套主题从第一天
 * 就同等对待」。三态：浅色 / 深色 / 跟随系统，与 settings.html 的
 * segmented control 一一对应。
 */
export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "gacha-studio:theme";

interface ThemeContextValue {
  /** 用户的显式偏好，包含 "system"。 */
  preference: ThemePreference;
  /** 偏好解析后实际生效的模式，"system" 会被解析成 light/dark 之一。 */
  resolved: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemIsDark, setSystemIsDark] = useState(systemPrefersDark);

  // 仅在偏好为 "system" 时才需要跟随系统变化实时更新，否则不必挂监听。
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [preference]);

  const resolved: "light" | "dark" = preference === "system" ? (systemIsDark ? "dark" : "light") : preference;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return ctx;
}
