"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorView, keymap } from "@codemirror/view";
import { debounce } from "lodash";
import { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/supabase-client";
import {
  AnyPayload,
  SyncRequestPayload,
  SyncResponsePayload,
  SyncAckPayload,
  CodeUpdatePayload,
  AnyPayloadWithLang,
} from "../types/realtime";
import { useUser } from "@/contexts/user-context";
import EndSessionButton from "./EndSessionBtn";

const SESSION_API_BASE_URL = process.env
  .NEXT_PUBLIC_SESSION_API_BASE_URL as string;

type Props = {
  sessionId: string;
};

export default function CodeEditor({ sessionId }: Props) {
  const { user } = useUser();
  const userId = user?.id;

  const [code, setCode] = useState<string>("// Loading session...\n");
  const [isBlocked, setIsBlocked] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>("Initializing...");
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(
    null
  );
  const [langExtension, setLangExtension] = useState<any>(null);

  const supabase = useMemo(() => createClient(), []);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const applyingRemoteRef = useRef(false);
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const codeRef = useRef(code);
  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  // Accepted languages list (ID, label). Add/remove as needed.
  const SUPPORTED_LANGUAGES: { id: string; label: string }[] = [
    { id: "javascript", label: "JavaScript / TypeScript" },
    { id: "python", label: "Python" },
    { id: "java", label: "Java" },
    { id: "rust", label: "Rust" },
    { id: "cpp", label: "C / C++" },
    { id: "plaintext", label: "Plain Text" },
  ];

  // Load language extension dynamically when selectedLanguage changes.
  useEffect(() => {
    let cancelled = false;
    async function loadLang() {
      if (!selectedLanguage) {
        setLangExtension(null);
        return;
      }
      try {
        switch (selectedLanguage) {
          case "javascript":
            setLangExtension(javascript({ jsx: true, typescript: true }));
            break;
          case "python": {
            const mod = await import(
              /* webpackChunkName: "cm-lang-python" */ "@codemirror/lang-python"
            );
            if (!cancelled) setLangExtension(mod.python());
            break;
          }
          case "java": {
            const mod = await import(
              /* webpackChunkName: "cm-lang-java" */ "@codemirror/lang-java"
            );
            if (!cancelled) setLangExtension(mod.java());
            break;
          }
          case "rust": {
            const mod = await import(
              /* webpackChunkName: "cm-lang-rust" */ "@codemirror/lang-rust"
            );
            if (!cancelled) setLangExtension(mod.rust());
            break;
          }
          case "cpp": {
            // try C/C++ language package, fallback to null if unavailable
            try {
              const mod = await import(
                /* webpackChunkName: "cm-lang-cpp" */ "@codemirror/lang-cpp"
              );
              if (!cancelled) setLangExtension(mod.cpp());
            } catch (e) {
              setLangExtension(null);
            }
            break;
          }
          case "plaintext":
          default:
            setLangExtension(null);
            break;
        }
      } catch (e) {
        // If dynamic import fails, fallback to no language extension
        console.warn("Failed to load language extension", selectedLanguage, e);
        if (!cancelled) setLangExtension(null);
      }
    }
    loadLang();
    return () => {
      cancelled = true;
    };
  }, [selectedLanguage]);

  // Fetch session and initial code
  useEffect(() => {
    let aborted = false;
    async function initSession() {
      try {
        const resp = await fetch(
          `${SESSION_API_BASE_URL}/sessions/${sessionId}`
        );
        if (!resp.ok) throw new Error(`Session fetch failed (${resp.status})`);
        const session = await resp.json();
        if (aborted) return;

        const initial =
          typeof session.current_code === "string" ? session.current_code : "";
        setCode(initial);
        await joinRealtimeChannel(initial);
      } catch (e: any) {
        setStatusMsg(`Error: ${e.message || e}`);
      }
    }
    initSession();
    return () => {
      aborted = true;
    };
  }, []);

  // Join Supabase channel
  const joinRealtimeChannel = useCallback(
    async (initialCode: string) => {
      const channel = supabase.channel(`room-${sessionId}`, {
        config: { presence: { key: userId } },
      });

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setConnectedUsers(Object.keys(state || {}));
      });

      channel.on("broadcast", { event: "editor" }, (payload) => {
        const data = payload.payload as AnyPayloadWithLang;
        switch (data.type) {
          case "language_change": {
            // update selected language when someone else changes it
            const lang = (data as any).language as string | null;
            if (lang && lang !== selectedLanguage) {
              setSelectedLanguage(lang);
            }
            break;
          }
          case "sync_request": {
            if (data.from === userId) break;
            safeBroadcast(channel, {
              type: "sync_response",
              to: data.from,
              from: userId,
              code: codeRef.current,
              ts: nowTs(),
            } as SyncResponsePayload);
            break;
          }
          case "sync_response": {
            if (data.to !== userId) return;
            applyingRemoteRef.current = true;
            setCode(data.code);
            setIsBlocked(false);
            safeBroadcast(channel, {
              type: "sync_ack",
              to: data.from,
              from: userId,
              ts: nowTs(),
            } as SyncAckPayload);
            break;
          }
          case "sync_ack": {
            if (data.to !== userId) return;
            setIsBlocked(false);
            break;
          }
          case "code_update": {
            if (data.from === userId) return;
            applyingRemoteRef.current = true;
            setCode(data.code);
            break;
          }
        }
      });

      const sub = await channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ userId });
          const ids = Object.keys(channel.presenceState() || {});
          if (ids.length > 1) {
            setIsBlocked(true);
            safeBroadcast(channel, {
              type: "sync_request",
              from: userId,
              ts: nowTs(),
            } as SyncRequestPayload);
          } else {
            setIsBlocked(false);
          }
        }
      });

      channelRef.current = channel;
      if (snapshotIntervalRef.current)
        clearInterval(snapshotIntervalRef.current);
      snapshotIntervalRef.current = setInterval(() => {
        persistSnapshot(SESSION_API_BASE_URL, sessionId, codeRef.current).catch(
          () => void 0
        );
      }, 5000);
      return sub;
    },
    [supabase, sessionId, userId, SESSION_API_BASE_URL]
  );

  // Cleanup
  useEffect(() => {
    return () => {
      if (snapshotIntervalRef.current)
        clearInterval(snapshotIntervalRef.current);
      channelRef.current?.unsubscribe();
    };
  }, []);

  // Debounced broadcaster
  const broadcastChange = useMemo(
    () =>
      debounce(
        (nextCode: string) => {
          const channel = channelRef.current;
          if (!channel) return;
          safeBroadcast(channel, {
            type: "code_update",
            from: userId,
            code: nextCode,
            ts: nowTs(),
          } as CodeUpdatePayload);
        },
        100,
        { leading: true, trailing: true }
      ),
    []
  );

  const onChange = useCallback(
    (value: string) => {
      if (isBlocked) return;
      if (applyingRemoteRef.current) {
        applyingRemoteRef.current = false;
        setCode(value);
        return;
      }
      setCode(value);
      broadcastChange(value);
    },
    [isBlocked, broadcastChange]
  );

  const extensions = useMemo(
    () => [
      // default fallback is JS extension in case selectedLanguage is JS
      // actual language extension is prepended via langExtension when available
      javascript({ jsx: true, typescript: true }),
      EditorView.lineWrapping,
      // also require a selected language before allowing edits
      EditorView.editable.of(!isBlocked && !!selectedLanguage),
      keymap.of([]),
    ],
    [isBlocked, selectedLanguage]
  );

  return (
    <>
      <div className="flex justify-between items-center mb-2 text-sm text-gray-400">
        <div>
          Room: <span className="font-medium text-gray-600">{sessionId}</span> •
          User: <span className="font-medium text-gray-600">{userId}</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              isBlocked
                ? "text-yellow-600 font-medium"
                : "text-green-600 font-medium"
            }
          >
            {isBlocked ? "Read-only" : "Editable"}
          </span>
          <EndSessionButton sessionId={sessionId} />
        </div>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <label className="text-sm text-gray-500">Language:</label>
        <select
          value={selectedLanguage ?? ""}
          onChange={(e) => {
            const lang = e.target.value || null;
            setSelectedLanguage(lang);
            // broadcast language selection to other participants
            const channel = channelRef.current;
            if (channel) {
              safeBroadcast(channel, {
                type: "language_change",
                from: userId,
                language: lang,
                ts: nowTs(),
              } as any);
            }
          }}
          className="rounded border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">-- Select a language --</option>
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <div className="text-xs text-gray-400">(required)</div>
      </div>

      <div className="border rounded-md p-2">
        <CodeMirror
          value={code}
          height="90vh"
          theme="dark"
          extensions={langExtension ? [langExtension, ...extensions] : extensions}
          onChange={onChange}
          basicSetup={{ lineNumbers: true }}
        />
        {!selectedLanguage && (
          <div className="mt-2 text-sm text-red-500">Please select a language to enable syntax highlighting.</div>
        )}
      </div>
    </>
  );
}

// interface used to broadcast into the channel
function safeBroadcast(channel: RealtimeChannel, payload: AnyPayload) {
  channel.send({ type: "broadcast", event: "editor", payload });
}

// updates record in the db
async function persistSnapshot(
  baseUrl: string,
  sessionId: string,
  code: string
) {
  await fetch(`${baseUrl}/sessions/${sessionId}/snapshot`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

function nowTs() {
  return Date.now();
}
