/** Always-listening helpers, pure so they can be tested: cutting the mic stream into spoken phrases, and spotting the wake word. */

const preRoll = 8;
const hangMs = 700;
const longestMs = 15_000;
const shortestMs = 400;

/**
 * Cuts a stream of mic chunks into phrases with a plain loudness gate that adapts to the room's noise.
 * `push` returns a finished phrase (with a little lead-in) once the speaker pauses, otherwise undefined.
 */
export class Segmenter {
  private floor = 0.005;
  private lead: Float32Array[] = [];
  private heard: Float32Array[] = [];
  private speaking = false;
  private silentMs = 0;
  private totalMs = 0;

  reset() {
    this.lead = [];
    this.heard = [];
    this.speaking = false;
    this.silentMs = 0;
    this.totalMs = 0;
  }

  push(chunk: Float32Array, rate: number): Float32Array | undefined {
    let sum = 0;
    for (const sample of chunk) sum += sample * sample;
    const level = Math.sqrt(sum / chunk.length);
    const ms = (chunk.length / rate) * 1000;
    const loud = level > Math.max(0.012, this.floor * 3);
    if (!this.speaking) {
      if (!loud) {
        this.floor = this.floor * 0.95 + level * 0.05;
        this.lead.push(chunk);
        if (this.lead.length > preRoll) this.lead.shift();
        return undefined;
      }
      this.speaking = true;
      this.heard = [...this.lead];
      this.lead = [];
      this.silentMs = 0;
      this.totalMs = 0;
    }
    this.heard.push(chunk);
    this.totalMs += ms;
    this.silentMs = loud ? 0 : this.silentMs + ms;
    if (this.silentMs < hangMs && this.totalMs < longestMs) return undefined;
    const spoken = this.totalMs - this.silentMs;
    const samples = new Float32Array(this.heard.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const part of this.heard) {
      samples.set(part, at);
      at += part.length;
    }
    this.reset();
    return spoken >= shortestMs ? samples : undefined;
  }
}

const wake = /^\W*(?:(?:hey|hi|ok|okay|yo|hello)\W+)?(?:codex|codecs|codec|kodex|codeks|code x)\b\W*(.*)$/is;
/** Whether a transcript starts with “Hey Codex” (or a close spelling), and what follows it. */
export function parseWake(text: string): { woke: boolean; command: string } {
  const match = wake.exec(text.trim());
  return match ? { woke: true, command: match[1].trim() } : { woke: false, command: '' };
}
