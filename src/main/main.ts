import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { ProfileStore } from '../core/store.ts';
import { assertId, exportMetadata, isRecord, parseImport } from '../core/profiles.ts';
import { ensurePlainDirectory, ownsProcess, profilePaths } from '../core/launch.ts';
import { defaults, readBindings, readSettings, saveSettings, validateSettings } from '../core/settings.ts';
import type { Settings } from '../core/settings.ts';
import { closeOwnedProcess, detectInstallation, launchClaude, listClaudeProcesses } from '../core/windows.ts';
import type { Installation, RunningProcess } from '../core/windows.ts';
import type { ProfileStatus, Snapshot } from '../shared.ts';

const testMode = process.env.CLIENTDECK_TEST_MODE === '1' && !app.isPackaged;
const root = testMode && process.env.CLIENTDECK_TEST_ROOT ? path.resolve(process.env.CLIENTDECK_TEST_ROOT) : path.join(process.env.LOCALAPPDATA ?? path.join(app.getPath('appData'),'..','Local'),'ClientDeck');
app.setPath('userData',path.join(root,'manager'));
const store = new ProfileStore(root);
let window: BrowserWindow;
let tray: Tray;
let quitting = false;
let settings: Settings = {...defaults};
let bindings: Record<string,string> = {};
let installation: Installation|null = null;
let installationError = '';
let processError = '';
let hotkeyError = '';
let processes: RunningProcess[] = [];
let refreshing: Promise<void>|undefined;
const busy = new Set<string>();
const transitions = new Map<string,{status:ProfileStatus;since:number;message?:string}>();
let pendingImport: ReturnType<typeof parseImport>|null = null;
const html = path.join(__dirname,'index.html');

function notify() { if (window && !window.isDestroyed()) window.webContents.send('clientdeck:changed'); }
function show() { if (window.isMinimized()) window.restore(); window.show(); window.focus(); window.webContents.send('clientdeck:changed'); }
function directories(id: string) {
  assertId(id);
  const bound = bindings[id];
  return bound ? {base:bound,desktop:path.join(bound,'desktop'),code:path.join(bound,'code')} : profilePaths(root,id);
}
function owned(id: string) { return installation ? processes.find(p=>ownsProcess(p,installation!.executable,directories(id).desktop)) : undefined; }
async function getProfile(id: string) {
  assertId(id);
  const profile=(await store.load()).profiles.find(p=>p.id===id);
  if (!profile) throw new Error('This profile no longer exists.');
  return profile;
}
async function log(action: string,id?:string) {
  const folder=path.join(root,'logs');
  await fs.mkdir(folder,{recursive:true});
  const file=path.join(folder,'manager.log');
  try { if ((await fs.stat(file)).size>500_000) await fs.rename(file,file+'.previous'); } catch {}
  await fs.appendFile(file,JSON.stringify({time:new Date().toISOString(),action,id})+'\n');
}
async function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing=(async()=>{
    try { processes=await listClaudeProcesses(); processError=''; }
    catch { processes=[];processError='Could not read Claude process status. Check that Windows PowerShell is available, then refresh.'; }
    for (const [id,transition] of transitions) {
      if (transition.status==='starting' && owned(id)) transitions.delete(id);
      else if (transition.status==='closing' && !owned(id) && !processError) transitions.delete(id);
      else if (transition.status==='starting' && Date.now()-transition.since>20_000) transitions.set(id,{status:'error',since:Date.now(),message:'Claude did not start with this profile. Refresh the installation in Settings and try again.'});
    }
    await updateTray();
    notify();
  })().finally(()=>{refreshing=undefined;});
  return refreshing;
}
async function snapshot(): Promise<Snapshot> {
  const state=await store.load();
  return {profiles:state.profiles.map(p=>({...p,directory:directories(p.id).base,
    status:processError?'unknown':transitions.get(p.id)?.status ?? (owned(p.id)?'running':'stopped'),message:transitions.get(p.id)?.message,
  })),settings,installation,installationError,processError,hotkeyError,version:app.getVersion(),packaged:app.isPackaged};
}
async function launch(id: string) {
  const profile=await getProfile(id);
  if (profile.archived) throw new Error('Restore this profile before launching it.');
  if (busy.has(id)) return;
  busy.add(id);
  try {
    // Rediscover at every launch because Claude's update can replace its path.
    installation=await detectInstallation(settings.executable);
    if (!installation) throw new Error('Install Claude Desktop or choose Claude.exe in Settings.');
    const paths=directories(id);
    await ensurePlainDirectory(paths.desktop);
    await ensurePlainDirectory(paths.code);
    transitions.set(id,{status:'starting',since:Date.now()});notify();
    await launchClaude(installation,paths.desktop,paths.code);
    await log('launch',id);
    await new Promise(resolve=>setTimeout(resolve,1200));
    await refresh();
  } catch(error) {
    transitions.set(id,{status:'error',since:Date.now(),message:(error as Error).message});notify();throw error;
  } finally {busy.delete(id);}
}
async function close(id: string,force=false) {
  await getProfile(id);
  await refresh();
  const process=owned(id);
  if (!process || !installation) return;
  if (force) {
    const answer=await dialog.showMessageBox(window,{type:'warning',buttons:['Cancel','Force close'],defaultId:0,cancelId:0,message:'Force close this client’s Claude instance?',detail:'An active task may be interrupted. This targets only the selected profile’s process tree.'});
    if (answer.response!==1) return;
  }
  transitions.set(id,{status:'closing',since:Date.now()});notify();
  try {await closeOwnedProcess(installation,directories(id).desktop,process,force);await log(force?'force-close':'close',id);}
  finally {transitions.delete(id);await refresh();}
  if (owned(id) && !force) throw new Error('Claude is still running, possibly in its tray. Use File → Exit in that Claude window, or choose Force close if it has no active work.');
}
async function updateTray() {
  if (!tray) return;
  const profiles=(await store.load()).profiles.filter(p=>!p.archived);
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Open ClientDeck',click:show},{type:'separator'},
    ...profiles.map(p=>({label:`${owned(p.id)?'Focus':'Launch'} ${p.name}`,click:()=>{void launch(p.id).catch(()=>show());}})),
    {type:'separator'},{label:'Quit ClientDeck',click:()=>{quitting=true;app.quit();}},
  ]));
}
function registerHotkey() {
  globalShortcut.unregisterAll();hotkeyError='';
  if (settings.hotkey) {
    try {if (!globalShortcut.register(settings.hotkey,show)) hotkeyError='That shortcut is already in use. Choose another in Settings.';}
    catch {hotkeyError='That shortcut is not valid. Try CommandOrControl+Shift+Space.';}
  }
}
async function pickExecutable() {
  const result=await dialog.showOpenDialog(window,{title:'Choose installed Claude Desktop',properties:['openFile'],filters:[{name:'Claude executable',extensions:['exe']}]});
  if (result.canceled) return null;
  await detectInstallation(result.filePaths[0]);
  return result.filePaths[0];
}
function readId(payload: unknown): string {
  if (!isRecord(payload)) throw new Error('Invalid request.');assertId(payload.id);return payload.id;
}
async function handle(action: string,payload: unknown): Promise<unknown> {
  switch(action) {
    case 'snapshot': return snapshot();
    case 'refresh':
      try {installation=await detectInstallation(settings.executable);installationError='';}
      catch {installationError='Claude installation could not be located. Choose Claude.exe in Settings.';}
      await refresh();return snapshot();
    case 'create': {const result=await store.create(payload);await updateTray();notify();return result;}
    case 'edit': {const id=readId(payload);await store.update(id,(payload as Record<string,unknown>).input);await updateTray();notify();return;}
    case 'archive': {const id=readId(payload);const value=(payload as Record<string,unknown>).archived;if(typeof value!=='boolean') throw new Error('Invalid archive request.');await store.archive(id,value);await updateTray();notify();return;}
    case 'reorder': {if(!isRecord(payload)||!Array.isArray(payload.ids)) throw new Error('Invalid order.');await store.reorder(payload.ids);notify();return;}
    case 'remove': {
      const id=readId(payload);const profile=await getProfile(id);
      const result=await dialog.showMessageBox(window,{type:'question',buttons:['Cancel','Remove profile'],defaultId:0,cancelId:0,message:`Remove ${profile.name} from ClientDeck?`,detail:'Its Claude data stays on this computer. This does not delete the account or cloud conversations.'});
      if(result.response===1){await store.remove(id);await updateTray();notify();}return;
    }
    case 'launch': return launch(readId(payload));
    case 'close': return close(readId(payload));
    case 'forceClose': return close(readId(payload),true);
    case 'restart': {const id=readId(payload);await close(id);return launch(id);}
    case 'openFolder': {const id=readId(payload);await getProfile(id);const folder=directories(id).base;await ensurePlainDirectory(folder);const error=await shell.openPath(folder);if(error)throw new Error(error);return;}
    case 'shortcut': {
      if(!app.isPackaged)throw new Error('Shortcuts are available in the packaged app.');
      const id=readId(payload);const profile=await getProfile(id);
      const name=profile.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,60)||'Client';
      const file=path.join(app.getPath('desktop'),`ClientDeck - ${name} - ${id.slice(0,6)}.lnk`);
      if(!shell.writeShortcutLink(file,'create',{target:process.execPath,args:`--profile=${id}`,description:`Open ${profile.name} in Claude Desktop`,icon:process.execPath,iconIndex:0}))throw new Error('Windows could not create the shortcut.');
      return;
    }
    case 'pickExecutable': return pickExecutable();
    case 'settings': {
      const next=validateSettings(payload);
      if(next.executable)await detectInstallation(next.executable);
      if(next.startWithWindows&&!app.isPackaged)throw new Error('Startup is available in the packaged app.');
      await saveSettings(root,next);settings=next;nativeTheme.themeSource=settings.theme;
      if(app.isPackaged)app.setLoginItemSettings({openAtLogin:settings.startWithWindows,path:process.execPath,args:['--background']});
      registerHotkey();installation=await detectInstallation(settings.executable);notify();return;
    }
    case 'export': {
      const result=await dialog.showSaveDialog(window,{title:'Export profile labels and colors',defaultPath:'clientdeck-profiles.json',filters:[{name:'JSON',extensions:['json']}]});
      if(result.canceled||!result.filePath)return;
      await fs.writeFile(result.filePath,exportMetadata(await store.load()),{mode:0o600});return;
    }
    case 'chooseImport': {
      pendingImport=null;
      const result=await dialog.showOpenDialog(window,{title:'Import profile labels and colors',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});
      if(result.canceled)return null;
      if((await fs.stat(result.filePaths[0])).size>1_000_000)throw new Error('Import is too large.');
      pendingImport=parseImport(await fs.readFile(result.filePaths[0],'utf8'));return pendingImport;
    }
    case 'confirmImport': {if(!pendingImport)throw new Error('Choose a file first.');const inputs=pendingImport;pendingImport=null;await store.importProfiles(inputs);await updateTray();notify();return;}
    case 'diagnostics': return {appVersion:app.getVersion(),platform:process.platform,architecture:process.arch,claudeVersion:installation?.version??null,installType:installation?.kind??null,profileCount:(await store.load()).profiles.length,managedProcessCount:processes.filter(p=>(installation&&(Object.keys(bindings).some(id=>ownsProcess(p,installation!.executable,directories(id).desktop)))||false)).length,statusReadable:!processError,compatibility:{parallelLaunch:'observed on 1.52386.6.0',twoAccountSignIn:'user-confirmed',cowork:'unverified',desktopCode:'unverified',rebootPersistence:'unverified'}};
    case 'exportDiagnostics': {
      const result=await dialog.showSaveDialog(window,{title:'Save the displayed diagnostic summary',defaultPath:'clientdeck-diagnostics.json'});
      if(!result.canceled&&result.filePath)await fs.writeFile(result.filePath,JSON.stringify(await handle('diagnostics',null),null,2));return;
    }
    case 'downloadClaude': await shell.openExternal('https://claude.com/download');return;
    default: throw new Error('Unknown request.');
  }
}

// Squirrel calls the application for shortcut lifecycle events during setup.
const squirrelEvent=process.argv.find(arg=>arg.startsWith('--squirrel-'));
const lock=!squirrelEvent&&app.requestSingleInstanceLock();
if(squirrelEvent) {
  const operation=squirrelEvent==='--squirrel-install'||squirrelEvent==='--squirrel-updated'?'--createShortcut':squirrelEvent==='--squirrel-uninstall'?'--removeShortcut':null;
  if(operation){
    const update=path.resolve(path.dirname(process.execPath),'..','Update.exe');
    const child=spawn(update,[operation,path.basename(process.execPath)],{windowsHide:true,stdio:'ignore'});
    child.once('error',()=>app.quit());child.once('exit',()=>app.quit());
  } else app.quit();
} else if(!lock) app.quit();
else {
  app.on('second-instance',(_event,args)=>{if(window)show();const id=args.find(arg=>arg.startsWith('--profile='))?.slice(10);if(id)void launch(id).catch(()=>notify());});
  app.on('before-quit',()=>{quitting=true;});
  app.on('will-quit',()=>globalShortcut.unregisterAll());
  app.whenReady().then(async()=>{
    try {
      await ensurePlainDirectory(root);
      settings=await readSettings(root);bindings=await readBindings(root);await store.load();
      nativeTheme.themeSource=settings.theme;
      try{installation=await detectInstallation(settings.executable);}catch{installationError='Could not locate Claude. Choose Claude.exe in Settings.';}
      app.setAppUserModelId('com.squirrel.ClientDeck.ClientDeck');
      window=new BrowserWindow({width:1120,height:780,minWidth:760,minHeight:580,show:false,title:'ClientDeck',icon:path.join(__dirname,'..','resources','clientdeck.ico'),backgroundColor:'#f7f7f2',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
      Menu.setApplicationMenu(null);
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-navigate',(event)=>event.preventDefault());
      window.on('close',event=>{if(!quitting&&settings.minimizeToTray){event.preventDefault();window.hide();}});
      window.on('closed',()=>{if(!quitting){quitting=true;app.quit();}});
      ipcMain.handle('clientdeck:request',async(event,request:unknown)=>{
        if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==pathToFileURL(html).href)return {ok:false,error:'Request rejected.'};
        try {if(!isRecord(request)||typeof request.action!=='string')throw new Error('Invalid request.');return {ok:true,value:await handle(request.action,request.payload)};}
        catch(error) {return {ok:false,error:(error as Error).message || 'The operation failed. Try again.'};}
      });
      // Original geometric mark, generated from pixels; no remote resources.
      const pixels=Buffer.alloc(24*24*4);
      for(let y=0;y<24;y++)for(let x=0;x<24;x++) {const index=(y*24+x)*4;const ink=(x>=4&&x<=8&&y>=4&&y<=19)||(x>=8&&x<=19&&((y>=4&&y<=8)||(y>=15&&y<=19)));pixels[index]=ink?72:0;pixels[index+1]=ink?178:0;pixels[index+2]=ink?155:0;pixels[index+3]=ink?255:0;}
      tray=new Tray(nativeImage.createFromBuffer(pixels,{width:24,height:24}));tray.setToolTip('ClientDeck');tray.on('click',show);
      await window.loadFile(html);await refresh();registerHotkey();
      if(!process.argv.includes('--background'))show();
      const id=process.argv.find(arg=>arg.startsWith('--profile='))?.slice(10);if(id)void launch(id).catch(()=>show());
      const timer=setInterval(()=>{void refresh().catch(()=>{});},8000);timer.unref();
    } catch(error) {dialog.showErrorBox('ClientDeck could not start',(error as Error).message);quitting=true;app.quit();}
  });
}
