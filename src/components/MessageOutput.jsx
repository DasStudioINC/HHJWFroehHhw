import { useMemo, useState } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import "../MessageOutput.css";
import TerminalPanel from "./TerminalPanel";

const LANGUAGE_ALIASES = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  python3: "python",
  html: "xml",
  xhtml: "xml",
  svg: "xml",
  xml: "xml",
  css: "css",
  scss: "scss",
  json: "json",
  jsonc: "json",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  "c#": "csharp",
  go: "go",
  golang: "go",
  rs: "rust",
  rust: "rust",
  rb: "ruby",
  ruby: "ruby",
  php: "php",
  kt: "kotlin",
  kotlin: "kotlin",
  swift: "swift",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  shell: "bash",
  ps1: "powershell",
  powershell: "powershell",
  bat: "dos",
  cmd: "dos",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  md: "markdown",
  markdown: "markdown",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  makefile: "makefile",
  graphql: "graphql",
  diff: "diff",
  plaintext: "plaintext",
  text: "plaintext",
  txt: "plaintext",
};

function normalizeLanguage(language = "") {
  const key = String(language).trim().toLowerCase();
  return LANGUAGE_ALIASES[key] || key;
}

function isRunnable(language) {
  return ["python", "javascript", "java"].includes(normalizeLanguage(language));
}

function parseOutput(content) {
  const source = String(content ?? "");
  const parts = [];
  const fencePattern =
    /(^|\n)([ \t]*)(`{3,}|~{3,})[ \t]*([^\n]*)\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/g;

  let lastIndex = 0;
  let match;
  let index = 0;

  while ((match = fencePattern.exec(source)) !== null) {
    const fullStart = match.index;
    const fenceStart = fullStart + match[1].length;
    const textBefore = source.slice(lastIndex, fenceStart);

    if (textBefore.trim()) {
      parts.push({
        type: "text",
        id: `text-${index++}`,
        content: textBefore.trim(),
      });
    }

    const info = match[4].trim();
    const language = info.split(/\s+/)[0] || "";

    parts.push({
      type: "code",
      id: `code-${index++}`,
      language: normalizeLanguage(language),
      languageLabel: language || "Auto-detected",
      content: match[5].replace(/\n$/, ""),
    });

    lastIndex = fencePattern.lastIndex;
  }

  const remainder = source.slice(lastIndex);

  if (remainder.trim()) {
    parts.push({
      type: "text",
      id: `text-${index}`,
      content: remainder.trim(),
    });
  }

  if (parts.length === 0 && source.trim()) {
    parts.push({
      type: "text",
      id: "text-0",
      content: source.trim(),
    });
  }

  return parts;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Copy failed. Select and copy the text manually.");
  }
}

function CopyButton({ text, label = "Copy", className = "" }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  async function handleCopy() {
    try {
      await copyText(text);
      setCopied(true);
      setCopyError("");
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      setCopyError(error.message || "Unable to copy.");
    }
  }

  return (
    <span className="output-copy-wrapper">
      <button
        type="button"
        className={`output-copy-button ${className}`}
        onClick={handleCopy}
        title={label}
      >
        {copied ? "✓ Copied" : label}
      </button>

      {copyError && (
        <span className="output-copy-error" role="status">
          {copyError}
        </span>
      )}
    </span>
  );
}

function CodeOutput({
  part,
  terminalKey,
  terminal,
  runnerUrl,
  onRunCode,
  onCloseTerminal,
}) {
  const [runError, setRunError] = useState("");
  const [starting, setStarting] = useState(false);

  const highlighted = useMemo(() => {
    const language = normalizeLanguage(part.language);
    const code = part.content;

    if (language && language !== "plaintext" && hljs.getLanguage(language)) {
      return {
        language,
        html: hljs.highlight(code, {
          language,
          ignoreIllegals: true,
        }).value,
      };
    }

    const result = hljs.highlightAuto(code);

    return {
      language: result.language || "plaintext",
      html: result.value,
    };
  }, [part.content, part.language]);

  const label =
    highlighted.language === "plaintext"
      ? part.languageLabel
      : highlighted.language;

  async function handleRun() {
    setRunError("");

    if (starting) return;

    if (typeof onRunCode !== "function") {
      setRunError(
        "Run is not connected to the application. Reload the website; if this persists, App.jsx needs fixing.",
      );
      return;
    }

    if (!runnerUrl) {
      setRunError("The runner API URL is missing.");
      return;
    }

    if (!part.content.trim()) {
      setRunError("This code block is empty.");
      return;
    }

    setStarting(true);

    try {
      await onRunCode({
        key: terminalKey,
        language: normalizeLanguage(part.language),
        code: part.content,
      });
    } catch (error) {
      setRunError(
        error.message || "The application could not start this code.",
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="output-code-card">
      <header className="output-code-header">
        <div className="output-code-language">
          <span className="output-code-indicator" />
          {label}
        </div>

        <div className="output-code-actions">
          {isRunnable(part.language) && (
            <button
              type="button"
              className="output-run-button"
              onClick={handleRun}
              disabled={starting}
              title="Run this code in the terminal"
            >
              {starting ? "Starting..." : "▶ Run"}
            </button>
          )}

          <CopyButton
            text={part.content}
            label="Copy code"
            className="output-code-copy"
          />
        </div>
      </header>

      {runError && (
        <div
          role="alert"
          style={{
            margin: "8px 12px",
            padding: "10px",
            color: "#ffb4b4",
            background: "rgba(180, 35, 35, 0.12)",
            border: "1px solid rgba(255, 100, 100, 0.45)",
            borderRadius: "6px",
            overflowWrap: "anywhere",
          }}
        >
          {runError}
        </div>
      )}

      <div className="output-code-scroll">
        <pre className="output-code-pre">
          <code
            className={`hljs language-${highlighted.language}`}
            dangerouslySetInnerHTML={{ __html: highlighted.html }}
          />
        </pre>
      </div>

      {terminal && (
        <TerminalPanel
          key={terminal.sessionId}
          sessionId={terminal.sessionId}
          runnerUrl={runnerUrl}
          onClose={() => onCloseTerminal?.(terminalKey)}
        />
      )}
    </section>
  );
}

function TextOutput({ content }) {
  return <div className="output-prose">{content}</div>;
}

export default function MessageOutput({
  content,
  role = "assistant",
  chatId = "",
  messageId = "",
  runnerUrl = "",
  runnerSessions = {},
  onRunCode,
  onCloseTerminal,
}) {
  const parts = useMemo(() => parseOutput(content), [content]);

  if (role === "user") {
    return (
      <div className="output-user">
        <TextOutput content={String(content ?? "")} />
      </div>
    );
  }

  if (!parts.length) {
    return <div className="output-prose"> </div>;
  }

  return (
    <div className="message-output">
      {parts.map((part) => {
        if (part.type === "code") {
          const terminalKey = `${chatId}:${messageId}:${part.id}`;

          return (
            <CodeOutput
              key={part.id}
              part={part}
              terminalKey={terminalKey}
              terminal={runnerSessions[terminalKey]}
              runnerUrl={runnerUrl}
              onRunCode={onRunCode}
              onCloseTerminal={onCloseTerminal}
            />
          );
        }

        return (
          <div className="output-text-card" key={part.id}>
            <TextOutput content={part.content} />

            <div className="output-text-actions">
              <CopyButton text={part.content} label="Copy text" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
