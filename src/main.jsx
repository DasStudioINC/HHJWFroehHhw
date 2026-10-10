import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import PrivateAccess from "./auth/PrivateAccess.jsx";
import "./App.css";

const nativeFetch = window.fetch.bind(window);

window.fetch = (input, init = {}) => {
  let requestUrl = "";

  try {
    requestUrl = new URL(
      typeof input === "string" ? input : input.url,
      window.location.href,
    ).href;
  } catch {
    // Let native fetch handle invalid request inputs.
  }

  const isAlliAgentRequest =
    requestUrl.startsWith(`${window.location.origin}/api/`) ||
    requestUrl.startsWith("https://alliaiagent.yurphagames.net/") ||
    requestUrl.startsWith("http://localhost:8081/") ||
    requestUrl.startsWith("http://127.0.0.1:8081/");

  return nativeFetch(
    input,
    isAlliAgentRequest ? { ...init, credentials: "include" } : init,
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PrivateAccess>
      <App />
    </PrivateAccess>
  </React.StrictMode>,
);
