import { ChatPanel } from "@/components/chat-panel";

export default function ChatPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Answers are grounded in the most relevant passages from all processed documents.
        </p>
      </div>
      <ChatPanel />
    </div>
  );
}
