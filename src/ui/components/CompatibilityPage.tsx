import { useEffect, useState } from 'react';
import { ArrowUpRight, Download } from 'lucide-react';
import { checksFor, testedVersionsFor } from '../../core/compat.ts';
import { issuesUrl } from '../../core/project.ts';
import { useApp } from '../api.ts';

const resultLabels = {
  observed: 'Observed',
  'user-confirmed': 'User confirmed',
  unverified: 'Not yet verified',
};

export function CompatibilityPage() {
  const { data, run, fire } = useApp();
  const [diagnostics, setDiagnostics] = useState<unknown>(null);
  useEffect(() => {
    void run('diagnostics')
      .then(setDiagnostics)
      .catch(() => {});
  }, [run]);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Know what’s separate.</h1>
          <p>Compatibility is measured, not assumed.</p>
        </div>
        <span className="preview-label">Preview build</span>
      </div>
      <section className="compatibility">
        <h2>Current verification</h2>
        {checksFor(data.platform).map((check) => (
          <div className="check-row" key={check.key}>
            <span>{check.label}</span>
            <span className={check.result === 'unverified' ? '' : 'verified'}>
              {resultLabels[check.result]}
            </span>
          </div>
        ))}
        <p>
          Tested with Claude Desktop {testedVersionsFor(data.platform).join(' and ')} (
          {data.platform === 'darwin' ? 'macOS' : 'MSIX'}).{' '}
          {data.installation
            ? data.installationTested
              ? `Your installed version, ${data.installation.version}, is one of them.`
              : data.installationConfirmed
                ? `Your installed version, ${data.installation.version}, isn’t on that list, but you marked it as working.`
                : `Your installed version, ${data.installation.version}, has not been tested yet.`
            : ''}
        </p>
        {data.installation && !data.installationTested && (
          <div className="button-row">
            {data.installationConfirmed ? (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  fire('confirmVersion', { works: false }, 'The untested-version warning is back on.')
                }
              >
                Undo “works for me”
              </button>
            ) : (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  fire(
                    'confirmVersion',
                    { works: true },
                    `Marked Claude ${data.installation?.version} as working.`,
                  )
                }
              >
                Mark as working
              </button>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => fire('openExternal', { url: issuesUrl })}
            >
              Something’s wrong? Report it <ArrowUpRight size={14} />
            </button>
          </div>
        )}
      </section>
      <section className="setting-section">
        <h2>Separate sessions, shared computer</h2>
        <p>
          Each profile has its own Desktop data location. Profiles still run as the same computer user and may
          access the same files, clipboard, and local services. This app does not create a security sandbox.
        </p>
        <p>
          Hatstand is independent of Anthropic. You install and authenticate with the official Claude Desktop
          app. It relies on an undocumented Claude Desktop setting that a future update could change.
        </p>
      </section>
      <section className="setting-section">
        <h2>Diagnostic summary</h2>
        <p>
          This summary contains versions and counts, without client names, emails, paths, or session contents.
        </p>
        <pre className="diagnostics">
          {diagnostics ? JSON.stringify(diagnostics, null, 2) : 'Loading summary…'}
        </pre>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => fire('exportDiagnostics')}>
            <Download size={16} />
            Save this summary
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => fire('openExternal', { url: issuesUrl })}
          >
            Report a problem <ArrowUpRight size={14} />
          </button>
        </div>
      </section>
    </>
  );
}
