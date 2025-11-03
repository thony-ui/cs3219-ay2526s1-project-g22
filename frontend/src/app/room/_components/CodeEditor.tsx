"use client";

import { useUser } from "@/contexts/user-context";
import axiosInstance from "@/lib/axios";
import { createClient } from "@/lib/supabase/supabase-client";
import { Question } from "@/queries/use-get-questions";
import { languageMap } from "@/utils/language-config";
import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { indentOnInput, indentUnit } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { RealtimeChannel } from "@supabase/supabase-js";
import CodeMirror from "@uiw/react-codemirror";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RealtimeContext from "../contexts/realtime-context";
import CodeEditorHeader from "./CodeEditorHeader";
import CodeEditorLanguageSelectionAndRunButton from "./CodeEditorLanguageSelectionAndRunButton";
import CodeEditorSubmissionResults from "./CodeEditorSubmissionResults";

// --- YJS imports ---
import { yCollab } from "y-codemirror.next";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

interface SubmissionResult {
  language: string;
  [key: string]: unknown;
}

const baseApiUrl = "/api/collaboration-service";

type Props = {
  sessionId: string;
  question?: Question;
  showHeader?: boolean;
};

export default function CodeEditor({
  sessionId,
  question,
  showHeader = true,
}: Props) {
  const router = useRouter();
  const [sessionEnded, setSessionEnded] = useState(false);
  const { user } = useUser();
  const userId = user?.id;

  const [selectedLanguage, setSelectedLanguage] =
    useState<string>("JavaScript");
  const [submissionHistory, setSubmissionHistory] = useState<
    SubmissionResult[]
  >([]);
  // initial code to show in the editor (from session or question snippet)
  const [initialCode, setInitialCode] = useState<string | undefined>(
    undefined
  );

  const supabase = useMemo(() => createClient(), []);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  const getSnippetForLanguage = (displayLanguage: string): string | null => {
    try {
      const cfg = languageMap[displayLanguage as keyof typeof languageMap];
      const apiLang = cfg?.apiLang || displayLanguage;
      const snippets = question?.codeSnippets;
      if (!snippets || snippets.length === 0) return null;
      const found = snippets.find((s: any) =>
        [s.lang, s.language, s.type].some(
          (v) => !!v && String(v).toLowerCase() === String(apiLang).toLowerCase()
        )
      );
      if (!found) return null;
      return (
        (found.code as string) || (found.content as string) || (found.snippet as string) || ""
      );
    } catch (err) {
      return null;
    }
  };

  // yjs setup
  const ydocRef = useRef<Y.Doc>(new Y.Doc());
  const ytextRef = useRef<Y.Text>(ydocRef.current.getText("codemirror"));
  const awarenessRef = useRef<Awareness>(new Awareness(ydocRef.current));
  // whether we've received any remote Yjs state (update or sync) for this join
  const stateReceivedRef = useRef<boolean>(false);
  // timeout id used to schedule a fallback initial insert when no remote state arrives
  const initialInsertTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    const awareness = awarenessRef.current;
    awareness.setLocalStateField("user", {
      name: userId || "anon",
      color: "#FF0000",
    });
  }, [userId]);

  const executeCode = async () => {
    const langConfig =
      languageMap[selectedLanguage as keyof typeof languageMap];
    if (!langConfig) {
      alert("Language not supported for execution yet!");
      return;
    }
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: langConfig.apiLang,
          code: ytextRef.current.toString(),
        }),
      });
      const data = await res.json();
      setSubmissionHistory((h) => [
        ...h,
        { language: selectedLanguage, ...data },
      ]);
    } catch (error) {
      console.error("Execution error:", error);
    }
  };

  // endSession optionally sends a broadcast to notify other participants.
  // When called as a reaction to a received broadcast, call with sendBroadcast=false
  // to avoid re-broadcast loops.
  const endSession = useCallback(
    (sendBroadcast = true) => {
      const channel = channelRef.current;
      if (sendBroadcast && channel) {
        try {
          channel.send({
            type: "broadcast",
            event: "exit_session",
            payload: { type: "end_session", from: userId, ts: Date.now() },
          });
        } catch (err) {
          // ignore send errors
          // console.debug("endSession broadcast failed", err);
        }
      }

      if (snapshotIntervalRef.current) {
        clearInterval(snapshotIntervalRef.current);
        snapshotIntervalRef.current = null;
      }
      if (channelRef.current) {
        try {
          channelRef.current.unsubscribe();
        } catch (err) {
          // ignore
        }
        channelRef.current = null;
      }
      setSessionEnded(true);
      setTimeout(() => router.push("/"), 1000);
    },
    [userId, router]
  );

  const joinRealtimeChannel = useCallback(
    async (initialCode: string) => {
      const channel = supabase.channel(`room-${sessionId}`, {
        config: { presence: { key: userId } },
      });

      

      // apply yjs updates
      channel.on("broadcast", { event: "yjs-update" }, (payload) => {
        // mark that we received remote state and cancel any fallback insert
        stateReceivedRef.current = true;
        if (initialInsertTimeoutRef.current) {
          clearTimeout(initialInsertTimeoutRef.current);
          initialInsertTimeoutRef.current = null;
        }
        const update = new Uint8Array(payload.payload.update);
        Y.applyUpdate(ydocRef.current, update);
      });

      // apply awareness update
      channel.on("broadcast", { event: "awareness-update" }, (payload) => {
        const update = new Uint8Array(payload.payload.update);
        applyAwarenessUpdate(awarenessRef.current, update, "remote");
      });

      // react to language-change broadcasts (update UI language selection)
      channel.on(
        "broadcast",
        { event: "language-change" },
        (payload: { payload?: any }) => {
          try {
            const pl = payload.payload ?? {};
            const lang = pl.language as string | undefined;
            if (lang && typeof lang === "string") {
              // update selected language in the UI; do NOT persist here
              // (originator already persisted and possibly updated Yjs doc)
              setSelectedLanguage(lang);
            }
          } catch (err) {
            // ignore
          }
        }
      );

      // send a vector update of the full document state to the new joiner
      channel.on("broadcast", { event: "yjs-request-state" }, (payload) => {
        const { from } = payload.payload;
        if (!from || from === userId) return;
        const update = Y.encodeStateAsUpdate(ydocRef.current);
        channel.send({
          type: "broadcast",
          event: "yjs-sync",
          payload: { update: Array.from(update), to: from },
        });
      });

      // --- Apply full Yjs state received from peer ---
      channel.on("broadcast", { event: "yjs-sync" }, (payload) => {
        const { to, update } = payload.payload;
        if (to === userId) {
          // mark that we received remote state and cancel any fallback insert
          stateReceivedRef.current = true;
          if (initialInsertTimeoutRef.current) {
            clearTimeout(initialInsertTimeoutRef.current);
            initialInsertTimeoutRef.current = null;
          }
          Y.applyUpdate(ydocRef.current, new Uint8Array(update));
          console.info("Applied full Yjs document state from peer");
        }
      });

      channel.on(
        "broadcast",
        { event: "exit_session" },
        (payload: { payload?: Record<string, unknown> }) => {
          try {
            const raw = payload.payload ?? {};
            const candidate =
              (raw.payload as Record<string, unknown> | undefined) ?? raw;

            if (candidate?.type === "end_session") {
              const from = candidate.from as string | undefined;
              if (!from || from !== userId) endSession(false);
            }
          } catch (err) {
            console.warn(
              "realtime: failed to handle exit_session payload",
              err
            );
          }
        }
      );

      // subscribe
      const sub = await channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ userId });
          console.info("Subscribed to room", sessionId);

          // Always request the latest document from peers
          channel.send({
            type: "broadcast",
            event: "yjs-request-state",
            payload: { from: userId },
          });
        }
      });

      // broadcast local yjs updates
      ydocRef.current.on("update", (update) => {
        channel.send({
          type: "broadcast",
          event: "yjs-update",
          payload: { update: Array.from(update) },
        });
      });

      // broadcast awareness changes
      awarenessRef.current.on(
        "update",
        ({
          added,
          updated,
          removed,
        }: {
          added: number[];
          updated: number[];
          removed: number[];
        }) => {
          const changed = added.concat(updated, removed);
          const update = encodeAwarenessUpdate(awarenessRef.current, changed);
          channel.send({
            type: "broadcast",
            event: "awareness-update",
            payload: { update: Array.from(update) },
          });
        }
      );

      // schedule a fallback initial insert only if no remote state arrives
      // within a short window. This prevents a refresh on one user from
      // overwriting the live document owned by other peers.
      if (initialCode && ytextRef.current.length === 0) {
        // randomized small delay + wait-for-remote-state timeout
        const randomDelay = 50 + Math.floor(Math.random() * 150);
        const fallbackDelay = 700 + randomDelay; // ms
        // clear any previous fallback
        if (initialInsertTimeoutRef.current) {
          clearTimeout(initialInsertTimeoutRef.current);
          initialInsertTimeoutRef.current = null;
        }
        initialInsertTimeoutRef.current = window.setTimeout(async () => {
          // only insert if we haven't received remote state and text is still empty
          try {
            if (!stateReceivedRef.current && ytextRef.current.length === 0) {
              ytextRef.current.insert(0, initialCode);
              // best-effort persist so future joins pick it up from the session
              await persistSnapshot(baseApiUrl, sessionId, initialCode).catch(
                () => void 0
              );
            }
          } catch (err) {
            // ignore
          } finally {
            initialInsertTimeoutRef.current = null;
          }
        }, fallbackDelay) as unknown as number;
      }

      channelRef.current = channel;

      // --- Periodic auto-save snapshot ---
      if (snapshotIntervalRef.current)
        clearInterval(snapshotIntervalRef.current);
      snapshotIntervalRef.current = setInterval(() => {
        persistSnapshot(
          baseApiUrl,
          sessionId,
          ytextRef.current.toString()
        ).catch(() => void 0);
      }, 5000);

      return sub;
    },
    [supabase, sessionId, userId, endSession]
  );

  // fetch initial code
  useEffect(() => {
    let aborted = false;
    async function initSession() {
        try {
          const resp = await axiosInstance.get(
            `${baseApiUrl}/sessions/${sessionId}`
          );
          if (resp.status !== 200) throw new Error(`Session fetch failed`);
          const session = resp.data;
          if (aborted) return;
          // Prefer session.current_code if present. Otherwise fall back to the
          // first code snippet attached to the question (if any).
          const sessionCode =
            typeof session.current_code === "string" && session.current_code
              ? session.current_code
              : "";

          // If the session has an authoritative language selection, use it
          // to initialise the editor language for all participants.
          const sessionLang =
            typeof session.current_language === "string" && session.current_language
              ? session.current_language
              : undefined;
          if (sessionLang) setSelectedLanguage(sessionLang);

          const questionSnippet =
            question?.codeSnippets && question.codeSnippets.length > 0
              ? // try a few common fields for snippet content
                (question.codeSnippets[0].code ||
                  question.codeSnippets[0].content ||
                  question.codeSnippets[0].snippet ||
                  "")
              : "";

          // If session has code use it, otherwise use question snippet (if any)
          const initial = sessionCode || questionSnippet || "";

          // Expose initial code to CodeMirror via defaultValue
          setInitialCode(initial || undefined);

          // Join realtime channel and let joinRealtimeChannel insert into Y.Text
          await joinRealtimeChannel(initial);

          // If session had no persisted code but question provided a snippet,
          // persist it so subsequent joins see it from the session row.
          if (!sessionCode && questionSnippet) {
            // Best-effort persist; ignore errors
            persistSnapshot(baseApiUrl, sessionId, questionSnippet).catch(() =>
              void 0
            );
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        console.log(`Error: ${e.message || e}`);
      }
    }
    initSession();
    return () => {
      aborted = true;
    };
  }, [sessionId, joinRealtimeChannel]);

  // clean up
  useEffect(() => {
    return () => {
      if (snapshotIntervalRef.current)
        clearInterval(snapshotIntervalRef.current);
      channelRef.current?.unsubscribe();
      // clear any pending fallback initial insert
      if (initialInsertTimeoutRef.current) {
        clearTimeout(initialInsertTimeoutRef.current);
        initialInsertTimeoutRef.current = null;
      }
    };
  }, []);

  // Listen for a global end-session event dispatched by the header/button
  // in case the header is rendered outside the realtime provider. When this
  // event is received we call the same local endSession function which will
  // broadcast the exit_session message to other clients and perform cleanup.
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const ev = e as CustomEvent<{ sessionId?: string }>;
        // if event specifies a sessionId and it doesn't match, ignore
        if (
          ev &&
          ev.detail &&
          ev.detail.sessionId &&
          ev.detail.sessionId !== sessionId
        )
          return;
        endSession();
      } catch (err) {
        // ignore
      }
    };
    window.addEventListener("peerprep:end_session", handler as EventListener);
    return () =>
      window.removeEventListener(
        "peerprep:end_session",
        handler as EventListener
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endSession]);

  const extensions = useMemo(() => {
    const langConfig =
      languageMap[selectedLanguage as keyof typeof languageMap];
    const langExtensions = langConfig?.extension || [
      javascript(),
      indentUnit.of("  "),
    ];
    return [
      ...langExtensions,
      oneDark,
      indentOnInput(),
      keymap.of([indentWithTab]),
      EditorView.lineWrapping,
      yCollab(ytextRef.current, awarenessRef.current, { undoManager: false }),
    ];
  }, [selectedLanguage]);

  // Persist language selection to backend so the session row's
  // `current_language` column stays authoritative. This is a lightweight
  // helper used by the language selection UI.
  const requestLanguageChange = useCallback(
    (language: string) => {
      try {
        // Update UI state immediately
        setSelectedLanguage(language);

        // If we have a snippet for this language, replace the Yjs document
        // locally so the change is propagated to peers via Yjs updates.
        const snippet = getSnippetForLanguage(language);
        if (snippet !== null) {
          try {
            ydocRef.current.transact(() => {
              ytextRef.current.delete(0, ytextRef.current.length);
              ytextRef.current.insert(0, snippet);
            });
          } catch (err) {
            // ignore local apply errors
          }
        }

        // Persist authoritative language to session row (best-effort)
        persistSnapshot(baseApiUrl, sessionId, undefined, language)
          .catch(() => void 0)
          .then(() => {
            // notify other connected clients so their UI reflects the change
            try {
              channelRef.current?.send({
                type: "broadcast",
                event: "language-change",
                payload: { language },
              });
            } catch (err) {
              // ignore
            }
          });
      } catch (err) {
        // ignore
      }
    },
    [sessionId]
  );

  // TEST ONLY: automatic cyclic typing in one tab
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.hash.includes("autotype")) return;

    let i = 0;
    const chars = "123456789";
    const ytext = ytextRef.current;

    const interval = setInterval(() => {
      const char = chars[i % chars.length];
      // Insert char at end
      ytext.insert(ytext.length, char);
      // Keep document short by deleting old chars
      if (ytext.length > 500) ytext.delete(0, ytext.length - 50);
      i++;
    }, 300);

    return () => clearInterval(interval);
  }, []);

  return (
    <RealtimeContext.Provider
      value={{ channel: channelRef.current, endSession }}
    >
      {sessionEnded && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 text-white z-[9999] backdrop-blur-sm">
          <div className="text-center space-y-4 animate-fade-in">
            <p className="text-2xl font-semibold">
              The collaboration session has ended.
            </p>
            <p className="text-sm text-gray-300">
              Redirecting you to the home page...
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col h-full">
        {/* Header (can be rendered by parent if desired) */}
        {showHeader && (
          <div className="flex justify-between items-center p-4 bg-slate-900/50 border-b border-slate-600/30">
            <CodeEditorHeader
              sessionId={sessionId}
              userId={userId || "unknown"}
              isBlocked={false} // everyone can edit
            />
          </div>
        )}

        {/* Language & Execute controls */}
        <CodeEditorLanguageSelectionAndRunButton
          selectedLanguage={selectedLanguage}
          setSelectedLanguage={setSelectedLanguage}
          setCode={() => {}} // not used with Yjs
          availableLanguages={
            question?.codeSnippets?.map((s) => s.lang || s.language) || [
              "Python",
              "JavaScript",
              "C++",
            ]
          }
          executeCode={executeCode}
          isBlocked={false}
          languageMap={languageMap}
          onRequestLanguageChange={requestLanguageChange}
        />

        {/* Main editor */}
        <div className="flex flex-1 min-h-0 gap-4 p-4">
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 rounded-lg overflow-hidden border border-slate-600/50 shadow-inner">
              <CodeMirror
                // Let yCollab / Y.Text control the document. We must NOT set
                // `defaultValue` here when using CRDT-backed yCollab because
                // that can lead to the same snippet being rendered both as the
                // editor's initial value and later inserted into the Y.Text,
                // producing duplicates. The CRDT insertion (in
                // `joinRealtimeChannel`) is authoritative.
                // key the editor by session so switching sessions forces a fresh mount
                key={sessionId}
                height="100%"
                theme={oneDark}
                extensions={extensions}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  dropCursor: false,
                  allowMultipleSelections: true,
                  indentOnInput: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: true,
                }}
              />
            </div>
          </div>
        </div>

        <CodeEditorSubmissionResults submissionHistory={submissionHistory} />
      </div>
    </RealtimeContext.Provider>
  );
}

async function persistSnapshot(
  baseUrl: string,
  sessionId: string,
  code?: string,
  language?: string,
  lastRequestId?: string
) {
  const body: Record<string, unknown> = {};
  if (typeof code === "string") body.code = code;
  if (typeof language === "string") body.language = language;
  if (typeof lastRequestId === "string") body.last_request_id = lastRequestId;
  if (Object.keys(body).length === 0) return;
  await axiosInstance.patch(
    `${baseUrl}/sessions/${sessionId}/snapshot`,
    body,
    { headers: { "Content-Type": "application/json" } }
  );
}
