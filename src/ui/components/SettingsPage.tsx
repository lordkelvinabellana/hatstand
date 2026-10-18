import { useState } from 'react';
import { ArrowUpRight, Download, RefreshCw, Trash2, Upload } from 'lucide-react';
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
              ? `${data.installation.kind} installation · ${data.installation.version}${data.installationTested ? '' : ' · not yet tested with Hatstand'}`
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
        <h2>Local data</h2>
        <p>
          Profiles are stored in <span className="path-text inline">{data.dataFolder}</span>. Uninstalling
          Hatstand keeps this folder.
        </p>
        <div className="button-row">
          <button type="button" className="secondary" disabled={!!pending} onClick={loadStorage}>
            {storage ? 'Check again' : 'Find leftover data'}
          </button>
        </div>
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
