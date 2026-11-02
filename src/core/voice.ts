import { spawn as defaultSpawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { dataRoot } from './paths.ts';

const require = createRequire(import.meta.url);
export function modelsDir(): string {
  const base =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(dataRoot(base), 'voice-models');
}

export async function voiceReady(): Promise<boolean> {
  const files = [
    'sherpa-onnx-whisper-base.en/base.en-encoder.int8.onnx',
    'sherpa-onnx-whisper-base.en/base.en-decoder.int8.onnx',
    'sherpa-onnx-whisper-base.en/base.en-tokens.txt',
    'kokoro-int8-en-v0_19/model.int8.onnx',
    'kokoro-int8-en-v0_19/voices.bin',
    'kokoro-int8-en-v0_19/tokens.txt',
    'kokoro-int8-en-v0_19/espeak-ng-data',
  ];
  return (
    await Promise.all(
      files.map((file) =>
        fs.access(path.join(modelsDir(), file)).then(
          () => true,
          () => false,
        ),
      ),
    )
  ).every(Boolean);
}

interface Recognizer {
  createStream(): { acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void };
  decode(stream: ReturnType<Recognizer['createStream']>): void;
  getResult(stream: ReturnType<Recognizer['createStream']>): { text: string };
}
let recognizer: Recognizer | undefined;
export async function transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
  if (!recognizer) {
    const sherpa = require('sherpa-onnx-node');
    const w = path.join(modelsDir(), 'sherpa-onnx-whisper-base.en');
    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        whisper: {
          encoder: path.join(w, 'base.en-encoder.int8.onnx'),
          decoder: path.join(w, 'base.en-decoder.int8.onnx'),
          language: 'en',
          task: 'transcribe',
          tailPaddings: -1,
        },
        tokens: path.join(w, 'base.en-tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
    }) as Recognizer;
  }
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate, samples });
  recognizer.decode(stream);
  return recognizer.getResult(stream).text.trim();
}

export function findNode(
  env: NodeJS.ProcessEnv = process.env,
  paths: string[] = ['/opt/homebrew/bin', '/usr/local/bin'],
  exists: (file: string) => boolean = (file) => {
    try {
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
): string | undefined {
  return [...(env.PATH || '').split(path.delimiter).filter(Boolean), ...paths]
    .map((dir) => path.join(dir, 'node'))
    .find(exists);
}

const ttsScript = `
const sherpa = require(process.argv[1]);
const path = require('node:path');
const k = process.argv[2];
const tts = new sherpa.OfflineTts({
  model: { kokoro: { model: path.join(k, 'model.int8.onnx'), voices: path.join(k, 'voices.bin'), tokens: path.join(k, 'tokens.txt'), dataDir: path.join(k, 'espeak-ng-data') }, numThreads: 2, provider: 'cpu' },
  maxNumSentences: 1,
});
sherpa.writeWave(process.argv[3], tts.generate({ text: process.argv[4], sid: 0, speed: 1.0 }));
`;
export async function speak(
  text: string,
  outFile: string,
  spawner: typeof defaultSpawn = defaultSpawn,
  nodeFinder: () => string | undefined = findNode,
): Promise<string> {
  text = text.slice(0, 600);
  const run = (command: string, args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const child = spawner(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-4096);
      });
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr}`)),
      );
    });
  try {
    const node = nodeFinder();
    if (!node) throw new Error('No Node binary found for Kokoro TTS.');
    await run(node, [
      '-e',
      ttsScript,
      require.resolve('sherpa-onnx-node'),
      path.join(modelsDir(), 'kokoro-int8-en-v0_19'),
      outFile,
      text,
    ]);
  } catch (error) {
    if (process.platform !== 'darwin') throw error;
    await run('say', ['-o', outFile, '--data-format=LEI16@22050', '--', text]);
  }
  return outFile;
}
