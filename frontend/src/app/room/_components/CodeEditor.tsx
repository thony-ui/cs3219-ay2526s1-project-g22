"use client";

import React, { useState, useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
// import { python } from "@codemirror/lang-python";
import { EditorView } from "@codemirror/view";
import { createClient } from "@/lib/supabase/supabase-client";

export default function CodeEditor({ roomId }: { roomId: string }) {
  const supabase = createClient();
  const [code, setCode] = useState<string>("console.log('Hello World');");
  const [users, setUsers] = useState<string[]>([]);

  const channelName = `room-${roomId}`; // unique channel per room

  const userIdRef = useRef("user-" + Math.floor(Math.random() * 10000));
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const userId = userIdRef.current;

  useEffect(() => {
    const channel = supabase.channel(channelName, {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      setUsers(Object.keys(state));
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ online: true });
      }
    });

    channel.on("broadcast", { event: "code-update" }, (payload) => {
      const newCode = payload.payload.code as string;
      setCode(newCode);
    });

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, []);

  // update local and broadcast
  const handleChange = async (value: string) => {
    setCode(value);

    await channelRef.current?.send({
      type: "broadcast",
      event: "code-update",
      payload: { code: value },
    });
  };

  return (
    <>
      <div className="mb-2 text-sm text-gray-400">
        Online: {users.join(", ")}
      </div>
      <div className="border rounded-md p-2">
        <CodeMirror
          value={code}
          height="400px"
          theme="dark"
          extensions={[javascript(), EditorView.lineWrapping]}
          onChange={handleChange}
        />
      </div>
    </>
  );
}
