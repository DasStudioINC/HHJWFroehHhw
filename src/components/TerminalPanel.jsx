import { useCallback, useEffect, useRef, useState } from "react";
import "./TerminalPanel.css";

export default function TerminalPanel({ sessionId, runnerUrl, onClose }) {
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(true);
  const [error, setError] = useState("");
  const [exitCode, setExitCode] = useState(null);

  const offsetRef = useRef(0);
  const outputRef = useRef(null);
  const inputRef = useRef(null);
  const root = runnerUrl.replace(/\/+$/, "");

  const markFinished = useCallback((code = null) => {
    setRunning(false);
    setExitCode(code);
    setInput("");
  }, []);

  const stopProgram = useCallback(async () => {
    setError("");

    try {
      const response = await fetch(
        `${root}/${encodeURIComponent(sessionId)}/exit`,
        { method: "POST" },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (
          response.status === 409 &&
          /already finished|not running|has finished/i.test(
            data.error || data.message || "",
          )
        ) {
          markFinished(data.exitCode ?? null);
          return;
        }

        throw new Error(
          data.message || data.error || `Stop failed: HTTP ${response.status}`,
        );
      }

      markFinished(data.exitCode ?? null);
    } catch (err) {
      setError(err.message || "Could not stop the program.");
    }
  }, [root, sessionId, markFinished]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId;

    async function poll() {
      try {
        const response = await fetch(
          `${root}/${encodeURIComponent(sessionId)}/output?after=${offsetRef.current}`,
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (cancelled) return;

          if (
            response.status === 400 &&
            /session not found/i.test(data.error || data.message || "")
          ) {
            markFinished(null);
            setError(
              "This terminal session is no longer available. Run the code again to start a new session.",
            );
            return;
          }

          throw new Error(
            data.message ||
              data.error ||
              `Output request failed: HTTP ${response.status}`,
          );
        }

        if (cancelled) return;

        if (typeof data.output === "string" && data.output.length > 0) {
          setOutput((previous) => previous + data.output);
        }

        if (Number.isFinite(data.nextOffset)) {
          offsetRef.current = data.nextOffset;
        }

        if (data.running === false) {
          markFinished(data.exitCode ?? null);
          setError("");
          return;
        }

        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Unable to read terminal output.");
        }
      }

      if (!cancelled) {
        timeoutId = window.setTimeout(poll, 350);
      }
    }

    poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [root, sessionId, markFinished]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  async function sendInput(event) {
    event.preventDefault();

    if (!running || !input.trim()) return;

    const value = input;
    setError("");

    if (value.trim() === "/exit") {
      setOutput((previous) => `${previous}\n> /exit\n`);
      setInput("");
      await stopProgram();
      return;
    }

    try {
      const response = await fetch(
        `${root}/${encodeURIComponent(sessionId)}/input`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: value }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (
          response.status === 409 &&
          /already finished|not running|has finished/i.test(
            data.error || data.message || "",
          )
        ) {
          markFinished(data.exitCode ?? null);
          setError(
            "The program has already finished. Run the code again to start a new session.",
          );
          return;
        }

        if (
          response.status === 400 &&
          /session not found/i.test(data.error || data.message || "")
        ) {
          markFinished(null);
          setError(
            "This terminal session has expired. Run the code again to start a new session.",
          );
          return;
        }

        throw new Error(
          data.message || data.error || `Input failed: HTTP ${response.status}`,
        );
      }

      setOutput((previous) => `${previous}> ${value}\n`);
      setInput("");
      inputRef.current?.focus();
    } catch (err) {
      setError(err.message || "Could not send terminal input.");
    }
  }

  return (
    <section className="terminal-panel">
      <header className="terminal-header">
        <div className="terminal-heading">
          <span className={`terminal-status ${running ? "is-running" : ""}`} />
          <span>Terminal</span>
          <span className="terminal-session">
            {running
              ? "Running"
              : `Exited${exitCode == null ? "" : ` (${exitCode})`}`}
          </span>
        </div>

        <div className="terminal-actions">
          {running && (
            <button
              type="button"
              className="terminal-stop"
              onClick={stopProgram}
            >
              Stop
            </button>
          )}

          {onClose && (
            <button
              type="button"
              className="terminal-close"
              onClick={onClose}
              aria-label="Close terminal"
            >
              ×
            </button>
          )}
        </div>
      </header>

      <pre className="terminal-output" ref={outputRef}>
        {output || "Waiting for program output..."}
      </pre>

      {error && <div className="terminal-error">{error}</div>}

      <form className="terminal-input-row" onSubmit={sendInput}>
        <span className="terminal-prompt">&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            running ? "Enter input or /exit..." : "Program has stopped"
          }
          disabled={!running}
          aria-label="Terminal input"
          autoComplete="off"
        />
        <button type="submit" disabled={!running || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
