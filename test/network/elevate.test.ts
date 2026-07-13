import { expect } from 'chai';
import { buildElevatedInvocation } from '../../src/client/network/redirect/elevate';

// A realistic macOS globalStorageUri path — the space in "Application Support"
// is exactly what broke an earlier hand-built-shell-string version of this.
const SPACEY_PATH = '/Users/dev/Library/Application Support/Code/User/globalStorage/x/network/redirect-abc.sh';
const LABEL = 'Kopytko Network Inspector — enable traffic capture';

describe('network/elevate/buildElevatedInvocation', () => {
  it('macOS: returns an argv array (no shell), path passed byte-for-byte with spaces intact', () => {
    const inv = buildElevatedInvocation('darwin', SPACEY_PATH, LABEL);
    expect(inv).to.not.equal(null);
    expect(inv!.cmd).to.equal('osascript');
    expect(inv!.args).to.deep.equal(['-e', inv!.args[1]]);
    // The path must appear whole, unsplit, inside the single script argument.
    expect(inv!.args[1]).to.contain(SPACEY_PATH);
    expect(inv!.args[1]).to.contain('quoted form of');
    expect(inv!.args[1]).to.contain('do shell script "/bin/sh "');
    expect(inv!.args[1]).to.contain('with administrator privileges');
  });

  it('macOS: escapes double quotes and backslashes in the path/label for the AppleScript string literal', () => {
    const inv = buildElevatedInvocation('darwin', '/tmp/weird "quoted" \\path.sh', 'label "with" quotes');
    expect(inv!.args[1]).to.contain('\\"quoted\\"');
    expect(inv!.args[1]).to.contain('\\\\path.sh');
    expect(inv!.args[1]).to.contain('label \\"with\\" quotes');
  });

  it('linux: returns pkexec argv with the path as its own untouched element', () => {
    const inv = buildElevatedInvocation('linux', SPACEY_PATH, LABEL);
    expect(inv).to.deep.equal({ cmd: 'pkexec', args: ['/bin/sh', SPACEY_PATH] });
  });

  it('returns null for unsupported platforms (including Windows)', () => {
    expect(buildElevatedInvocation('win32', SPACEY_PATH, LABEL)).to.equal(null);
    expect(buildElevatedInvocation('freebsd', SPACEY_PATH, LABEL)).to.equal(null);
  });
});
