import { expect } from 'chai';
import { resolveWinDivertDir } from '../../src/client/network/redirect/windows/resolveWinDivertDir';

const BUNDLED = 'C:\\ext\\resources\\win\\x64';

describe('network/redirect/windows/resolveWinDivertDir', () => {
  it('uses the bundled x64 driver by default on x64 Windows, no configuration needed', () => {
    const result = resolveWinDivertDir({
      configuredDir: '',
      arch: 'x64',
      bundledDir: BUNDLED,
      hasWinDivertFiles: (dir) => dir === BUNDLED,
    });
    expect(result).to.deep.equal({ ok: true, dir: BUNDLED, source: 'bundled' });
  });

  it('prefers an explicit user override over the bundled driver', () => {
    const custom = 'D:\\custom\\windivert';
    const result = resolveWinDivertDir({
      configuredDir: custom,
      arch: 'x64',
      bundledDir: BUNDLED,
      hasWinDivertFiles: (dir) => dir === custom || dir === BUNDLED,
    });
    expect(result).to.deep.equal({ ok: true, dir: custom, source: 'configured' });
  });

  it('fails with a specific, actionable reason when the configured override path is wrong', () => {
    const result = resolveWinDivertDir({
      configuredDir: 'C:\\typo\\path',
      arch: 'x64',
      bundledDir: BUNDLED,
      hasWinDivertFiles: (dir) => dir === BUNDLED, // configured path has no WinDivert files
    });
    expect(result.ok).to.equal(false);
    expect((result as { reason: string }).reason).to.contain('C:\\typo\\path');
    expect((result as { reason: string }).reason).to.contain('winDivertDir');
  });

  it('fails with an architecture-specific reason on non-x64, without even checking the bundled dir', () => {
    let checkedBundled = false;
    const result = resolveWinDivertDir({
      configuredDir: '',
      arch: 'arm64',
      bundledDir: BUNDLED,
      hasWinDivertFiles: (dir) => {
        if (dir === BUNDLED) checkedBundled = true;
        return true;
      },
    });
    expect(result.ok).to.equal(false);
    expect((result as { reason: string }).reason).to.contain('arm64');
    expect((result as { reason: string }).reason).to.contain('x64');
    expect(checkedBundled).to.equal(false);
  });

  it('fails with a reinstall-pointing reason when the bundled files are missing or unreadable', () => {
    const result = resolveWinDivertDir({
      configuredDir: '',
      arch: 'x64',
      bundledDir: BUNDLED,
      hasWinDivertFiles: () => false,
    });
    expect(result.ok).to.equal(false);
    expect((result as { reason: string }).reason).to.contain('reinstalling');
  });
});
