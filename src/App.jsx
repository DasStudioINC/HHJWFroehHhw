import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import MessageOutput from "./components/MessageOutput";

const PRODUCTION_API_URL = "https://alliaiagent.yurphagames.net/api/agent";

const DEFAULT_API_URL = import.meta.env.DEV ? "/api/agent" : PRODUCTION_API_URL;

function apiRoot(url) {
  const clean = url.trim().replace(/\/+$/, "");
  return clean.endsWith("/agent") ? clean.slice(0, -"/agent".length) : clean;
}

function endpoint(url, path) {
  return `${apiRoot(url)}/${path.replace(/^\/+/, "")}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof data === "string"
        ? data
        : data?.message || data?.error || data?.detail;

    if (response.status === 401) {
      throw new Error("You are not authenticated. Please log in again.");
    }

    throw new Error(detail || `Request failed (${response.status})`);
  }

  return data;
}

function makeChatId() {
  const date = new Date();
  const timestamp = date
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);

  return `chat_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;
}

function messageText(message) {
  if (typeof message === "string") return message;
  return String(message?.content ?? "");
}

function formatTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readStoredRunnerSessions() {
  try {
    return JSON.parse(
      localStorage.getItem("alliagent_runner_sessions") || "{}",
    );
  } catch {
    return {};
  }
}

function App() {
  // In development, always use the same-origin Vite proxy.
  // This intentionally ignores an old absolute backend URL saved in localStorage.
  const [apiUrl, setApiUrl] = useState(() =>
    import.meta.env.DEV
      ? "/api/agent"
      : localStorage.getItem("alliagent_api_url") || PRODUCTION_API_URL,
  );

  const [draftApiUrl, setDraftApiUrl] = useState(apiUrl);

  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState("");
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState("");

  const [connection, setConnection] = useState("checking");
  const [backendStatus, setBackendStatus] = useState("Connecting...");
  const [selectedModel, setSelectedModel] = useState("");
  const [category, setCategory] = useState("");

  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState("");

  const [runnerSessions, setRunnerSessions] = useState(
    readStoredRunnerSessions,
  );

  const runnerUrl = `${apiRoot(apiUrl)}/runner`;

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const historyRequestRef = useRef(0);
  const sendingRef = useRef(false);

  const persistRunnerSessions = useCallback((updater) => {
    setRunnerSessions((previous) => {
      const next = typeof updater === "function" ? updater(previous) : updater;

      try {
        localStorage.setItem("alliagent_runner_sessions", JSON.stringify(next));
      } catch {
        // Terminal display should still work if browser storage is unavailable.
      }

      return next;
    });
  }, []);

  // BACKEND STATUS

  const checkStatus = useCallback(
    async (url = apiUrl) => {
      try {
        const data = await requestJson(endpoint(url, "/status"));

        setConnection("online");
        setBackendStatus(data?.status || "Connected");
        return true;
      } catch (err) {
        setConnection("offline");
        setBackendStatus(err.message || "Unable to connect");
        return false;
      }
    },
    [apiUrl],
  );

  // LOAD CONVERSATIONS

  const refreshChats = useCallback(
    async (url = apiUrl) => {
      setLoadingChats(true);

      try {
        const data = await requestJson(endpoint(url, "/chats"));

        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.chats)
            ? data.chats
            : [];

        const normalized = list
          .map((item) => {
            if (typeof item === "string") return item;
            return item?.chatId || item?.chat_id || item?.id || "";
          })
          .filter(Boolean);

        const uniqueChats = [...new Set(normalized)];

        setChats([...uniqueChats].sort().reverse());
        return uniqueChats;
      } catch (err) {
        setError(`Could not load conversations: ${err.message}`);
        return null;
      } finally {
        setLoadingChats(false);
      }
    },
    [apiUrl],
  );

  // LOAD SAVED CONVERSATION HISTORY

  const loadHistory = useCallback(
    async (chatId, url = apiUrl) => {
      if (!chatId) return;

      const requestId = ++historyRequestRef.current;

      setLoadingHistory(true);
      setError("");
      setMessages([]);

      try {
        const data = await requestJson(
          endpoint(url, `/chats/${encodeURIComponent(chatId)}`),
        );

        if (requestId !== historyRequestRef.current) return;

        const history = Array.isArray(data)
          ? data
          : Array.isArray(data?.messages)
            ? data.messages
            : [];

        setMessages(
          history
            .filter(
              (message) =>
                message &&
                ["user", "assistant"].includes(
                  String(message.role || "").toLowerCase(),
                ),
            )
            .map((message, index) => ({
              id: `${chatId}-${index}`,
              role: String(message.role).toLowerCase(),
              content: messageText(message),
              time:
                message.timestamp || message.time || new Date().toISOString(),
            })),
        );
      } catch (err) {
        if (requestId !== historyRequestRef.current) return;

        setMessages([]);
        setError(
          `Could not load this conversation: ${err.message}. ` +
            "It may not exist on the backend yet.",
        );
      } finally {
        if (requestId === historyRequestRef.current) {
          setLoadingHistory(false);
        }
      }
    },
    [apiUrl],
  );

  // CREATE A CONVERSATION

  const createChat = useCallback(
    async (url = apiUrl) => {
      const chatId = makeChatId();

      await requestJson(endpoint(url, "/chats"), {
        method: "POST",
        body: JSON.stringify({ chatId }),
      });

      setChats((previous) => [
        chatId,
        ...previous.filter((id) => id !== chatId),
      ]);

      setActiveChat(chatId);
      setMessages([]);
      setPrompt("");
      setError("");
      setSelectedModel("");
      setCategory("");
      setSidebarOpen(false);

      return chatId;
    },
    [apiUrl],
  );

  // INITIALIZE THE WEBSITE

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      setConnection("checking");
      setError("");

      const online = await checkStatus(apiUrl);
      if (cancelled) return;

      const list = await refreshChats(apiUrl);
      if (cancelled || list === null) return;

      if (list.length > 0) {
        const firstChat = list.includes(activeChat)
          ? activeChat
          : [...list].sort().reverse()[0];

        setActiveChat(firstChat);
        await loadHistory(firstChat, apiUrl);
      } else if (online) {
        try {
          const newId = await createChat(apiUrl);

          if (!cancelled) {
            await loadHistory(newId, apiUrl);
          }
        } catch (err) {
          if (!cancelled) {
            setError(
              `Could not create your first conversation: ${err.message}`,
            );
          }
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
    // Reinitialize when the configured backend changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  // KEEP THE LATEST MESSAGE VISIBLE

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, sending, loadingHistory, runnerSessions]);

  // TERMINAL RUNNER

  async function handleRunCode({ key, language, code }) {
    if (!activeChat) {
      setError("Create or select a conversation before running code.");
      return;
    }

    setError("");

    try {
      const data = await requestJson(`${runnerUrl}/start`, {
        method: "POST",
        body: JSON.stringify({
          chatId: activeChat,
          language,
          code,
        }),
      });

      const sessionId = data?.sessionId || data?.session_id;

      if (!sessionId) {
        throw new Error("The runner did not return a session ID.");
      }

      persistRunnerSessions((previous) => ({
        ...previous,
        [key]: {
          sessionId,
          chatId: activeChat,
          language,
          startedAt: data.startedAt || new Date().toISOString(),
        },
      }));
    } catch (err) {
      setError(
        `Could not run this code: ${err.message}. ` +
          "Check that the backend runner is enabled and reachable.",
      );
    }
  }

  function handleCloseTerminal(key) {
    persistRunnerSessions((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  // NEW CONVERSATION

  async function handleNewChat() {
    if (sendingRef.current) return;

    setError("");

    try {
      const id = await createChat();
      await loadHistory(id);
    } catch (err) {
      setError(`Could not create a conversation: ${err.message}`);
    }
  }

  // SWITCH CONVERSATIONS

  async function handleSelectChat(chatId) {
    if (sendingRef.current || chatId === activeChat) {
      setSidebarOpen(false);
      return;
    }

    setActiveChat(chatId);
    setMessages([]);
    setSelectedModel("");
    setCategory("");
    setSidebarOpen(false);

    await loadHistory(chatId);
  }

  // SEND MESSAGE TO THE AGENT

  async function handleSend(event) {
    event?.preventDefault();

    const text = prompt.trim();

    if (!text || sendingRef.current) return;

    setError("");
    sendingRef.current = true;
    setSending(true);

    let chatId = activeChat;

    try {
      if (!chatId) {
        chatId = await createChat();
      }

      const userMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
        time: new Date().toISOString(),
      };

      setMessages((previous) => [...previous, userMessage]);
      setPrompt("");

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      const data = await requestJson(apiUrl.trim().replace(/\/+$/, ""), {
        method: "POST",
        body: JSON.stringify({ chatId, prompt: text }),
      });

      const responseText = String(data?.response ?? "");

      if (data?.status === "error") {
        throw new Error(responseText || "The agent reported an error.");
      }

      if (data?.status === "max_iterations_reached") {
        setError(responseText || "The agent reached its maximum steps.");
      }

      if (
        data?.status === "success" ||
        data?.status === "max_iterations_reached"
      ) {
        if (data?.selected_model) {
          setSelectedModel(data.selected_model);
        }

        if (data?.category) {
          setCategory(data.category);
        }
      }

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: responseText || "The backend returned no response text.",
        time: new Date().toISOString(),
      };

      setMessages((previous) => [...previous, assistantMessage]);
      await refreshChats();
    } catch (err) {
      setError(err.message || "Failed to send your message.");

      if (chatId) {
        await loadHistory(chatId);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  // COMPOSER

  function handleTextareaKeyDown(event) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      handleSend();
    }
  }

  function handlePromptChange(event) {
    setPrompt(event.target.value);

    const textarea = event.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }

  // BACKEND SETTINGS

  async function saveApiSettings(event) {
    event.preventDefault();

    const nextUrl = draftApiUrl.trim().replace(/\/+$/, "");

    if (!nextUrl || !/^https?:\/\//i.test(nextUrl)) {
      setError("Enter a valid backend URL beginning with http:// or https://.");
      return;
    }

    if (import.meta.env.DEV) {
      setError(
        "Local development uses the Vite proxy automatically. " +
          "Keep the local endpoint set to /api/agent.",
      );
      setDraftApiUrl("/api/agent");
      return;
    }

    setApiUrl(nextUrl);
    localStorage.setItem("alliagent_api_url", nextUrl);
    setSettingsOpen(false);
  }

  const filteredChats = chats.filter((id) =>
    id.toLowerCase().includes(chatSearch.toLowerCase()),
  );

  const isEmpty = messages.length === 0 && !loadingHistory;

  // RENDER

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-icon">A</div>

          <div className="brand-copy">
            <strong>ALLIAGENT</strong>
            <span>STUDIO / LOCAL INTELLIGENCE</span>
          </div>

          <button
            className="icon-button sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            ×
          </button>
        </div>

        <button
          className="new-chat-button"
          onClick={handleNewChat}
          disabled={sending}
        >
          <span className="plus-icon">＋</span>
          New conversation
          <span className="shortcut">N</span>
        </button>

        <div className="sidebar-section-heading">
          <span>YOUR CONVERSATIONS</span>
          <span className="count-badge">{chats.length}</span>
        </div>

        <div className="chat-search">
          <span>⌕</span>
          <input
            value={chatSearch}
            onChange={(event) => setChatSearch(event.target.value)}
            placeholder="Find a conversation..."
            aria-label="Search conversations"
          />
        </div>

        <div className="chat-list">
          {loadingChats && chats.length === 0 ? (
            <div className="sidebar-message">Loading conversations...</div>
          ) : filteredChats.length === 0 ? (
            <div className="sidebar-message">
              {chats.length
                ? "No matching conversations."
                : "Your conversations will appear here."}
            </div>
          ) : (
            filteredChats.map((chatId) => (
              <button
                key={chatId}
                className={`chat-item ${
                  activeChat === chatId ? "chat-item-active" : ""
                }`}
                onClick={() => handleSelectChat(chatId)}
                title={chatId}
                disabled={sending}
              >
                <span className="chat-item-icon">▤</span>
                <span className="chat-item-name">{chatId}</span>
                {activeChat === chatId && <span className="active-dot" />}
              </button>
            ))
          )}
        </div>

        <div className="sidebar-bottom">
          <div className="backend-card">
            <div className="backend-card-top">
              <span className={`status-dot status-${connection}`} />
              <span className="backend-card-label">BACKEND STATUS</span>
              <span className="backend-card-state">
                {connection === "online"
                  ? "ONLINE"
                  : connection === "checking"
                    ? "CHECKING"
                    : "OFFLINE"}
              </span>
            </div>

            <p title={backendStatus}>{backendStatus}</p>

            <button
              className="backend-settings-button"
              onClick={() => {
                setDraftApiUrl(apiUrl);
                setSettingsOpen(true);
              }}
            >
              <span>⚙</span> Backend settings
            </button>
          </div>

          <div className="profile-row">
            <div className="profile-avatar">Y</div>
            <div className="profile-copy">
              <strong>Yurpha Games</strong>
              <span>AlliAgent workspace</span>
            </div>
            <span className="profile-status" />
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              ☰
            </button>

            <div>
              <div className="breadcrumb">
                <span>WORKSPACE</span>
                <span className="breadcrumb-separator">/</span>
                <span className="breadcrumb-current">CHAT</span>
              </div>
              <div className="page-title">AI Assistant</div>
            </div>
          </div>

          <div className="topbar-right">
            <div className="connection-chip">
              <span className={`status-dot status-${connection}`} />
              {connection === "online"
                ? "Connected"
                : connection === "checking"
                  ? "Connecting"
                  : "Disconnected"}
            </div>

            <button
              className="icon-button top-settings"
              onClick={() => {
                setDraftApiUrl(apiUrl);
                setSettingsOpen(true);
              }}
              aria-label="Backend settings"
              title="Backend settings"
            >
              ⚙
            </button>
          </div>
        </header>

        <section className="conversation-header">
          <div className="conversation-heading">
            <div className="assistant-avatar">✳</div>

            <div className="conversation-heading-copy">
              <h1>
                Alli <span className="online-label">● READY</span>
              </h1>
              <p>
                {activeChat || "Start a new conversation"}
                {selectedModel ? ` · ${selectedModel}` : ""}
              </p>
            </div>
          </div>

          <div className="conversation-tools">
            {category && <span className="category-chip">{category}</span>}

            <button
              className="subtle-button"
              onClick={() => activeChat && loadHistory(activeChat)}
              disabled={!activeChat || loadingHistory || sending}
              title="Reload conversation history"
            >
              ↻ <span>Refresh</span>
            </button>
          </div>
        </section>

        <section className="messages-area" aria-live="polite">
          <div className="messages-inner">
            {loadingHistory && (
              <div className="loading-history">
                <span className="spinner" />
                Loading conversation history...
              </div>
            )}

            {isEmpty && (
              <div className="welcome-panel">
                <div className="welcome-icon">✳</div>
                <div className="eyebrow">YOUR AI WORKSPACE</div>
                <h2>What are we building today?</h2>
                <p>
                  Chat with Alli, get help with code, explore ideas, or use your
                  agent&apos;s available tools.
                </p>

                <div className="suggestion-grid">
                  <button
                    onClick={() =>
                      setPrompt("Help me plan a new software project.")
                    }
                  >
                    <span className="suggestion-icon purple">⌘</span>
                    <span>
                      <strong>Plan a project</strong>
                      <small>Turn an idea into a clear roadmap</small>
                    </span>
                    <span className="suggestion-arrow">↗</span>
                  </button>

                  <button
                    onClick={() =>
                      setPrompt("Help me debug an issue in my code.")
                    }
                  >
                    <span className="suggestion-icon blue">{"</>"}</span>
                    <span>
                      <strong>Debug some code</strong>
                      <small>Investigate an error step by step</small>
                    </span>
                    <span className="suggestion-arrow">↗</span>
                  </button>

                  <button
                    onClick={() =>
                      setPrompt(
                        "Explain a technical concept clearly, with examples.",
                      )
                    }
                  >
                    <span className="suggestion-icon green">⌁</span>
                    <span>
                      <strong>Learn something</strong>
                      <small>Break down a technical concept</small>
                    </span>
                    <span className="suggestion-arrow">↗</span>
                  </button>

                  <button
                    onClick={() =>
                      setPrompt("Give me creative ideas for my next project.")
                    }
                  >
                    <span className="suggestion-icon orange">✧</span>
                    <span>
                      <strong>Explore ideas</strong>
                      <small>Brainstorm your next creation</small>
                    </span>
                    <span className="suggestion-arrow">↗</span>
                  </button>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <article
                className={`message-row message-${message.role}`}
                key={message.id}
              >
                <div className={`message-avatar avatar-${message.role}`}>
                  {message.role === "user" ? "Y" : "✳"}
                </div>

                <div className="message-content">
                  <div className="message-meta">
                    <strong>{message.role === "user" ? "You" : "Alli"}</strong>
                    <span>{formatTime(message.time)}</span>
                  </div>

                  <div className="message-text">
                    <MessageOutput
                      content={message.content}
                      role={message.role}
                      chatId={activeChat}
                      messageId={message.id}
                      runnerUrl={runnerUrl}
                      runnerSessions={runnerSessions}
                      onRunCode={handleRunCode}
                      onCloseTerminal={handleCloseTerminal}
                    />
                  </div>
                </div>
              </article>
            ))}

            {sending && (
              <article className="message-row message-assistant">
                <div className="message-avatar avatar-assistant">✳</div>

                <div className="message-content">
                  <div className="message-meta">
                    <strong>Alli</strong>
                    <span>Working</span>
                  </div>

                  <div className="thinking-indicator">
                    <span />
                    <span />
                    <span />
                    <em>{backendStatus || "Thinking..."}</em>
                  </div>
                </div>
              </article>
            )}

            <div ref={bottomRef} />
          </div>
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <span>!</span>
            <p>{error}</p>
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}

        <footer className="composer-section">
          <form className="composer" onSubmit={handleSend}>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handlePromptChange}
              onKeyDown={handleTextareaKeyDown}
              placeholder="Message Alli... (Enter to send, Shift + Enter for a new line)"
              rows={1}
              disabled={sending}
              aria-label="Message Alli"
            />

            <div className="composer-bottom">
              <div className="composer-hints">
                <span className="hint-key">↵</span> Send
                <span className="hint-separator">·</span>
                <span className="hint-key">⇧ ↵</span> New line
              </div>

              <button
                type="submit"
                className="send-button"
                disabled={sending || !prompt.trim()}
              >
                {sending ? (
                  <>
                    <span className="button-spinner" />
                    Thinking
                  </>
                ) : (
                  <>
                    Send message <span>↑</span>
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="composer-disclaimer">
            Alli uses your configured Ollama-backed Spring Boot agent. Verify
            important outputs.
          </div>
        </footer>
      </main>

      {settingsOpen && (
        <div
          className="modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSettingsOpen(false);
            }
          }}
        >
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="modal-header">
              <div>
                <div className="eyebrow">CONFIGURATION</div>
                <h2 id="settings-title">Backend settings</h2>
              </div>

              <button
                className="icon-button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
              >
                ×
              </button>
            </div>

            <form onSubmit={saveApiSettings}>
              <label htmlFor="api-url">Agent endpoint URL</label>

              <input
                id="api-url"
                value={draftApiUrl}
                onChange={(event) => setDraftApiUrl(event.target.value)}
                placeholder="https://your-server.example/api/agent"
                autoFocus
              />

              <p className="field-help">
                Enter the complete agent endpoint, including{" "}
                <code>/api/agent</code>. During local development, requests use
                the local Vite proxy so the authentication session cookie can be
                reused.
              </p>

              <div className="settings-current">
                <span className={`status-dot status-${connection}`} />
                <span>Current connection: {backendStatus}</span>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="subtle-button"
                  onClick={() => setSettingsOpen(false)}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="subtle-button"
                  onClick={() => checkStatus(apiUrl)}
                >
                  Test connection
                </button>

                <button type="submit" className="send-button">
                  Save settings
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
