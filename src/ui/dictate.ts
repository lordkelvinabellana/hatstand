import { useRef, useState } from 'react';
import { api } from './api.ts';

const join = (chunks: Float32Array[]) => {
  const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    samples.set(chunk, at);
    at += chunk.length;
  }
  return samples;
};

/** Click to start, click to stop: the mic goes to local speech-to-text and `onText` gets the words. */
export function useDictation(onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<'idle' | 'listening' | 'transcribing'>('idle');
  const stopper = useRef<(() => Promise<{ samples: Float32Array; rate: number }>) | undefined>(undefined);

  async function start() {
    if (stopper.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const node = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(node);
      node.connect(context.destination);
      stopper.current = async () => {
        node.disconnect();
        source.disconnect();
        for (const track of stream.getTracks()) track.stop();
        const rate = context.sampleRate;
        await context.close();
        return { samples: join(chunks), rate };
      };
      setState('listening');
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'The microphone is not available.');
    }
  }

  async function stop() {
    const finish = stopper.current;
    stopper.current = undefined;
    if (!finish) return;
    const { samples, rate } = await finish();
    if (samples.length < rate * 0.4) return setState('idle');
    setState('transcribing');
    try {
      const text = ((await api.request('voiceTranscribe', { samples, rate })) as string).trim();
      if (text) onText(text);
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Could not transcribe that.');
    } finally {
      setState('idle');
    }
  }

  return { state, start, stop, toggle: () => (stopper.current ? stop() : start()) };
}
