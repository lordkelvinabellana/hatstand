import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const source = `import CoreAudio
var dev = AudioObjectID(0)
var size = UInt32(MemoryLayout<AudioObjectID>.size)
var a = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &dev)
var on = UInt32(0)
size = 4
a.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere
AudioObjectGetPropertyData(dev, &a, 0, nil, &size, &on)
print(on)
`;
const binary = path.join(os.tmpdir(), 'hatstand-mic-check');
let ready: Promise<boolean> | undefined;

/** Compiles the checker once (a second or two); false when there is no Swift toolchain. */
const compile = () =>
  (ready ??= (async () => {
    if (fs.existsSync(binary)) return true;
    const src = `${binary}.swift`;
    try {
      fs.writeFileSync(src, source);
      await run('/usr/bin/swiftc', [src, '-o', binary]);
      return true;
    } catch {
      return false;
    }
  })());

/** Whether any app is recording from the default microphone. Anything unknown counts as "not recording". */
export async function micInUse(): Promise<boolean> {
  if (process.platform !== 'darwin' || !(await compile())) return false;
  try {
    return (await run(binary, [])).stdout.trim() === '1';
  } catch {
    return false;
  }
}
