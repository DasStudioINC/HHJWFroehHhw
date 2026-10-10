import { useCallback, useEffect, useState } from "react";
import "./PrivateAccess.css";

const API_ROOT = import.meta.env.DEV
  ? "/api"
  : "https://alliaiagent.yurphagames.net/api";

export default function PrivateAccess({ children }) {
  const [status, setStatus] = useState("checking");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const checkSession = useCallback(async () => {
    setStatus("checking");
    setError("");

    try {
      const response = await fetch(`${API_ROOT}/auth/session`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}.`);
      }

      const data = await response.json();
      setStatus(data.authenticated ? "authenticated" : "signed-out");
    } catch (err) {
      setStatus("offline");
      setError(err.message || "Could not connect to the private backend.");
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  async function submitLogin(event) {
    event.preventDefault();

    if (!password || busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API_ROOT}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || `Login failed (HTTP ${response.status}).`,
        );
      }

      setPassword("");
      await checkSession();
    } catch (err) {
      setError(err.message || "Unable to sign in.");
      setStatus("signed-out");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API_ROOT}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Logout failed (HTTP ${response.status}).`);
      }

      setPassword("");
      setStatus("signed-out");
    } catch (err) {
      setError(err.message || "Unable to sign out.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "authenticated") {
    return (
      <>
        {children}
        <button
          className="private-logout"
          type="button"
          onClick={logout}
          disabled={busy}
        >
          {busy ? "Signing out..." : "Sign out"}
        </button>
      </>
    );
  }

  return (
    <main className="private-access-page">
      <section
        className="private-access-card"
        aria-labelledby="private-access-title"
      >
        <div className="private-access-mark">A</div>
        <div className="private-access-eyebrow">
          PRIVATE INSTANCE / AUTH REQUIRED
        </div>

        <h1 id="private-access-title">AlliAgent</h1>

        <p className="private-access-description">
          This instance is private. Sign in with your owner password to
          continue.
        </p>

        {status === "checking" && (
          <div className="private-access-status">
            Checking secure session...
          </div>
        )}

        {status === "offline" && (
          <div className="private-access-error" role="alert">
            Backend connection failed. {error}
            <button
              type="button"
              className="private-access-secondary"
              onClick={checkSession}
            >
              Retry connection
            </button>
          </div>
        )}

        {status === "signed-out" && (
          <form onSubmit={submitLogin} className="private-access-form">
            <label htmlFor="owner-password">Owner password</label>

            <input
              id="owner-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your private password"
              required
              autoFocus
            />

            {error && (
              <p className="private-access-error" role="alert">
                {error}
              </p>
            )}

            <button
              className="private-access-submit"
              type="submit"
              disabled={busy || !password}
            >
              {busy ? "Verifying..." : "Unlock AlliAgent"}
            </button>

            <p className="private-access-footnote">
              No public registration · Owner access only
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
