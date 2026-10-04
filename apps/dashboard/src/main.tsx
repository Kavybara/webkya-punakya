import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// The leaf module, not the `ui` barrel. The barrel imports `ui.css` and
// `shell.css`, and this file plus `router/index.tsx` are the eager graph --
// going through the barrel pulled all 83 kB of kit CSS into the entry chunk
// every visitor downloads before the first route resolves. Measured against
// the barrel import: 35.25 kB -> 83.00 kB (7.61 -> 14.65 kB gzipped).
// The kit CSS stays in the lazy route chunks, where it already was.
//
// The error screen styles itself from tokens, so it does not need those rules
// to be legible -- the worst case is that its button reads as plain text on the
// rare crash that happens before any route chunk has loaded.
// Tokens first: the feature stylesheets are imported by the shells, which load
// after this module, and a component must never find a colour undefined.
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import "./styles/tokens.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Last line of defence: if the router itself throws, the reader still
        gets an explanation and a way back instead of a blank white page. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
