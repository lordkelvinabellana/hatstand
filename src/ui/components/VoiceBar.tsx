import { Ear, Mic, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parseWake, Segmenter } from '../../core/listen.ts';
import { api } from '../api.ts';

type Phase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';
const labels: Record<Phase, string> = {
  idle: 'Hold to talk to Codex',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  thinking: 'Codex is working…',
  speaking: 'Speaking…',
};
/** After Codex answers (or hears its name alone) the next phrase needs no “Hey Codex”. */
const followUpMs = 10_000;
/** How long a pause Codex waits through, after your last phrase, before it acts on what you said. */
const commandWaitMs = 5000;
const stored = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const store = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {}
};
const join = (chunks: Float32Array[]) => {
  const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    samples.set(chunk, at);
    at += chunk.length;
  }
  return samples;
};

/**
 * Talk to Codex: hold the button, or turn on Always listening and say “Hey Codex …”. The mic goes to local
 * speech-to-text, the words to Codex, and its answer is read back aloud.
 */
export function VoiceBar(props: { onSay(text: string): void }) {
  const [ready, setReady] = useState<boolean | undefined>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [always, setAlways] = useState(() => stored('hatstand.alwaysListen'));
  const [armed, setArmed] = useState(false);
  const recording = useRef<{ stop(): Promise<{ samples: Float32Array; rate: number }> } | undefined>(
    undefined,
  );
  const audio = useRef<HTMLAudioElement | undefined>(undefined);
  const busy = useRef(false);
  const armedUntil = useRef(0);
  /** Words heard after “Hey Codex” that are still waiting for the pause to end. */
  const pending = useRef({ text: '', timer: 0 });
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const onSay = useRef(props.onSay);
  onSay.current = props.onSay;
  useEffect(() => {
    api
      .request('voiceStatus')
      .then((value) => setReady(value as boolean))
      .catch(() => setReady(false));
    return () => audio.current?.pause();
  }, []);

  const arm = (on: boolean) => {
    armedUntil.current = on ? Date.now() + followUpMs : 0;
    setArmed(on);
  };

  /** Sends words to Codex and reads the answer aloud; resolves when it has finished speaking. */
  async function respond(text: string) {
    setHeard(text);
    setPhase('thinking');
    onSay.current('…');
    const answer = (await api.request('voiceAsk', { text })) as string;
    setReply(answer);
    onSay.current(answer);
    if (mutedRef.current || !answer) return;
    setPhase('speaking');
    const wav = (await api.request('voiceSpeak', { text: answer })) as Uint8Array;
    const player = new Audio(URL.createObjectURL(new Blob([new Uint8Array(wav)], { type: 'audio/wav' })));
    audio.current = player;
    await new Promise<void>((resolve) => {
      player.onended = player.onerror = () => resolve();
      player.play().catch(() => resolve());
    });
  }

  /** Sends the waiting request to Codex and speaks the answer. */
  async function send() {
    const text = pending.current.text;
    if (!text) return;
    // A phrase is still being transcribed: it may belong to this request, so look again shortly.
    if (busy.current) {
      pending.current.timer = window.setTimeout(() => void send(), 500);
      return;
    }
    pending.current.text = '';
    busy.current = true;
    try {
      setError('');
      await respond(text);
      arm(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong.');
      onSay.current('');
    } finally {
      setPhase('idle');
      busy.current = false;
    }
  }

  /** Runs one turn end to end, keeping the mic closed to the always-listening loop meanwhile. */
  async function turn(samples: Float32Array, rate: number, needWake: boolean) {
    if (busy.current) return;
    busy.current = true;
    try {
      setError('');
      setPhase('transcribing');
      const text = ((await api.request('voiceTranscribe', { samples, rate })) as string).trim();
      let command = text;
      if (needWake) {
        const wake = parseWake(text);
        if (wake.woke) command = wake.command;
        else if (!pending.current.text && Date.now() > armedUntil.current) return; // not meant for Codex: ignore silently
        if (wake.woke && !command && !pending.current.text) return arm(true);
        if (!command) return;
        // Wait through a pause: more phrases join the same request until five quiet seconds pass.
        const { current } = pending;
        window.clearTimeout(current.timer);
        current.text = `${current.text} ${command}`.trim();
        setHeard(`${current.text} …`);
        setPhase('idle');
        current.timer = window.setTimeout(() => void send(), commandWaitMs);
        return;
      }
      if (!command) return;
      await respond(command);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong.');
      onSay.current('');
    } finally {
      setPhase('idle');
      busy.current = false;
    }
  }

  // Always listening: cut the mic into phrases and hand each to `turn`, which only acts on “Hey Codex …”.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `turn` and `arm` only touch refs and setters.
  useEffect(() => {
    if (!always || !ready) return;
    let stopped = false;
    let cleanup = () => {};
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        if (stopped) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        const context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const node = context.createScriptProcessor(2048, 1, 1);
        const segmenter = new Segmenter();
        node.onaudioprocess = (event) => {
          // Not while Codex is thinking or speaking, so it never hears itself.
          if (busy.current || recording.current) return segmenter.reset();
          const phrase = segmenter.push(
            new Float32Array(event.inputBuffer.getChannelData(0)),
            context.sampleRate,
          );
          if (phrase) void turn(phrase, context.sampleRate, true);
        };
        source.connect(node);
        node.connect(context.destination);
        cleanup = () => {
          node.disconnect();
          source.disconnect();
          for (const track of stream.getTracks()) track.stop();
          void context.close();
        };
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'The microphone is not available.');
        setAlways(false);
        store('hatstand.alwaysListen', false);
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(pending.current.timer);
      pending.current.text = '';
      cleanup();
      arm(false);
    };
  }, [always, ready]);

  async function start() {
    if (busy.current || phase !== 'idle' || !ready) return;
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
          return { samples: join(chunks), rate };
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
    const { samples, rate } = await current.stop();
    if (samples.length < rate * 0.4) return setPhase('idle');
    await turn(samples, rate, false);
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
          className={`icon-button ${always ? 'on' : ''}`}
          aria-pressed={always}
          aria-label="Always listening"
          title={always ? 'Always listening: say “Hey Codex …”' : 'Turn on always listening'}
          onClick={() => {
            store('hatstand.alwaysListen', !always);
            setAlways(!always);
          }}
        >
          <Ear size={16} />
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
      {always && (
        <p className="voice-line voice-hint">
          {armed ? 'Go ahead, I’m listening…' : 'Say “Hey Codex …”. Works while this page is open.'}
        </p>
      )}
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
