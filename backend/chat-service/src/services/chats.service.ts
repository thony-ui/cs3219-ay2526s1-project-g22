import { supabase } from "../utils/supabase";

export type ChatRow = {
  id: string;
  session_id: string;
  sender_id: string;
  content: string;
  role?: string | null;
  metadata?: any;
  created_at: string;
};

export async function fetchChats(
  sessionId: string,
  since?: string,
  limit = 50
): Promise<ChatRow[]> {
  let query = supabase
    .from("chats")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (since) {
    query = query.gt("created_at", since);
  } else {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as ChatRow[]) || [];
}

export async function postChat(
  sessionId: string,
  senderId: string,
  content: string,
  role?: string,
  metadata?: any
): Promise<ChatRow> {
  const insertObj: any = {
    session_id: sessionId,
    sender_id: senderId,
    content,
  };
  if (role) insertObj.role = role;
  if (metadata) insertObj.metadata = metadata;

  const { data, error } = await supabase
    .from("chats")
    .insert(insertObj)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ChatRow;
}

// helper: verify whether user is participant in session
export async function isParticipant(
  sessionId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("sessions")
    .select("interviewer_id, interviewee_id")
    .eq("id", sessionId)
    .single();

  if (error) throw new Error(error.message);
  if (!data) return false;
  return data.interviewer_id === userId || data.interviewee_id === userId;
}
