// Shared warm-dark mode hook (lib/useTheme.ts): the single implementation
// behind the sun/moon toggle in PublicShell, AppShell, PlannerShell and
// VendorShell. Verifies the <html> class side effect, the localStorage
// persistence, and the per-shell default when no preference is stored.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { type Theme, useTheme } from "@/lib/useTheme";

function Probe({ fallback }: { fallback: Theme }) {
  const [theme, setTheme] = useTheme(fallback);
  return (
    <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      theme:{theme}
    </button>
  );
}

beforeEach(() => {
  window.localStorage.removeItem("weddly.theme");
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  window.localStorage.removeItem("weddly.theme");
  document.documentElement.classList.remove("dark");
});

describe("useTheme", () => {
  test("falls back to the shell default when nothing is stored", () => {
    render(<Probe fallback="dark" />);
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("weddly.theme")).toBe("dark");
  });

  test("stored preference wins over the shell default", () => {
    window.localStorage.setItem("weddly.theme", "light");
    render(<Probe fallback="dark" />);
    expect(screen.getByText("theme:light")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("toggling flips the <html> class and persists", () => {
    render(<Probe fallback="light" />);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    fireEvent.click(screen.getByText("theme:light"));
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("weddly.theme")).toBe("dark");

    fireEvent.click(screen.getByText("theme:dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("weddly.theme")).toBe("light");
  });

  test("ignores garbage stored values", () => {
    window.localStorage.setItem("weddly.theme", "solarized");
    render(<Probe fallback="light" />);
    expect(screen.getByText("theme:light")).toBeInTheDocument();
  });
});
