"use client";

import { useEffect, useRef, useState } from "react";
import axiosInstance from "@/lib/axios";

type Message = {
  id: string;
  session_id?: string;
  sender_id: string;
  content: string;
  created_at: string; // ISO or timestamp string
};

export default function useChat(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const lastSeenRef = useRef<number | undefined>(undefined);
  const pollingRef = useRef<number | null>(null);

  const fetchOnce = async () => {
    try {
      const params: Record<string, unknown> = {};
      if (lastSeenRef.current) params.since = lastSeenRef.current;
      const res = await axiosInstance.get(
        `/api/chat-service/sessions/${sessionId}/chats`,
        { params }
      );
      const data: Message[] = Array.isArray(res.data) ? res.data : [];
      if (data.length > 0) {
        // append dedup
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const merged = [...prev];
          data.forEach((m) => {
            if (!seen.has(m.id)) merged.push(m);
          });
          return merged.sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
          );
        });
        // update lastSeen
        const maxTs = Math.max(
          ...data.map((m) => new Date(m.created_at).getTime())
        );
        lastSeenRef.current = maxTs;
      }
    } catch (e) {
      setError(e);
    }
  };

  useEffect(() => {
    // initial fetch
    fetchOnce();
    // start polling
    if (pollingRef.current) window.clearInterval(pollingRef.current);
    pollingRef.current = window.setInterval(() => {
      fetchOnce().catch(() => void 0);
    }, 2000);
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const sendMessage = async ({ content }: { content: string }) => {
    setIsSending(true);
    try {
      await axiosInstance.post(
        `/api/chat-service/sessions/${sessionId}/chats`,
        { content },
        { headers: { "Content-Type": "application/json" } }
      );
      // we'll pick up the new message on the next poll
      setIsSending(false);
      return true;
    } catch (e) {
      setError(e);
      setIsSending(false);
      throw e;
    }
  };

  const refresh = async () => {
    await fetchOnce();
  };

  return { messages, sendMessage, isSending, error, refresh };
}
