import CodeEditor from "../_components/CodeEditor";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return (
    <>
      <h1>Hello {roomId}</h1>
      <CodeEditor roomId={roomId} />
    </>
  );
}
