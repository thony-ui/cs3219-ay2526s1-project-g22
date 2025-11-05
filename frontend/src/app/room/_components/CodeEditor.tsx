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
import { EditorView, keymap, Decoration, WidgetType } from "@codemirror/view";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { DecorationSet } from "@codemirror/view";
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

type BroadcastPayload = { payload?: Record<string, unknown> };

export default function CodeEditor({
  sessionId,
  question,
  showHeader = true,
}: Props) {
  const router = useRouter();
  const [sessionEnded, setSessionEnded] = useState(false);
  const { user } = useUser();
  const userId = user?.id;

  // Start with no language selected. The editor will be non-editable
  // until a language is chosen by a participant.
  const [selectedLanguage, setSelectedLanguage] = useState<string | undefined>(
    undefined
  );
  // proposal / confirmation UI state
  const [incomingProposal, setIncomingProposal] = useState<{
    from?: string;
    language: string;
    proposalId?: string;
  } | null>(null);
  // keep a ref copy so realtime callbacks (which close over values) can
  // reliably inspect/clear the current incoming proposal
  const incomingProposalRef = useRef<{
    from?: string;
    language: string;
    proposalId?: string;
  } | null>(null);
  const [proposalPending, setProposalPending] = useState<{
    language: string;
    timeoutId: number | null;
  } | null>(null);
  // simple toast system
  const [toasts, setToasts] = useState<
    { id: string; message: string; ttl?: number }[]
  >([]);

  const pushToast = useCallback((message: string, ttl = 5000) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const toast = { id, message, ttl };
    setToasts((t) => [...t, toast]);
    if (ttl && ttl > 0) {
      window.setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, ttl);
    }
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);
  const prevLanguageRef = useRef<string | undefined | null>(null);
  // track pending proposal in a ref so realtime callbacks see the up-to-date value
  // includes proposalId to allow deterministic tie-breaking for simultaneous
  // proposals
  const pendingProposalRef = useRef<{
    language: string;
    timeoutId: number | null;
    proposalId: string;
    ts: number;
  } | null>(null);
  // stable client id used in realtime messages when `userId` may be undefined
  // We'll prefer the authenticated user id when available. When not, we will
  // attempt to use the Supabase realtime connection/client id (set after
  // subscribing). Only fall back to a local random id if no supabase id is
  // discoverable.
  const clientIdRef = useRef<string>(userId || "");
  const [submissionHistory, setSubmissionHistory] = useState<
    SubmissionResult[]
  >([]);
  // initial code to show in the editor (from session or question snippet)
  const [initialCode, setInitialCode] = useState<string | undefined>(undefined);

  const supabase = useMemo(() => createClient(), []);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Remote cursors map: clientId -> { anchor, head, userName?, color, ts }
  const remoteCursorsRef = useRef<Record<string, any>>({});

  const pickColor = (id: string) => {
    const colors = [
      "#ef4444",
      "#f97316",
      "#f59e0b",
      "#84cc16",
      "#10b981",
      "#06b6d4",
      "#3b82f6",
      "#8b5cf6",
      "#ec4899",
    ];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i);
    return colors[Math.abs(h) % colors.length];
  };

  // StateEffect & StateField used to update editor decorations for remote cursors
  const setRemoteCursorsEffect = useMemo(() => StateEffect.define<Record<string, any>>(), []);
  const remoteCursorsField = useMemo(() =>
    StateField.define<DecorationSet>({
      create() {
        return Decoration.none;
      },
      update(decos, tr) {
        for (const e of tr.effects) {
          if (e.is(setRemoteCursorsEffect)) {
            const cursors = e.value ?? {};
            // build decorations from cursors and current doc
            const builder: any[] = [];
            const doc = tr.state.doc;
            Object.keys(cursors).forEach((cid) => {
              const c = cursors[cid];
              if (!c || typeof c.head !== "number") return;
              const head = Math.max(0, Math.min(doc.length, c.head));
              const anchor = Math.max(0, Math.min(doc.length, c.anchor ?? c.head));
              // selection
              if (anchor !== head) {
                const from = Math.min(anchor, head);
                const to = Math.max(anchor, head);
                builder.push(Decoration.mark({
                  attributes: { style: `background: ${c.color}33;` },
                }).range(from, to));
              }
              // caret widget
              class CursorWidget extends WidgetType {
                color: string;
                label: string;
                constructor(color: string, label: string) {
                  super();
                  this.color = color;
                  this.label = label;
                }
                toDOM() {
                  const el = document.createElement("span");
                  el.className = "cm-remote-caret";
                  // Make caret thicker and a bit taller so it's more visible
                  el.style.borderLeft = `2px solid ${this.color}`;
                  // adjust margin to account for thicker border
                  el.style.marginLeft = "-2px";
                  el.style.height = "1.05em";
                  el.style.display = "inline-block";
                  el.style.verticalAlign = "text-bottom";
                  // subtle glow to help visibility on dark backgrounds
                  el.style.boxShadow = `0 0 4px ${this.color}66`;
                  // label
                  const label = document.createElement("div");
                  label.textContent = this.label || cid;
                  label.style.position = "absolute";
                  label.style.background = this.color;
                  label.style.color = "white";
                  label.style.fontSize = "11px";
                  label.style.padding = "2px 6px";
                  label.style.borderRadius = "4px";
                  label.style.transform = "translateY(-1.6em)";
                  label.style.whiteSpace = "nowrap";
                  const wrapper = document.createElement("span");
                  wrapper.style.position = "relative";
                  wrapper.appendChild(el);
                  wrapper.appendChild(label);
                  return wrapper;
                }
                ignoreEvent() { return true; }
              }
              const caret = Decoration.widget({ widget: new CursorWidget(c.color, c.userName || cid), side: 1 }).range(head);
              builder.push(caret);
            });
            // convert array to Decoration.set
            const set = Decoration.set(builder as any, true);
            decos = set;
          }
        }
        // map decorations through document changes
        decos = decos.map(tr.changes);
        return decos;
      },
      provide: f => EditorView.decorations.from(f),
    }), [setRemoteCursorsEffect]
  );
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  const getSnippetForLanguage = (displayLanguage: string): string | null => {
    try {
      const cfg = languageMap[displayLanguage as keyof typeof languageMap];
      const apiLang = cfg?.apiLang || displayLanguage;
      const snippets = question?.codeSnippets;
      if (!snippets || snippets.length === 0) return null;
      const found = snippets.find(
        (s: { lang?: string; language?: string; type?: string }) =>
          [s.lang, s.language, s.type].some(
            (v) =>
              !!v && String(v).toLowerCase() === String(apiLang).toLowerCase()
          )
      );

      if (!found) return null;
      return (
        (found.code as string) ||
        (found.content as string) ||
        (found.snippet as string) ||
        ""
      );
    } catch (err) {
      return null;
    }
  };

  // yjs setup
  const ydocRef = useRef<Y.Doc>(new Y.Doc());
  const ytextRef = useRef<Y.Text>(ydocRef.current.getText("codemirror"));
  // whether we've received any remote Yjs state (update or sync) for this join
  const stateReceivedRef = useRef<boolean>(false);
  // timeout id used to schedule a fallback initial insert when no remote state arrives
  const initialInsertTimeoutRef = useRef<number | null>(null);
  // awareness/cursor support removed: no local awareness state or dedupe logic

  // keep ref in sync with state so realtime handlers can read latest value
  useEffect(() => {
    incomingProposalRef.current = incomingProposal;
  }, [incomingProposal]);

  // If the originator refreshes while a proposal is pending, attempt to
  // notify peers and remember in sessionStorage so the initiator sees a
  // cancellation notice after reload.
  useEffect(() => {
    const storageKey = `pp-cancelled-${sessionId}`;

    const onBeforeUnload = () => {
      const pending = pendingProposalRef.current;
      if (pending && channelRef.current) {
        try {
          channelRef.current.send({
            type: "broadcast",
            event: "language-cancel",
            payload: {
              from: clientIdRef.current,
              language: pending.language,
              proposalId: pending.proposalId,
            },
          });
        } catch (err) {
          // ignore
        }
        try {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ language: pending.language, ts: Date.now() })
          );
        } catch (err) {
          // ignore
        }
      }
      // If we have an incoming proposal (we are the requested) then send an
      // automatic rejection to the originator so they aren't left waiting.
      const incoming = incomingProposalRef.current;
      if (incoming && incoming.from && channelRef.current) {
        try {
          channelRef.current.send({
            type: "broadcast",
            event: "language-response",
            payload: {
              to: incoming.from,
              from: clientIdRef.current,
              language: incoming.language,
              accept: false,
              proposalId: incoming.proposalId,
            },
          });
        } catch (err) {
          // ignore
        }
        try {
          sessionStorage.setItem(
            `pp-rejected-${sessionId}`,
            JSON.stringify({
              language: incoming.language,
              from: incoming.from,
              ts: Date.now(),
            })
          );
        } catch (err) {
          // ignore
        }
      }
      // awareness/cursor cleanup removed
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [sessionId]);

  // On mount, check if we previously cancelled due to a refresh and show
  // a transient notice to the initiator.
  useEffect(() => {
    const storageKey = `pp-cancelled-${sessionId}`;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw || "{}");
        const lang = parsed?.language;
        pushToast(
          `Your pending language change to ${
            lang || "<unknown>"
          } was cancelled due to a refresh`
        );
        sessionStorage.removeItem(storageKey);
      }
    } catch (err) {
      // ignore
    }
  }, [sessionId]);

  // If we previously auto-rejected by refresh (the requested refreshed while
  // a proposal was incoming) show a transient notice on reload.
  useEffect(() => {
    const storageKey = `pp-rejected-${sessionId}`;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw || "{}");
        const lang = parsed?.language;
        pushToast(
          `You refreshed while a proposal was pending; the proposal for ${
            lang || "<unknown>"
          } was auto-rejected.`
        );
        sessionStorage.removeItem(storageKey);
      }
    } catch (err) {
      // ignore
    }
  }, [sessionId]);

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

  // endSession optionally sends a broadcast to notify other participant.
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

      // awareness/cursor broadcasts removed

      // incoming cursor updates from peers
      channel.on(
        "broadcast",
        { event: "cursor-update" },
        (payload: { payload?: Record<string, unknown> }) => {
          try {
            const raw = payload.payload ?? {};
            const pl = (raw.payload as Record<string, unknown> | undefined) ?? raw;
            const cid = (pl.clientId as string) || (pl.from as string) || undefined;
            const sel = (pl.selection as { anchor: number; head: number } | undefined) || pl;
            const userMeta = (pl.user as any) || {};
            if (!cid || cid === clientIdRef.current) return;
            const map = {
              ...(remoteCursorsRef.current || {}),
              [cid]: {
                anchor: typeof sel.anchor === "number" ? sel.anchor : 0,
                head: typeof sel.head === "number" ? sel.head : 0,
                userName: userMeta.name || cid,
                color: pickColor(cid),
                ts: typeof pl.ts === "number" ? pl.ts : Date.now(),
              },
            };
            remoteCursorsRef.current = map;
            // update decorations in the editor if available
            try {
              editorViewRef.current?.dispatch({
                effects: setRemoteCursorsEffect.of(map),
              });
            } catch (err) {
              // ignore
            }
          } catch (err) {
            // ignore
          }
        }
      );

      // incoming language proposal from another client
      channel.on(
        "broadcast",
        { event: "language-proposal" },
        (payload: BroadcastPayload) => {
          try {
            const pl = payload.payload ?? {};
            const lang = pl.language as string | undefined;
            const from = pl.from as string | undefined;
            const proposalId = pl.proposalId as string | undefined;
            const ts = typeof pl.ts === "number" ? pl.ts : Date.now();
            if (!lang || !from || from === clientIdRef.current || !proposalId)
              return;

            // If we have an outgoing pending proposal, this is a simultaneous
            // proposal situation. Resolve deterministically by comparing
            // proposalId strings (lexical order); the smaller id wins. If we
            // lose the tie, cancel our outgoing; if we win, auto-reject the
            // incoming proposal so the UX remains deterministic.
            const pending = pendingProposalRef.current;
            if (pending) {
              try {
                const theirs = proposalId;
                const ours = pending.proposalId;
                if (theirs < ours) {
                  // Their proposal wins. Cancel our pending proposal and
                  // present the incoming one for user decision.
                  try {
                    channelRef.current?.send({
                      type: "broadcast",
                      event: "language-cancel",
                      payload: {
                        from: clientIdRef.current,
                        language: pending.language,
                        proposalId: pending.proposalId,
                      },
                    });
                  } catch (err) {
                    // ignore
                  }
                  if (pending.timeoutId) clearTimeout(pending.timeoutId);
                  pendingProposalRef.current = null;
                  setProposalPending(null);
                  if (prevLanguageRef.current) {
                    setSelectedLanguage(prevLanguageRef.current);
                    prevLanguageRef.current = null;
                  }
                  // show incoming proposal to local user
                  const incoming = { from, language: lang, proposalId };
                  incomingProposalRef.current = incoming;
                  setIncomingProposal(incoming);
                  return;
                } else {
                  // Our proposal wins: auto-reject their proposal so they
                  // will process the rejection deterministically.
                  try {
                    channelRef.current?.send({
                      type: "broadcast",
                      event: "language-response",
                      payload: {
                        to: from,
                        from: clientIdRef.current,
                        language: lang,
                        accept: false,
                        proposalId,
                      },
                    });
                  } catch (err) {
                    // ignore
                  }
                  // don't show incoming prompt (we've auto-rejected)
                  return;
                }
              } catch (err) {
                // if tie-break logic fails, fall back to showing incoming
              }
            }

            // show incoming proposal to local user
            const incoming = { from, language: lang, proposalId };
            incomingProposalRef.current = incoming;
            setIncomingProposal(incoming);
          } catch (err) {
            // ignore
          }
        }
      );

      // react to language-change broadcasts (update UI language selection)
      channel.on(
        "broadcast",
        { event: "language-change" },
        (payload: BroadcastPayload) => {
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

      // originator cancelled a previously-sent proposal
      channel.on(
        "broadcast",
        { event: "language-cancel" },
        (payload: BroadcastPayload) => {
          try {
            const pl = payload.payload ?? {};
            const from = pl.from as string | undefined;
            const lang = pl.language as string | undefined;
            const proposalId = pl.proposalId as string | undefined;
            if (!from || from === clientIdRef.current) return;
            // if we have an incoming proposal from that originator matching
            // the proposalId, clear it
            const cur = incomingProposalRef.current;
            if (cur && cur.from === from) {
              incomingProposalRef.current = null;
              setIncomingProposal(null);
              pushToast(
                `User ${from} cancelled language change to ${
                  lang || "<unknown>"
                }`
              );
            }
            // If the cancel targets our outgoing pending proposal, clear it
            const pending = pendingProposalRef.current;
            if (pending && proposalId && pending.proposalId === proposalId) {
              if (pending.timeoutId) clearTimeout(pending.timeoutId);
              pendingProposalRef.current = null;
              setProposalPending(null);
              if (prevLanguageRef.current) {
                setSelectedLanguage(prevLanguageRef.current);
                prevLanguageRef.current = null;
              }
            }
          } catch (err) {
            // ignore
          }
        }
      );

      // language response to proposals (only relevant to originator)
      channel.on(
        "broadcast",
        { event: "language-response" },
        (payload: BroadcastPayload) => {
          try {
            const pl = payload.payload ?? {};
            const to = pl.to as string | undefined;
            const accept = pl.accept as boolean | undefined;
            const lang = pl.language as string | undefined;
            const from = pl.from as string | undefined;
            const proposalId = pl.proposalId as string | undefined;
            // only handle responses addressed to this client
            if (!to || to !== clientIdRef.current) return;
            // if originator and waiting on proposal, process first response
            const pending = pendingProposalRef.current;
            if (pending && lang && typeof accept === "boolean") {
              // make sure this response matches the proposal we sent
              if (proposalId && pending.proposalId !== proposalId) {
                // ignore responses to other proposals
                return;
              }
              // clear pending timeout
              if (pending.timeoutId) {
                clearTimeout(pending.timeoutId);
              }
              pendingProposalRef.current = null;
              setProposalPending(null);
              if (accept) {
                // apply language change (originator applies and broadcasts)
                try {
                  setSelectedLanguage(lang);
                  const snippet = getSnippetForLanguage(lang);
                  if (snippet !== null) {
                    ydocRef.current.transact(() => {
                      ytextRef.current.delete(0, ytextRef.current.length);
                      ytextRef.current.insert(0, snippet);
                    });
                  }
                } catch (err) {
                  // ignore
                }
                // persist authoritative language
                persistSnapshot(baseApiUrl, sessionId, undefined, lang)
                  .catch(() => void 0)
                  .finally(() => {
                    // notify peers about accepted change
                    try {
                      channelRef.current?.send({
                        type: "broadcast",
                        event: "language-change",
                        payload: { language: lang },
                      });
                    } catch (err) {
                      // ignore
                    }
                  });
              } else {
                // someone rejected; notify originator UI (no-op for now)
                if (prevLanguageRef.current) {
                  setSelectedLanguage(prevLanguageRef.current);
                  prevLanguageRef.current = null;
                }
                // show rejection notice briefly
                pushToast(
                  `User ${
                    from || "peer"
                  } rejected the language change to ${lang}`
                );
                // could show a toast here in future
              }
            }
          } catch (err) {
            // ignore
          }
        }
      );

      // send a vector update of the full document state to the new joiner
      channel.on("broadcast", { event: "yjs-request-state" }, (payload) => {
        const { from } = payload.payload;
        if (!from || from === clientIdRef.current) return;
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
        if (to === clientIdRef.current) {
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
          // Track presence using configured userId (may be undefined)
          await channel.track({ userId });

          // Try to derive a stable client id from the supabase/channel
          // runtime. Different runtime versions expose different props so
          // attempt a few fallbacks before creating a local id.
          try {
            const ch: any = channel;
            const supabaseAny: any = supabase;
            const derived =
              userId ||
              ch?.subscription?.id ||
              ch?.id ||
              ch?.socket?.id ||
              supabaseAny?.realtime?.connection?.id ||
              supabaseAny?.realtime?.client?.connection?.id;
            clientIdRef.current =
              (typeof derived === "string" && derived) ||
              `local-${Math.random().toString(36).slice(2, 9)}`;
          } catch (err) {
            clientIdRef.current = `local-${Math.random()
              .toString(36)
              .slice(2, 9)}`;
          }

          console.info("Subscribed to room", sessionId, "clientId:", clientIdRef.current);
          // Now that we have a derived stable client id, include it in our
          // awareness 'user' state so peers can detect and prefer the most
          // recent instance when deduplicating.
          // awareness/cursor state not used in this build

          // Always request the latest document from peers
          channel.send({
            type: "broadcast",
            event: "yjs-request-state",
            payload: { from: clientIdRef.current },
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

      // awareness/cursor broadcasting removed

      // No local fallback insert: we intentionally avoid seeding the shared
      // document from the client when no remote state is present. The session
      // authoritative row (`session.current_code`) or an originator-initiated
      // language-accept flow should be used to set initial content. Removing
      // the fallback avoids races where slow page loads cause duplicated
      // snippets to appear when multiple clients (or the originator) also
      // attempt inserts.

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
        // to initialise the editor language for all participant.
        const sessionLang =
          typeof session.current_language === "string" &&
          session.current_language
            ? session.current_language
            : undefined;
        if (sessionLang) setSelectedLanguage(sessionLang);

        const questionSnippet =
          question?.codeSnippets && question.codeSnippets.length > 0
            ? // try a few common fields for snippet content
              question.codeSnippets[0].code ||
              question.codeSnippets[0].content ||
              question.codeSnippets[0].snippet ||
              ""
            : "";

        // If session has code use it. Otherwise, only use the question
        // snippet if the session already has an authoritative language
        // selected. This avoids seeding code into the session when no
        // language is chosen.
        const initial =
          sessionCode || (sessionLang ? questionSnippet : "") || "";

        // Expose initial code to CodeMirror via defaultValue
        setInitialCode(initial || undefined);

        // Join realtime channel and let joinRealtimeChannel insert into Y.Text
        await joinRealtimeChannel(initial);

        // If session had no persisted code but question provided a snippet,
        // persist it so subsequent joins see it from the session row. Only
        // persist when an authoritative language exists for the session.
        if (!sessionCode && questionSnippet && sessionLang) {
          // Best-effort persist; ignore errors
          persistSnapshot(baseApiUrl, sessionId, questionSnippet).catch(
            () => void 0
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

  // handlers for user accepting/rejecting an incoming proposal
  const respondToProposal = useCallback(
    (accept: boolean) => {
      if (!incomingProposal) return;
      try {
        channelRef.current?.send({
          type: "broadcast",
          event: "language-response",
          payload: {
            to: incomingProposal.from,
            from: clientIdRef.current,
            language: incomingProposal.language,
            accept,
            proposalId: incomingProposal.proposalId,
          },
        });
      } catch (err) {
        // ignore
      }
      // clear incoming prompt UI
      incomingProposalRef.current = null;
      setIncomingProposal(null);
    },
    [incomingProposal, userId]
  );

  const extensions = useMemo(() => {
    const langConfig =
      languageMap[selectedLanguage as keyof typeof languageMap];
    const langExtensions = langConfig?.extension || [
      javascript(),
      indentUnit.of("  "),
    ];
    // Add a small bottom padding so final line is reachable.
    const editorPaddingTheme = EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": { paddingBottom: "3.5rem" },
    });

    const base = [
      ...langExtensions,
      oneDark,
      indentOnInput(),
      keymap.of([indentWithTab]),
      EditorView.lineWrapping,
      editorPaddingTheme,
    ];

    // When no language is selected, make the editor non-editable and readOnly
    // so users are encouraged to pick a language first. Programmatic updates
    // are still allowed (we still can insert snippets into Y.Text).
    if (!selectedLanguage) {
      base.push(EditorView.editable.of(false));
      base.push(EditorState.readOnly.of(true));
    }

    base.push(
      // y-collab (CRDT) integration
      yCollab(ytextRef.current, undefined as any, { undoManager: false })
    );

    // Add remote cursor decorations/state
    base.push(remoteCursorsField);

    // Update listener: publish selection (cursor) updates to peers
    base.push(
      EditorView.updateListener.of((update) => {
        try {
          if (!update.view) return;
          // on selection change, broadcast cursor pos
          if (update.selectionSet) {
            const sel = update.state.selection.main;
            const payload = {
              anchor: sel.anchor,
              head: sel.head,
              ts: Date.now(),
            };
            const cid = clientIdRef.current || `local-${Math.random().toString(36).slice(2,9)}`;
            const userLabel = (user && (user.name || (user.email as string) || user.id)) || cid;
            // update local cache
            const map = {
              ...(remoteCursorsRef.current || {}),
              [cid]: { ...payload, userName: userLabel, color: pickColor(cid), ts: Date.now() },
            };
            remoteCursorsRef.current = map;
            update.view.dispatch({ effects: setRemoteCursorsEffect.of(map) });
            // broadcast to peers
            try {
              channelRef.current?.send({
                type: "broadcast",
                event: "cursor-update",
                payload: { clientId: cid, selection: payload, user: { name: userLabel }, ts: Date.now() },
              });
            } catch (err) {
              // ignore
            }
          }
        } catch (err) {
          // ignore
        }
      })
    );

    return base;
  }, [selectedLanguage]);

  // Persist language selection to backend so the session row's
  // `current_language` column stays authoritative. This is a lightweight
  // helper used by the language selection UI.
  const requestLanguageChange = useCallback(
    (language: string) => {
      // generate proposal id/timestamp up-front so they are available
      // for the timeout cleanup closure and ref storage
      const proposalId = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const ts = Date.now();
      try {
        // Update UI state immediately
        // Instead of applying immediately, send a proposal to peers and wait
        // for their response. The originator will apply the change only when
        // another participant accepts.
        try {
          // remember previous language so we can revert on rejection/timeout
          prevLanguageRef.current = selectedLanguage;
          channelRef.current?.send({
            type: "broadcast",
            event: "language-proposal",
            payload: { language, from: clientIdRef.current, proposalId, ts },
          });
        } catch (err) {
          // ignore
        }

        // show local pending UI and prepare a timeout to abort if nobody answers
        if (proposalPending && proposalPending.timeoutId) {
          clearTimeout(proposalPending.timeoutId);
        }
        const timeoutId = window.setTimeout(() => {
          // no response -> clear pending state
          setProposalPending(null);
          pendingProposalRef.current = null;
          // revert UI selection
          if (prevLanguageRef.current) {
            setSelectedLanguage(prevLanguageRef.current);
            prevLanguageRef.current = null;
          }
        }, 10000) as unknown as number;
        const pending = { language, timeoutId, proposalId, ts };
        pendingProposalRef.current = pending;
        // UI state keeps same shape as before (language + timeoutId)
        setProposalPending({ language, timeoutId });
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

      {/* Incoming proposal modal */}
      {incomingProposal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Language change proposed"
        >
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-white text-black rounded-lg p-6 w-full max-w-md mx-4 shadow-2xl border border-slate-200 z-50">
            <h3 className="text-lg font-semibold mb-2 text-black">
              Language change proposed
            </h3>
            <p className="text-sm text-slate-700 mb-4">
              User{" "}
              <strong className="font-semibold text-black">{incomingProposal.from}</strong>{" "}
              proposes to change the editor language to{" "}
              <strong className="font-semibold text-black">
                {incomingProposal.language}
              </strong>
              .
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => respondToProposal(false)}
                className="px-3 py-1 rounded bg-slate-100 text-slate-800 hover:bg-slate-200"
              >
                Reject
              </button>
              <button
                onClick={() => respondToProposal(true)}
                className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Originator pending banner */}
      {proposalPending && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9997]">
          <div className="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-200 px-4 py-2 rounded shadow">
            Waiting for other participant to accept language change to{" "}
            <strong>{proposalPending.language}</strong>
            <button
              onClick={() => {
                // send cancel notification to peers so they can clear their prompt
                try {
                  const lang = proposalPending?.language;
                  const pid = pendingProposalRef.current?.proposalId;
                  channelRef.current?.send({
                    type: "broadcast",
                    event: "language-cancel",
                    payload: {
                      from: clientIdRef.current,
                      language: lang,
                      proposalId: pid,
                    },
                  });
                } catch (err) {
                  // ignore
                }
                if (proposalPending.timeoutId)
                  clearTimeout(proposalPending.timeoutId);
                // clear pending ref and revert selection
                pendingProposalRef.current = null;
                if (prevLanguageRef.current) {
                  setSelectedLanguage(prevLanguageRef.current);
                  prevLanguageRef.current = null;
                }
                setProposalPending(null);
              }}
              className="ml-3 underline text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toast container */}
      {toasts.length > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9997] flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-200 px-4 py-2 rounded shadow flex items-center justify-between max-w-sm"
            >
              <div className="mr-3 break-words">{t.message}</div>
              <button
                onClick={() => removeToast(t.id)}
                className="ml-2 text-sm underline"
                aria-label="Close toast"
              >
                Close
              </button>
            </div>
          ))}
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
          selectedLanguage={selectedLanguage ?? ""}
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

        {/* If no language is selected, don't even show the editor; show a chooser panel in-place */}
        {!selectedLanguage ? (
          <div className="flex-1 flex items-center justify-center p-8 min-h-[200px]">
            <div className="w-full max-w-2xl text-center rounded-lg p-8">
              <h3 className="text-xl text-slate-300 font-semibold mb-2">
                Choose a language to enable the editor
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                The collaborative editor is disabled until a language is
                selected. Choose a language with the language dropdown above to
                get started.
              </p>
            </div>
          </div>
        ) : (
          /* Main editor */
          <div className="flex flex-1 min-h-0 gap-4 p-4">
            <div className="flex-1 flex flex-col min-w-0 h-full">
              <div className="flex-1 rounded-lg overflow-hidden border border-slate-600/50 shadow-inner min-h-0 h-full">
                <CodeMirror
                  className="h-full"
                  // Let yCollab / Y.Text control the document. We must NOT set
                  // `defaultValue` here when using CRDT-backed yCollab because
                  // that can lead to the same snippet being rendered both as the
                  // editor's initial value and later inserted into the Y.Text,
                  // producing duplicates. The CRDT insertion (in
                  // `joinRealtimeChannel`) is authoritative.
                  // key the editor by session and language so switching sessions
                  // or changing language forces a fresh mount. Also pass the
                  // current Y.Text value as `value` at mount time so CodeMirror's
                  // initial document matches the shared document and remote
                  // delta ranges won't be out-of-range.
                  key={`${sessionId}-${selectedLanguage || "none"}`}
                  // Only provide an initial `value` to CodeMirror when the
                  // shared Y.Text already contains content. If we pass a
                  // non-empty `value` while the Y.Text is empty, CodeMirror
                  // will render that content locally and then the fallback
                  // insert (or a later Yjs update) can insert the same
                  // snippet into the CRDT, producing duplicated text. By
                  // setting `value` to `undefined` when Y.Text is empty we
                  // let the CRDT (yCollab) be the single source of truth for
                  // initial content and avoid duplicate inserts.
                  value={
                    ytextRef.current && ytextRef.current.length > 0
                      ? ytextRef.current.toString()
                      : undefined
                  }
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
                  onCreateEditor={(view) => {
                    try {
                      editorViewRef.current = view;
                      // ensure decorations reflect any cached remote cursors
                      view.dispatch({ effects: setRemoteCursorsEffect.of(remoteCursorsRef.current) });
                    } catch (err) {
                      // ignore
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}

        <CodeEditorSubmissionResults submissionHistory={submissionHistory} />
      </div>
    </RealtimeContext.Provider>
  );
}

async function persistSnapshot(
  baseUrl: string,
  sessionId: string,
  code?: string,
  language?: string
) {
  const body: Record<string, unknown> = {};
  if (typeof code === "string") body.code = code;
  if (typeof language === "string") body.language = language;
  if (Object.keys(body).length === 0) return;
  await axiosInstance.patch(`${baseUrl}/sessions/${sessionId}/snapshot`, body, {
    headers: { "Content-Type": "application/json" },
  });
}
