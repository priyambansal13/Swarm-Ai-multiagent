'use client';

import { Loader2, Mic, Paperclip, SendHorizontal, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, fileToBase64 } from '@/lib/api';

export interface OutAttachment { name: string; mime: string; data: string; size: number }

const MAX_FILES = 4;
const MAX_BYTES = 8 * 1024 * 1024;

export function Composer({
  busy, disabled, onSend, onStop,
}: { busy: boolean; disabled?: string | null; onSend: (text: string, attachments: OutAttachment[]) => void; onStop: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<OutAttachment[]>([]);
  const [rec, setRec] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = () => {
    if (busy || (!text.trim() && !files.length)) return;
    onSend(text.trim(), files);
    setText('');
    setFiles([]);
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next: OutAttachment[] = [];
    for (const f of Array.from(list).slice(0, MAX_FILES - files.length)) {
      if (f.size > MAX_BYTES) {
        setNote(`${f.name} is larger than 8 MB.`);
        continue;
      }
      next.push({ name: f.name, mime: f.type || 'application/octet-stream', data: await fileToBase64(f), size: f.size });
    }
    setFiles((cur) => [...cur, ...next].slice(0, MAX_FILES));
  };

  /** Push-to-talk: tap to start, tap again to stop → transcribe → send. */
  const toggleMic = async () => {
    setNote(null);
    if (rec === 'recording') {
      recorder.current?.stop();
      return;
    }
    if (rec === 'transcribing') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec('transcribing');
        try {
          const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
          const { text: heard } = await api<{ text: string }>('/voice/transcribe', { method: 'POST', json: { audio: await fileToBase64(blob), mime: blob.type } });
          if (heard.trim()) onSend(heard.trim(), files);
          else setNote("I didn't catch that — try again.");
          setFiles([]);
        } catch (e) {
          setNote(`Transcription failed: ${(e as Error).message}`);
        } finally {
          setRec('idle');
        }
      };
      recorder.current = r;
      r.start();
      setRec('recording');
    } catch {
      setNote('Microphone permission is needed for voice input.');
    }
  };

  if (disabled) return <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">{disabled}</div>;

  return (
    <div className="rounded-2xl border border-line bg-surface p-2 shadow-sm focus-within:border-accent">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex max-w-[14rem] items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-xs">
              <span className="truncate">{f.name}</span>
              <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      {note && <p className="px-2 pb-1 text-xs text-danger">{note}</p>}
      <div className="flex items-end gap-1.5">
        <input ref={fileInput} id="attach" type="file" multiple accept="image/*,text/*,.csv,.json,.md" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40" aria-label="Attach image or file">
          <Paperclip className="h-5 w-5" />
        </button>
        <textarea
          ref={area}
          id="composer"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={rec === 'recording' ? 'Listening… tap the mic to stop' : 'Ask your swarm anything…'}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] outline-none placeholder:text-muted"
        />
        <button type="button" onClick={toggleMic} disabled={busy && rec === 'idle'}
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition disabled:opacity-40 ${rec === 'recording' ? 'bg-danger text-white hive-pulse' : 'bg-surface-2 text-ink hover:bg-accent-soft'}`}
          aria-label={rec === 'recording' ? 'Stop recording' : 'Push to talk'}>
          {rec === 'transcribing' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
        </button>
        {busy ? (
          <button type="button" onClick={onStop} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-bg" aria-label="Stop">
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={!text.trim() && !files.length} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-[#1b1d1f] disabled:opacity-40" aria-label="Send">
            <SendHorizontal className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
