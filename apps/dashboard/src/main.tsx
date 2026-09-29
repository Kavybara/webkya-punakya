import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/base/ErrorBoundary";
// Tokens first: the feature stylesheets are imported by the shells, which load
// after this module, and a component must never find a colour undefined.
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
