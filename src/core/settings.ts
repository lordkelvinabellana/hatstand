import * as fs from 'node:fs/promises';
import path from 'node:path';
import { isRecord, assertId } from './profiles.ts';
export interface Settings {
  theme:'system'|'light'|'dark';
  minimizeToTray:boolean;
  startWithWindows:boolean;
  hotkey:string;
  executable:string;
}
export const defaults: Settings = {theme:'system',minimizeToTray:true,startWithWindows:false,hotkey:'CommandOrControl+Shift+Space',executable:''};
export function validateSettings(value: unknown): Settings {
  if (!isRecord(value) || !['system','light','dark'].includes(String(value.theme)) || typeof value.minimizeToTray!=='boolean' || typeof value.startWithWindows!=='boolean' || typeof value.hotkey!=='string' || value.hotkey.length>80 || typeof value.executable!=='string') throw new Error('Invalid settings.');
  return {theme:value.theme as Settings['theme'],minimizeToTray:value.minimizeToTray,startWithWindows:value.startWithWindows,hotkey:value.hotkey,executable:value.executable};
}
export async function readSettings(root: string): Promise<Settings> {
  try { return validateSettings(JSON.parse(await fs.readFile(path.join(root,'settings.json'),'utf8'))); }
  catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return {...defaults}; throw error; }
}
export async function saveSettings(root: string, settings: Settings) {
  await fs.mkdir(root,{recursive:true});
  const file=path.join(root,'settings.json');
  await fs.writeFile(file+'.tmp',JSON.stringify(validateSettings(settings),null,2));
  await fs.rename(file+'.tmp',file);
}
// Local bindings adopt the same existing test profiles, without moving or copying
// credentials. They never participate in metadata export or normal imports.
export async function readBindings(root: string): Promise<Record<string,string>> {
  try {
    const values: unknown = JSON.parse(await fs.readFile(path.join(root,'bindings.json'),'utf8'));
    if (!isRecord(values)) throw new Error('Invalid local profile bindings.');
    const bindings: Record<string,string> = {};
    for (const [id,folder] of Object.entries(values)) {
      assertId(id);
      if (typeof folder!=='string' || !path.isAbsolute(folder)) throw new Error('Invalid profile folder.');
      bindings[id]=folder;
    }
    return bindings;
  } catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return {}; throw error; }
}
