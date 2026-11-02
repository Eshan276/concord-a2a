import { useState } from "react";

const KEY = "concord.theme";
export type Theme = "dark" | "light";

export function initTheme() {
  const t = (localStorage.getItem(KEY) as Theme | null) ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.dataset.theme = t;
}

export function ThemeToggle() {
  const [t, setT] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) ?? "dark");
  const flip = () => {
    const next: Theme = t === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(KEY, next);
    setT(next);
  };
  return (
    <button className="theme-toggle" onClick={flip} title={t === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label="Toggle colour theme">
      {t === "dark" ? "☀" : "☾"}
    </button>
  );
}
