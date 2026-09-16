// Local smoke test: only reads status and focuses already-running client profiles.
// Never signs in, creates client data, sends prompts, or closes Claude.
import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { listClaudeProcesses } from '../src/core/windows.ts';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const before=await listClaudeProcesses();
const instance=await electron.launch({executablePath:path.resolve('out/ClientDeck-win32-x64/ClientDeck.exe'),env,timeout:30_000});
try {
  const page=await instance.firstWindow();
  await page.getByRole('heading',{name:'Your clients, in place.'}).waitFor();
  let snapshot=await page.evaluate(()=>window.clientdeck.request('refresh'));
  assert.equal(snapshot.packaged,true);
  assert.equal(snapshot.profiles.length,2);
  assert.equal(snapshot.profiles.filter(p=>p.status==='running').length,2);
  for(const profile of snapshot.profiles){
    await page.evaluate(id=>window.clientdeck.request('launch',{id}),profile.id);
  }
  snapshot=await page.evaluate(()=>window.clientdeck.request('refresh'));
  assert.equal(snapshot.profiles.filter(p=>p.status==='running').length,2);
  const after=await listClaudeProcesses();
  for(const process of before)assert.ok(after.some(p=>p.pid===process.pid&&p.createdAt===process.createdAt),'Focus should reuse the same process');
  await fs.mkdir('.local/evidence',{recursive:true});
  await page.screenshot({path:'.local/evidence/packaged-two-clients.png'});
  await fs.writeFile('.local/evidence/packaged-smoke.json',JSON.stringify({packaged:true,registeredProfiles:2,runningProfiles:2,focusPreservedProcesses:true,claudeVersion:snapshot.installation?.version},null,2));
  console.log('Packaged smoke passed: two adopted profiles detected, both running, Focus reused existing processes.');
}finally{await instance.close();}
const remaining=await listClaudeProcesses();
for(const process of before)assert.ok(remaining.some(p=>p.pid===process.pid&&p.createdAt===process.createdAt),'Exiting ClientDeck should preserve Claude processes');
console.log('Exiting ClientDeck preserved the existing Claude sessions.');
