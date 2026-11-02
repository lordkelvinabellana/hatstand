// Spike: speak a sentence with Kokoro, then transcribe the audio with Whisper. Run with Hatstand's Node (ELECTRON_RUN_AS_NODE=1).
import os from 'node:os';
import path from 'node:path';
import sherpa from 'sherpa-onnx-node';

const models = path.join(os.homedir(), 'Library/Application Support/HatstandData/voice-models');
const k = path.join(models, 'kokoro-int8-en-v0_19');
const w = path.join(models, 'sherpa-onnx-whisper-base.en');
const text = process.argv[2] || 'North Studio needs your input on the Oak Media thread.';

let t = Date.now();
const tts = new sherpa.OfflineTts({
  model: { kokoro: { model: path.join(k, 'model.int8.onnx'), voices: path.join(k, 'voices.bin'), tokens: path.join(k, 'tokens.txt'), dataDir: path.join(k, 'espeak-ng-data') }, numThreads: 2, provider: 'cpu' },
  maxNumSentences: 1,
});
const audio = tts.generate({ text, sid: 0, speed: 1.0 });
console.log(`TTS ${((Date.now() - t) / 1000).toFixed(1)}s, ${(audio.samples.length / audio.sampleRate).toFixed(1)}s of audio, ${tts.numSpeakers} voices`);
sherpa.writeWave('/tmp/voice-spike.wav', audio);

t = Date.now();
const rec = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: { whisper: { encoder: path.join(w, 'base.en-encoder.int8.onnx'), decoder: path.join(w, 'base.en-decoder.int8.onnx'), language: 'en', task: 'transcribe', tailPaddings: -1 }, tokens: path.join(w, 'base.en-tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0 },
});
const stream = rec.createStream();
stream.acceptWaveform({ sampleRate: audio.sampleRate, samples: audio.samples });
rec.decode(stream);
console.log(`STT ${((Date.now() - t) / 1000).toFixed(1)}s: "${rec.getResult(stream).text.trim()}"`);
