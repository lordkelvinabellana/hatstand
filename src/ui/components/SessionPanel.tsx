import { ArrowLeft, ExternalLink, Mic, Send, Square, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SessionView } from '../../shared.ts';
import { api } from '../api.ts';
import { useDictation } from '../dictate.ts';

interface Detail {
  messages: { role: 'user' | 'assistant'; text: string }[];
  cwd: string;
}
const stateLabels: Record<SessionView['state'], string> = {
  working: 'Working…',
  ask: 'Needs your input',
  done: 'Done, output ready',
};

/** One session inside Hatstand: its latest words, the last messages, a reply box, and clear/remove. */
export function SessionPanel(props: {
  profile: { id: string; name: string };
  session: SessionView;
  onBack(): void;
  onClear(): void;
  onOpenInClaude(): void;
  /** Start the mic straight away (from the menu-bar pet's Reply link). */
  listen?: boolean;
}) {
  const { profile, session } = props;
  const ref = { id: profile.id, session: session.id };
  const [detail, setDetail] = useState<Detail | undefined>();
  const [summary, setSummary] = useState<string | undefined>();
  const [reply, setReply] = useState('');
  const [sent, setSent] = useState<{ you: string; claude?: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const stamp = session.at;
  const dictation = useDictation((text) => setReply((current) => `${current} ${text}`.trim()), setError);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the first render asks for the mic.
  useEffect(() => {
    if (props.listen) void dictation.start();
  }, []);

  // Reload when the session moves on (its state file changes), e.g. after a reply.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ref` is rebuilt from these two ids.
  useEffect(() => {
    let live = true;
    api
      .request('sessionDetail', ref)
      .then((value) => live && setDetail((value as Detail | undefined) ?? { messages: [], cwd: '' }))
      .catch(() => live && setDetail({ messages: [], cwd: '' }));
    setSummary(undefined);
    api
      .request('sessionSummary', ref)
      .then((value) => live && setSummary(value as string))
      .catch(() => live && setSummary(''));
    return () => {
      live = false;
    };
  }, [profile.id, session.id, stamp]);

  async function send() {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    setSent((list) => [...list, { you: text }]);
    setReply('');
    try {
      const answer = (await api.request('sessionReply', { ...ref, text })) as string;
      setSent((list) => list.map((m, i) => (i === list.length - 1 ? { ...m, claude: answer } : m)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The reply could not be sent.');
    } finally {
      setSending(false);
    }
  }

  async function remove() {
    try {
      await api.request('sessionRemove', ref);
      props.onClear();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not remove it.');
    }
  }

  return (
    <div className="session-panel">
      <button type="button" className="text-button" onClick={props.onBack}>
        <ArrowLeft size={14} /> Back
      </button>
      <h2>{session.summary?.title || 'Claude Code session'}</h2>
      <p className="session-meta">
        <span className={`task-state ${session.state}`}>{stateLabels[session.state]}</span> · {profile.name}
      </p>
      <div className="session-summary">
        <b>Latest</b>
        <p>{summary === undefined ? 'Reading the session…' : summary || 'Nothing to summarise yet.'}</p>
      </div>
      <div className="session-messages">
        {detail?.messages.map((message, i) => (
          // The list is a fixed tail of the transcript, so position is its identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <p key={i} className={`bubble ${message.role}`}>
            <b>{message.role === 'user' ? 'You' : 'Claude'}</b> {message.text}
          </p>
        ))}
        {sent.map((message, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: replies are appended and never reordered
          <div key={i}>
            <p className="bubble user">
              <b>You</b> {message.you}
            </p>
            <p className="bubble assistant">
              <b>Claude</b> {message.claude ?? 'Working…'}
            </p>
          </div>
        ))}
      </div>
      <div className="session-reply">
        <textarea
          value={reply}
          placeholder="Reply to this session…"
          rows={3}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send();
          }}
        />
        <button
          type="button"
          className={`text-button ${dictation.state}`}
          disabled={dictation.state === 'transcribing'}
          onClick={() => void dictation.toggle()}
        >
          {dictation.state === 'listening' ? <Square size={14} /> : <Mic size={14} />}{' '}
          {dictation.state === 'listening'
            ? 'Stop'
            : dictation.state === 'transcribing'
              ? 'Transcribing…'
              : 'Speak your reply'}
        </button>
        <button
          type="button"
          className="voice-talk"
          disabled={!reply.trim() || sending}
          onClick={() => void send()}
        >
          <Send size={14} /> {sending ? 'Sending…' : 'Send reply'}
        </button>
      </div>
      {error && <p className="voice-line voice-error">{error}</p>}
      <div className="session-actions">
        <button type="button" className="text-button" onClick={props.onClear}>
          <X size={14} /> Clear from list
        </button>
        <button type="button" className="text-button" onClick={props.onOpenInClaude}>
          <ExternalLink size={14} /> Open in Claude
        </button>
        {confirmRemove ? (
          <button type="button" className="text-button danger" onClick={() => void remove()}>
            <Trash2 size={14} /> Really remove?
          </button>
        ) : (
          <button type="button" className="text-button" onClick={() => setConfirmRemove(true)}>
            <Trash2 size={14} /> Remove
          </button>
        )}
      </div>
    </div>
  );
}
