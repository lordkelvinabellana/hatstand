import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, clipboard, Notification } from 'electron';
import { transcribe } from '../core/voice.ts';

export const dictationKey = 'Control+Alt+Space';
const sound = (name: string) =>
  execFile('/usr/bin/afplay', [`/System/Library/Sounds/${name}.aiff`], () => {});
const recorderHtml = `<!doctype html><script>
let stream, context, node, source, chunks = [];
window.begin = async () => {
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  context = new AudioContext();
  source = context.createMediaStreamSource(stream);
  node = context.createScriptProcessor(4096, 1, 1);
  chunks = [];
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(context.destination);
};
window.end = async () => {
  node.disconnect(); source.disconnect();
  for (const t of stream.getTracks()) t.stop();
  const rate = context.sampleRate;
  await context.close();
  const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  let binary = '';
  const bytes = new Uint8Array(all.buffer);
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { rate, data: btoa(binary) };
};
</script>`;

/**
 * Press the shortcut to start talking, press it again to stop: the words are transcribed on this Mac and
 * typed into whatever app has focus (Claude's message box, say) by pasting. Recording happens in a hidden window.
 */
export class Dictation {
  private window?: BrowserWindow;
  private recording = false;
  private busy = false;

  constructor(private root: string) {}

  async toggle() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.recording) {
        const window = await this.recorder();
        await window.webContents.executeJavaScript('window.begin()');
        this.recording = true;
        sound('Tink');
      } else {
        this.recording = false;
        sound('Pop');
        const clip = (await this.window?.webContents.executeJavaScript('window.end()')) as {
          rate: number;
          data: string;
        };
        const bytes = Buffer.from(clip.data, 'base64');
        const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        if (samples.length < clip.rate * 0.4) return;
        const text = (await transcribe(samples, clip.rate)).trim();
        if (text) await this.paste(text);
      }
    } catch (failure) {
      this.recording = false;
      sound('Basso');
      new Notification({
        title: 'Dictation failed',
        body: failure instanceof Error ? failure.message : 'The microphone is not available.',
      }).show();
    } finally {
      this.busy = false;
    }
  }

  private async recorder() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const file = path.join(this.root, 'dictation.html');
    await fs.writeFile(file, recorderHtml);
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    window.webContents.session.setPermissionRequestHandler((_contents, permission, allow) =>
      allow(permission === 'media'),
    );
    await window.loadFile(file);
    this.window = window;
    return window;
  }

  /** Types the text where the cursor is, then puts the user's clipboard back. */
  private async paste(text: string) {
    const previous = await clipboard.readText();
    clipboard.writeText(text);
    const pasted = await new Promise<boolean>((resolve) =>
      execFile(
        '/usr/bin/osascript',
        ['-e', 'tell application "System Events" to keystroke "v" using command down'],
        (error) => resolve(!error),
      ),
    );
    if (pasted) setTimeout(() => clipboard.writeText(previous), 700);
    else
      new Notification({
        title: 'Dictation copied',
        body: 'Allow Hatstand in System Settings → Privacy → Accessibility to paste automatically. For now, press Cmd+V.',
      }).show();
  }

  dispose() {
    this.window?.destroy();
  }
}
