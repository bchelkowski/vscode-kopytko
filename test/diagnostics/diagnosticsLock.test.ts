import { expect } from 'chai';
import sinon from 'sinon';
import { diagnosticsLock } from '../../src/client/diagnostics/diagnosticsLock';

describe('diagnosticsLock', () => {
  afterEach(() => {
    // Reset lock state between tests.
    diagnosticsLock.release('diagnostics');
    diagnosticsLock.release('perfetto');
  });

  it('starts with no owner', () => {
    expect(diagnosticsLock.owner).to.be.null;
  });

  it('acquire returns true when lock is free', () => {
    expect(diagnosticsLock.acquire('diagnostics')).to.be.true;
    expect(diagnosticsLock.owner).to.equal('diagnostics');
  });

  it('acquire is idempotent for the same owner', () => {
    expect(diagnosticsLock.acquire('diagnostics')).to.be.true;
    expect(diagnosticsLock.acquire('diagnostics')).to.be.true;
  });

  it('acquire returns false when held by the other owner', () => {
    diagnosticsLock.acquire('diagnostics');
    expect(diagnosticsLock.acquire('perfetto')).to.be.false;
    expect(diagnosticsLock.owner).to.equal('diagnostics');
  });

  it('release frees the lock', () => {
    diagnosticsLock.acquire('diagnostics');
    diagnosticsLock.release('diagnostics');
    expect(diagnosticsLock.owner).to.be.null;
  });

  it('release is a no-op for non-owner', () => {
    diagnosticsLock.acquire('diagnostics');
    diagnosticsLock.release('perfetto'); // wrong owner
    expect(diagnosticsLock.owner).to.equal('diagnostics');
  });

  it('emits change event on acquire', () => {
    const spy = sinon.spy();
    diagnosticsLock.once('change', spy);
    diagnosticsLock.acquire('perfetto');
    expect(spy.calledOnceWith('perfetto')).to.be.true;
  });

  it('emits change event on release', () => {
    diagnosticsLock.acquire('perfetto');
    const spy = sinon.spy();
    diagnosticsLock.once('change', spy);
    diagnosticsLock.release('perfetto');
    expect(spy.calledOnceWith(null)).to.be.true;
  });

  it('does not emit on idempotent acquire', () => {
    diagnosticsLock.acquire('diagnostics');
    const spy = sinon.spy();
    diagnosticsLock.once('change', spy);
    diagnosticsLock.acquire('diagnostics');
    expect(spy.called).to.be.false;
  });

  it('allows the other owner after release', () => {
    diagnosticsLock.acquire('diagnostics');
    diagnosticsLock.release('diagnostics');
    expect(diagnosticsLock.acquire('perfetto')).to.be.true;
    expect(diagnosticsLock.owner).to.equal('perfetto');
  });
});
