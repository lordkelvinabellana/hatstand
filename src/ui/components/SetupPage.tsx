import { useState } from 'react';
import { ArrowUpRight, Check, ShieldCheck } from 'lucide-react';
import { HatMark } from './HatMark.tsx';
import type { Color } from '../../core/profiles.ts';
import type { Profile } from '../../core/profiles.ts';
import { useApp } from '../api.ts';
import { initials, profileColors } from './ProfileEditor.tsx';

const steps = ['Find Claude', 'What stays separate', 'First client'];

export function SetupPage() {
  const { data, pending, run, fire } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [color, setColor] = useState<Color>('teal');

  async function finish(launch: boolean) {
    try {
      const profile = (await run('create', { name, icon: initials(name), color })) as Profile;
      await run('completeSetup');
      if (launch) await run('launch', { id: profile.id }, 'Sign in inside the Claude window that opened.');
    } catch {}
  }

  return (
    <main className="setup">
      <div className="setup-card">
        <div className="setup-brand">
          <span className="brand-mark">
            <HatMark size={26} />
          </span>
          <span>Hatstand</span>
        </div>
        <ol className="setup-steps" aria-label="Setup progress">
          {steps.map((label, index) => (
            <li key={label} className={index === step ? 'current' : index < step ? 'done' : ''}>
              <span>{index < step ? <Check size={13} /> : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section>
            <h1>Let’s find Claude Desktop.</h1>
            <p>Hatstand opens the official Claude Desktop app with a separate profile for each client.</p>
            {data.installation ? (
              <div className="banner success">
                <Check size={16} />
                <span>
                  Found Claude {data.installation.version} ({data.installation.kind}).
                  {data.installationTested ? '' : ' This version hasn’t been tested with Hatstand yet.'}
                </span>
              </div>
            ) : (
              <div className="banner warning">
                <span>
                  {data.installationError || 'Claude Desktop isn’t installed, or Hatstand couldn’t find it.'}
                </span>
              </div>
            )}
            <div className="button-row">
              {!data.installation && (
                <>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => fire('openExternal', { url: 'https://claude.com/download' })}
                  >
                    Download Claude Desktop <ArrowUpRight size={14} />
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!!pending}
                    onClick={() =>
                      void run('pickExecutable')
                        .then((executable) =>
                          typeof executable === 'string'
                            ? run('settings', { ...data.settings, executable })
                            : undefined,
                        )
                        .catch(() => {})
                    }
                  >
                    Choose Claude.exe…
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={!!pending}
                    onClick={() => fire('refresh')}
                  >
                    Check again
                  </button>
                </>
              )}
            </div>
            <div className="setup-footer">
              <button type="button" className="text-button" onClick={() => fire('completeSetup')}>
                Skip setup
              </button>
              <button
                type="button"
                className="primary"
                disabled={!data.installation}
                onClick={() => setStep(1)}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <h1>What stays separate.</h1>
            <ul className="setup-list">
              <li>
                <strong>Separate:</strong> each client’s Claude sign-in, chats, and Desktop settings.
              </li>
              <li>
                <strong>Shared:</strong> your Windows account, files, clipboard, and local services. This
                isn’t a security sandbox.
              </li>
              <li>
                <strong>Not yet verified:</strong> Cowork and Desktop Code separation, and staying signed in
                after a reboot.
              </li>
            </ul>
            <p className="setup-note">
              <ShieldCheck size={15} /> You sign in inside Claude. Hatstand never sees your password.
            </p>
            <div className="setup-footer">
              <button type="button" className="text-button" onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className="primary" onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void finish(true);
            }}
          >
            <h1>Add your first client.</h1>
            <p>You can add more clients, colors, and shortcuts later.</p>
            <label className="stacked-label">
              Client name
              <input
                required
                maxLength={80}
                value={name}
                placeholder="e.g. North Studio"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <fieldset className="setup-colors">
              <legend>Profile color</legend>
              <div className="color-options">
                <span className={`avatar ${color}`}>{initials(name)}</span>
                {profileColors.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`color-swatch ${option} ${color === option ? 'chosen' : ''}`}
                    aria-label={option}
                    aria-pressed={color === option}
                    onClick={() => setColor(option)}
                  >
                    {color === option && <Check size={17} />}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="setup-footer">
              <button type="button" className="text-button" onClick={() => setStep(1)}>
                Back
              </button>
              <span className="button-row">
                <button
                  type="button"
                  className="secondary"
                  disabled={!!pending || !name.trim()}
                  onClick={() => void finish(false)}
                >
                  Create without launching
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={!!pending || !name.trim() || !data.installation}
                >
                  Create and launch
                </button>
              </span>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
