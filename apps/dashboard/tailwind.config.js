/** @type {import('tailwindcss').Config} */

// The palette lives in `src/styles/tokens.css`, which is the single source for
// both themes. This config only gives those custom properties short names so
// they read like utilities -- `bg-surface` rather than `bg-[var(--surface)]`.
//
// Declared as `var(...)` rather than as literal hex, so a class written once
// follows the theme of whatever it lands in. The cost is that Tailwind's
// opacity modifier does not work on these (`bg-surface/50` is a no-op); a
// translucent surface is spelled `bg-surface-glass`, or a `color-mix` against
// the token, which is what the stylesheets already do.
//
// The dark roots stay the four existing class names rather than one
// `.kavya-dark`: adding a class to every shell is a change to the markup, and
// this commit's promise is that nothing moves.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      // The type scale is tokens (see styles/tokens.css), so a page asks for
      // `text-display` rather than re-deriving a clamp() of its own. The site
      // had no type layer at all before this, which is why every size used to
      // be a hand-written clamp() in whichever stylesheet happened to need one.
      fontSize: {
        hero: "var(--text-hero)",
        display: "var(--text-display)",
        title: "var(--text-title)",
        lede: "var(--text-lede)",
        small: "var(--text-small)",
        label: "var(--text-label)",
      },
      letterSpacing: {
        tight: "var(--tracking-tight)",
        normal: "var(--tracking-normal)",
        wide: "var(--tracking-wide)",
        label: "var(--tracking-label)",
      },
      colors: {
        canvas: "var(--bg-canvas)",
        raised: "var(--bg-raised)",
        surface: "var(--surface)",
        "surface-hover": "var(--surface-hover)",
        "surface-glass": "var(--surface-glass)",
        "surface-glass-strong": "var(--surface-glass-strong)",
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
        inverse: "var(--text-inverse)",
        "on-inverse": "var(--text-on-inverse)",
        line: "var(--border)",
        "line-strong": "var(--border-strong)",
        accent: {
          violet: "var(--accent-violet)",
          magenta: "var(--accent-magenta)",
          cyan: "var(--accent-cyan)",
        },
        success: "var(--status-success)",
        warning: "var(--status-warning)",
        danger: "var(--status-danger)",
        info: "var(--status-info)",
      },
    },
  },
  plugins: [],
};
