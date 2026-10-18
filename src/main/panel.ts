import { createHash } from 'node:crypto';
import path from 'node:path';
import { modelName, type SessionState, type SessionSummary } from '../core/pets.ts';
import type { Mood } from '../core/sprites.ts';

/** The pet's session panel as a self-contained page; no Electron imports, so it can be previewed. */
const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;
const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
function ago(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}
const stateLabels = { ask: 'Needs your input', done: 'Done', working: 'Working' };

export interface PanelSession {
  id: string;
  session: SessionState;
  summary?: SessionSummary;
}
const reportScript =
  "const report=()=>{document.title=JSON.stringify({height:document.body.scrollHeight,open:[...document.querySelectorAll('details[open]')].map((d)=>d.id)})};document.addEventListener('toggle',report,true);";
const reportHash = createHash('sha256').update(reportScript).digest('base64');

export function panelHtml(
  pet: { profile: { name: string }; mood: Mood },
  labels: Record<Mood, string>,
  sessions: PanelSession[],
  icon: string,
  expanded?: string[],
) {
  const cards = sessions.map(({ id, session, summary }, index) => {
    const open = expanded ? expanded.includes(id) : index === 0;
    const plan = summary?.plan ?? [];
    const finished = plan.filter((s) => s.status === 'completed').length;
    // Up to seven steps around the current one.
    const current = Math.max(
      0,
      plan.findIndex((s) => s.status !== 'completed'),
    );
    const first = Math.max(0, Math.min(current - 2, plan.length - 7));
    const steps = plan
      .slice(first, first + 7)
      .map((s) => `<li class="${s.status}">${esc(clip(s.content, 60))}</li>`)
      .join('');
    const usage = summary
      ? [
          `Context ${tokens(summary.context)}`,
          `Output ${tokens(summary.output)}`,
          summary.model ? modelName(summary.model) : '',
        ].filter(Boolean)
      : [];
    return `<details class="session" id="${id}"${open ? ' open' : ''}>
      <summary><span class="dot ${session.state}"></span><b>${esc(clip(summary?.title || 'Claude session', 48))}</b><span class="when">${plan.length ? `${finished}/${plan.length} · ` : ''}${ago(session.at)}</span></summary>
      <div class="body"><div class="meta">${stateLabels[session.state]}${summary?.cwd ? ` · ${esc(clip(path.basename(summary.cwd), 40))}` : ''}</div>
      ${summary?.prompt ? `<div class="prompt">${esc(clip(summary.prompt, 140))}</div>` : ''}
      ${plan.length ? `<div class="progress"><span style="width:${Math.round((finished / plan.length) * 100)}%"></span></div><div class="meta">${finished} of ${plan.length} tasks done</div><ol>${steps}</ol>` : ''}
      ${summary?.background ? `<div class="meta">${summary.background} background task${summary.background > 1 ? 's' : ''} running</div>` : ''}
      ${usage.length ? `<div class="usage">${usage.map(esc).join(' · ')}</div>` : ''}
      <a class="go" href="hatstand-pet://open/${id}">Open in Claude</a></div>
    </details>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'sha256-${reportHash}'">
<style>
:root { --bg: rgba(250,250,248,.97); --fg: #1d2421; --muted: #66706b; --line: rgba(0,0,0,.08); --track: rgba(0,0,0,.08); }
@media (prefers-color-scheme: dark) { :root { --bg: rgba(32,36,34,.97); --fg: #eef2f0; --muted: #9aa5a0; --line: rgba(255,255,255,.08); --track: rgba(255,255,255,.12); } }
html, body { margin: 0; background: transparent; }
body { font: 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; color: var(--fg); padding: 4px; cursor: default; user-select: none; }
.card { background: var(--bg); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
header img { width: 32px; height: 32px; image-rendering: pixelated; }
header div { display: flex; flex-direction: column; }
header b { font-size: 13px; }
header span { color: var(--muted); }
a { color: inherit; text-decoration: none; }
.open { margin-left: auto; padding: 4px 10px; border-radius: 6px; background: var(--track); font-weight: 600; }
.open:hover { background: var(--line); }
.session { border-bottom: 1px solid var(--line); }
.session:last-child { border-bottom: 0; }
summary { display: flex; align-items: center; gap: 6px; padding: 8px 12px; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::after { content: "›"; color: var(--muted); transition: transform .15s; margin-left: 2px; }
.session[open] summary::after { transform: rotate(90deg); }
summary:hover { background: var(--track); }
summary b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { padding: 0 12px 10px 26px; }
.go { display: inline-block; margin-top: 8px; padding: 3px 9px; border-radius: 6px; background: var(--track); font-weight: 600; }
.go:hover { background: var(--line); }
.when { margin-left: auto; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dot.ask { background: #ff5a36; } .dot.done { background: #22b35e; } .dot.working { background: #5fa2ea; }
.meta { color: var(--muted); }
.prompt { margin-top: 6px; padding-left: 8px; border-left: 2px solid var(--line); color: var(--muted); }
.progress { height: 4px; border-radius: 2px; background: var(--track); margin-top: 8px; overflow: hidden; }
.progress span { display: block; height: 100%; background: #22b35e; }
ol { list-style: none; margin: 6px 0 0; padding: 0; }
li { padding-left: 18px; position: relative; margin: 2px 0; }
li::before { position: absolute; left: 2px; }
li.completed { color: var(--muted); text-decoration: line-through; } li.completed::before { content: "✓"; color: #22b35e; }
li.in_progress { font-weight: 600; } li.in_progress::before { content: "▸"; color: #5fa2ea; }
li.pending::before { content: "○"; color: var(--muted); }
.usage { margin-top: 8px; color: var(--muted); font-variant-numeric: tabular-nums; }
.empty { padding: 12px; color: var(--muted); margin: 0; }
</style></head><body><div class="card">
<header><img src="data:image/png;base64,${icon}" alt=""><div><b>${esc(pet.profile.name)}</b><span>${labels[pet.mood]}</span></div><a class="open" href="hatstand-pet://open">${pet.mood === 'sleep' ? 'Launch' : 'Open'} Claude</a></header>
${cards.join('') || '<p class="empty">No active sessions.</p>'}
</div><script>${reportScript}</script></body></html>`;
}
