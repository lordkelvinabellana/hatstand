import { useState } from 'react';
import { ArrowUpRight, CloudUpload, Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import { syncGuideUrl } from '../../core/project.ts';
import type { Settings } from '../../core/settings.ts';
import type { ProfileInput } from '../../core/profiles.ts';
import type { StorageFolder, UpdateCheck } from '../../shared.ts';
import { formatBytes, useApp, isMac, trashName } from '../api.ts';
import { ShortcutInput } from './ShortcutInput.tsx';

const downloadUrl = 'https://claude.com/download';

export function SettingsPage() {
  const { data, pending, run, fire } = useApp();
  const [settings, setSettings] = useState<Settings>({ ...data.settings });
  const [importPreview, setImportPreview] = useState<ProfileInput[] | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [storage, setStorage] = useState<StorageFolder[] | null>(null);
  const [sync, setSync] = useState({
    syncUrl: data.settings.syncUrl,
    syncKey: data.settings.syncKey,
    syncEmail: data.settings.syncEmail,
  });
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  // Saves only the sync fields, so other unsaved edits on this page stay in their form.
  const saveSync = (syncEnabled: boolean) => run('settings', { ...data.settings, ...sync, syncEnabled });
  const leftovers = storage?.filter((folder) => !folder.registered) ?? [];

  function loadStorage() {
    void run('storage')
      .then((value) => setStorage(value as StorageFolder[]))
      .catch(() => {});
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Make it your workspace.</h1>
          <p>Small preferences for everyday switching.</p>
        </div>
      </div>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          fire('settings', settings, 'Settings saved.');
        }}
      >
        <section className="setting-section">
          <h2>Appearance</h2>
          <div className="setting-row">
            <div>
              <label htmlFor="theme">Theme</label>
              <p>Follow your system or choose your own. Changes apply right away.</p>
            </div>
            <select
              id="theme"
              value={settings.theme}
              onChange={(e) => {
                const theme = e.target.value as Settings['theme'];
                setSettings({ ...settings, theme });
                // Applies right away; only the theme is saved, other unsaved edits stay in the form.
                fire('settings', { ...data.settings, theme });
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </section>
        {isMac && (
          <section className="setting-section">
            <h2>Menu-bar pets</h2>
            <label className="setting-row">
              <span>
                Show a pet for each profile
                <small>Shows when that account’s Claude Code is working, needs you, or is done.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.pets}
                onChange={(e) => setSettings({ ...settings, pets: e.target.checked })}
              />
            </label>
            <label className="setting-row">
              <span>
                Pet sounds
                <small>A short jingle in each pet’s own key when an account needs you or finishes.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.petSounds}
                disabled={!settings.pets}
                onChange={(e) => setSettings({ ...settings, petSounds: e.target.checked })}
              />
            </label>
          </section>
        )}
        <section className="setting-section">
          <h2>Daily workflow</h2>
          <label className="setting-row">
            <span>
              Keep Hatstand in the {isMac ? 'menu bar' : 'tray'}
              <small>Closing this window keeps switching available.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.minimizeToTray}
              onChange={(e) => setSettings({ ...settings, minimizeToTray: e.target.checked })}
            />
          </label>
          <label className="setting-row">
            <span>
              {isMac ? 'Start at login' : 'Start with Windows'}
              <small>
                {data.packaged
                  ? 'Opens Hatstand in the background, plus your startup profiles.'
                  : 'Available in the installed app.'}
              </small>
            </span>
            <input
              type="checkbox"
              disabled={!data.packaged}
              checked={settings.startWithWindows}
              onChange={(e) => setSettings({ ...settings, startWithWindows: e.target.checked })}
            />
          </label>
          <ShortcutInput
            id="manager-hotkey"
            label="Global shortcut"
            value={settings.hotkey}
            onChange={(hotkey) => setSettings({ ...settings, hotkey })}
            hint="Opens Hatstand from another app. Backspace clears it."
            error={data.hotkeyError}
          />
        </section>
        <section className="setting-section">
          <h2>Claude Desktop</h2>
          <p>
            {data.installation
              ? `${data.installation.kind} installation · ${data.installation.version}${data.installationTested ? '' : data.installationConfirmed ? ' · marked as working by you' : ' · not yet tested with Hatstand'}`
              : 'No installation detected'}
          </p>
          <div className="path-picker">
            <input
              aria-label="Claude executable override"
              readOnly
              placeholder="Automatically detect Claude"
              value={settings.executable}
            />
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void run('pickExecutable')
                  .then((value) => {
                    if (typeof value === 'string')
                      setSettings((current) => ({ ...current, executable: value }));
                  })
                  .catch(() => {})
              }
            >
              Browse
            </button>
            {settings.executable && (
              <button
                type="button"
                className="text-button"
                onClick={() => setSettings({ ...settings, executable: '' })}
              >
                Use automatic
              </button>
            )}
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() => fire('openExternal', { url: downloadUrl })}
          >
            Download Claude Desktop <ArrowUpRight size={14} />
          </button>
        </section>
        <button type="submit" className="primary" disabled={!!pending}>
          Save preferences
        </button>
      </form>

      <section className="setting-section transfer">
        <h2>Updates</h2>
        <p>Hatstand {data.version}. Checking contacts GitHub only when you ask.</p>
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            disabled={!!pending}
            onClick={() =>
              void run('checkUpdates')
                .then((value) => setUpdate(value as UpdateCheck))
                .catch(() => {})
            }
          >
            <RefreshCw size={15} className={pending === 'checkUpdates' ? 'spin' : ''} />
            Check for updates
          </button>
        </div>
        {update && (
          <div className="update-result" role="status">
            {!update.latest ? (
              <p>No public releases are available yet.</p>
            ) : update.newer ? (
              <>
                <h3>Hatstand {update.latest.version} is available</h3>
                {update.latest.notes && <pre className="release-notes">{update.latest.notes}</pre>}
                <button
                  type="button"
                  className="primary"
                  onClick={() => fire('openExternal', { url: update.latest!.url })}
                >
                  View release <ArrowUpRight size={15} />
                </button>
              </>
            ) : (
              <p>You have the latest version ({update.current}).</p>
            )}
          </div>
        )}
      </section>

      <section className="setting-section transfer">
        <h2>Sync profiles</h2>
        <p>
          Optional. Keeps profile names, labels, colors, pets, order and shortcuts in your own Supabase
          project, so another computer gets the same list. Sign-ins, Claude data, settings and work folders
          never leave this computer.{' '}
          <button
            type="button"
            className="text-button"
            onClick={() => fire('openExternal', { url: syncGuideUrl })}
          >
            Setup guide <ArrowUpRight size={13} />
          </button>
        </p>
        <div className="sync-fields">
          <label>
            Supabase project URL
            <input
              value={sync.syncUrl}
              placeholder="https://your-project.supabase.co"
              onChange={(e) => setSync({ ...sync, syncUrl: e.target.value })}
            />
          </label>
          <label>
            Publishable key
            <input
              value={sync.syncKey}
              placeholder="sb_publishable_… or the anon key"
              onChange={(e) => setSync({ ...sync, syncKey: e.target.value.trim() })}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={sync.syncEmail}
              placeholder="you@example.com"
              onChange={(e) => setSync({ ...sync, syncEmail: e.target.value })}
            />
          </label>
        </div>
        {data.sync.signedIn ? (
          <>
            <p role="status">
              {data.sync.syncing
                ? 'Syncing…'
                : data.sync.lastSyncAt
                  ? `Signed in. Last synced ${new Date(data.sync.lastSyncAt).toLocaleString()}.`
                  : 'Signed in.'}
              {!data.settings.syncEnabled && ' Sync is paused.'}
            </p>
            {data.sync.error && <p className="inline-error">{data.sync.error}</p>}
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={!!pending || data.sync.syncing}
                onClick={() =>
                  void saveSync(true)
                    .then(() => run('syncNow', undefined, 'Profiles synced.'))
                    .catch(() => {})
                }
              >
                <CloudUpload size={15} />
                Sync now
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!!pending}
                onClick={() => void saveSync(!data.settings.syncEnabled).catch(() => {})}
              >
                {data.settings.syncEnabled ? 'Pause sync' : 'Resume sync'}
              </button>
              <button type="button" className="text-button" onClick={() => fire('syncSignOut')}>
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            {data.sync.error && <p className="inline-error">{data.sync.error}</p>}
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={!!pending || !sync.syncUrl || !sync.syncKey || !sync.syncEmail}
                onClick={() =>
                  void saveSync(false)
                    .then(() => run('syncSendCode', undefined, 'Code sent. Check your email.'))
                    .then(() => setCodeSent(true))
                    .catch(() => {})
                }
              >
                Email me a sign-in code
              </button>
              {codeSent && (
                <>
                  <input
                    aria-label="Sign-in code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    placeholder="Code"
                    onChange={(e) => setCode(e.target.value.trim())}
                  />
                  <button
                    type="button"
                    className="primary"
                    disabled={!!pending || !code}
                    onClick={() =>
                      void saveSync(true)
                        .then(() => run('syncVerify', { code }, 'Signed in. Profiles synced.'))
                        .then(() => setCode(''))
                        .catch(() => {})
                    }
                  >
                    Sign in and sync
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </section>

      <section className="setting-section transfer">
        <h2>Move profile labels</h2>
        <p>
          Export names, account labels, colors, and initials. Sign-ins, shortcuts, folders, and Claude session
          data stay on this computer.
        </p>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => fire('export')}>
            <Download size={16} />
            Export metadata
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void run('chooseImport')
                .then((value) => setImportPreview(value as ProfileInput[] | null))
                .catch(() => {})
            }
          >
            <Upload size={16} />
            Import metadata
          </button>
        </div>
        {importPreview && (
          <div className="import-preview">
            <h3>Import {importPreview.length} profiles?</h3>
            <p>These will be fresh profiles. You’ll sign into each inside Claude.</p>
            <ul>
              {importPreview.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: imported names may repeat and the list is static.
                <li key={i}>{p.name}</li>
              ))}
            </ul>
            <div className="button-row">
              <button
                type="button"
                className="primary"
                onClick={() =>
                  void run('confirmImport', null, 'Profiles imported.')
                    .then(() => setImportPreview(null))
                    .catch(() => {})
                }
              >
                Create profiles
              </button>
              <button type="button" className="secondary" onClick={() => setImportPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="setting-section transfer">
        <h2>Second brain backup</h2>
        <p>
          After every Claude reply, each vault is copied into its own folder here, for example a folder your
          note-taking app opens. The backup only adds and updates notes; it never deletes any.
        </p>
        {data.settings.backupFolder ? (
          <p className="path-text">{data.settings.backupFolder}</p>
        ) : (
          <p className="n-hint">Off.</p>
        )}
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            disabled={!!pending}
            onClick={() =>
              fire('backupFolder', { pick: true }, 'Backups go to that folder after each Claude reply.')
            }
          >
            {data.settings.backupFolder ? 'Change folder…' : 'Choose folder…'}
          </button>
          {data.settings.backupFolder && (
            <button
              type="button"
              className="text-button"
              disabled={!!pending}
              onClick={() => fire('backupFolder', {}, 'Backups are off. Existing backups are kept.')}
            >
              Turn off
            </button>
          )}
        </div>
      </section>

      <section className="setting-section transfer">
        <h2>Local data</h2>
        <p>
          Profiles are stored in <span className="path-text inline">{data.dataFolder}</span>. Uninstalling
          Hatstand keeps this folder.
        </p>
        <div className="button-row">
          <button type="button" className="secondary" disabled={!!pending} onClick={loadStorage}>
            {storage ? 'Check again' : 'Find leftover data'}
          </button>
          <button
            type="button"
            className="secondary danger-text"
            disabled={!!pending}
            onClick={() =>
              void run('removeChanges')
                .then((removed) => {
                  if (removed)
                    void run(
                      'refresh',
                      undefined,
                      'Hatstand’s changes to Claude are removed. Notes are kept.',
                    );
                })
                .catch(() => {})
            }
          >
            Remove Hatstand’s changes from Claude…
          </button>
        </div>
        <p>
          Hatstand adds menu-bar pet and second brain hooks, a section in each profile’s CLAUDE.md, and a
          notes tool to Claude’s settings. Removing them turns both features off and leaves your notes where
          they are.
        </p>
        {storage && (
          <div className="storage-list">
            <p>
              {storage.length} profile folder{storage.length === 1 ? '' : 's'},{' '}
              {formatBytes(storage.reduce((sum, folder) => sum + folder.bytes, 0))} in total.{' '}
              {leftovers.length
                ? `${leftovers.length} belong${leftovers.length === 1 ? 's' : ''} to removed profiles and may still hold a signed-in session.`
                : 'None are left over from removed profiles.'}
            </p>
            {leftovers.length > 0 && (
              <ul>
                {leftovers.map((folder) => (
                  <li key={folder.id}>
                    <span>
                      <span className="path-text">{folder.path}</span>
                      <small>
                        {folder.partial ? 'At least ' : ''}
                        {formatBytes(folder.bytes)} · last changed{' '}
                        {new Date(folder.modifiedAt).toLocaleDateString()}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="secondary danger-text"
                      disabled={!!pending}
                      onClick={() =>
                        void run('trashFolder', { id: folder.id })
                          .then((moved) => {
                            if (moved) loadStorage();
                          })
                          .catch(() => {})
                      }
                    >
                      <Trash2 size={15} />
                      Move to {trashName}…
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </>
  );
}
