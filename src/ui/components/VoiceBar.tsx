import { Mic, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';

type Phase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';
const labels: Record<Phase, string> = {
  idle: 'Hold to talk to Codex',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  thinking: 'Codex is working…',
  speaking: 'Speaking…',
};

/** Push-to-talk: the mic goes to local speech-to-text, the words to Codex, and its answer is read back aloud. */
export function VoiceBar(props: { onSay(text: string): void }) {
  const [ready, setReady] = useState<boolean | undefined>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const recording = useRef<{ stop(): Promise<{ samples: Float32Array; rate: number }> } | undefined>(
    undefined,
  );
  const audio = useRef<HTMLAudioElement | undefined>(undefined);
  useEffect(() => {
    api
      .request('voiceStatus')
      .then((value) => setReady(value as boolean))
      .catch(() => setReady(false));
    return () => audio.current?.pause();
  }, []);

  async function start() {
    if (phase !== 'idle' || !ready) return;
    setError('');
    audio.current?.pause();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const node = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(node);
      node.connect(context.destination);
      setPhase('listening');
      recording.current = {
        async stop() {
          node.disconnect();
          source.disconnect();
          for (const track of stream.getTracks()) track.stop();
          const rate = context.sampleRate;
          await context.close();
          const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
          let at = 0;
          for (const chunk of chunks) {
            samples.set(chunk, at);
            at += chunk.length;
          }
          return { samples, rate };
        },
      };
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The microphone is not available.');
    }
  }

  async function stop() {
    const current = recording.current;
    recording.current = undefined;
    if (!current) return;
    try {
      const { samples, rate } = await current.stop();
      if (samples.length < rate * 0.4) return setPhase('idle');
      setPhase('transcribing');
      const text = ((await api.request('voiceTranscribe', { samples, rate })) as string).trim();
      setHeard(text);
      if (!text) return setPhase('idle');
      setPhase('thinking');
      props.onSay('…');
      const answer = (await api.request('voiceAsk', { text })) as string;
      setReply(answer);
      props.onSay(answer);
      if (muted || !answer) return setPhase('idle');
      setPhase('speaking');
      const wav = (await api.request('voiceSpeak', { text: answer })) as Uint8Array;
      const player = new Audio(URL.createObjectURL(new Blob([new Uint8Array(wav)], { type: 'audio/wav' })));
      audio.current = player;
      player.onended = player.onerror = () => setPhase('idle');
      await player.play();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong.');
      props.onSay('');
      setPhase('idle');
    }
  }

  if (ready === false)
    return (
      <div className="voice-bar">
        <p className="n-hint">Voice models are not installed yet.</p>
      </div>
    );
  return (
    <div className="voice-bar">
      <div className="voice-row">
        <button
          type="button"
          className={`voice-talk ${phase}`}
          disabled={!ready || (phase !== 'idle' && phase !== 'listening')}
          onPointerDown={() => void start()}
          onPointerUp={() => void stop()}
          onPointerLeave={() => void stop()}
          onKeyDown={(event) => event.key === ' ' && !event.repeat && void start()}
          onKeyUp={(event) => event.key === ' ' && void stop()}
        >
          <Mic size={16} />
          {labels[phase]}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={muted ? 'Unmute Codex' : 'Mute Codex'}
          title={muted ? 'Unmute Codex' : 'Mute Codex'}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>
      {heard && (
        <p className="voice-line">
          <b>You</b> {heard}
        </p>
      )}
      {reply && (
        <p className="voice-line">
          <b>Codex</b> {reply}
        </p>
      )}
      {error && <p className="voice-line voice-error">{error}</p>}
    </div>
  );
}
