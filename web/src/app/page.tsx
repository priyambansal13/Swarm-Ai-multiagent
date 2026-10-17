import { Suspense } from 'react';
import { ChatApp } from '@/components/chat/ChatApp';

export default function ChatPage() {
  // ChatApp reads ?t= via useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">Loading chat…</div>}>
      <ChatApp />
    </Suspense>
  );
}
