import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { walkTree } from '../../src/server/utils/dirWalker';

describe('walkTree', () => {
  let readdirStub: sinon.SinonStub;

  beforeEach(() => {
    readdirStub = sinon.stub(fsWrapper, 'readdirTyped').returns([]);
  });

  afterEach(() => sinon.restore());

  it('calls onFile for every file entry', () => {
    readdirStub.withArgs('/project').returns([
      { name: 'A.brs', isDirectory: false },
      { name: 'B.brs', isDirectory: false },
    ]);

    const seen: string[] = [];
    walkTree('/project', (filePath) => seen.push(filePath));

    expect(seen).to.have.members(['/project/A.brs', '/project/B.brs']);
  });

  it('passes both the full path and entry name to onFile', () => {
    readdirStub.withArgs('/project').returns([{ name: 'A.brs', isDirectory: false }]);

    const calls: Array<{ filePath: string; name: string }> = [];
    walkTree('/project', (filePath, name) => calls.push({ filePath, name }));

    expect(calls).to.deep.equal([{ filePath: '/project/A.brs', name: 'A.brs' }]);
  });

  it('recurses into subdirectories', () => {
    readdirStub.withArgs('/project').returns([{ name: 'sub', isDirectory: true }]);
    readdirStub.withArgs('/project/sub').returns([{ name: 'Deep.brs', isDirectory: false }]);

    const seen: string[] = [];
    walkTree('/project', (filePath) => seen.push(filePath));

    expect(seen).to.deep.equal(['/project/sub/Deep.brs']);
  });

  it('skips node_modules by default', () => {
    readdirStub.withArgs('/project').returns([
      { name: 'node_modules', isDirectory: true },
      { name: 'App.brs', isDirectory: false },
    ]);
    readdirStub.withArgs('/project/node_modules').throws(new Error('should not descend'));

    const seen: string[] = [];
    walkTree('/project', (filePath) => seen.push(filePath));

    expect(seen).to.deep.equal(['/project/App.brs']);
  });

  it('visits node_modules when skipNodeModules is false', () => {
    readdirStub.withArgs('/project').returns([{ name: 'node_modules', isDirectory: true }]);
    readdirStub.withArgs('/project/node_modules').returns([{ name: 'Pkg.brs', isDirectory: false }]);

    const seen: string[] = [];
    walkTree('/project', (filePath) => seen.push(filePath), { skipNodeModules: false });

    expect(seen).to.deep.equal(['/project/node_modules/Pkg.brs']);
  });

  it('skips dot-prefixed directories', () => {
    readdirStub.withArgs('/project').returns([
      { name: '.git', isDirectory: true },
      { name: 'App.brs', isDirectory: false },
    ]);
    readdirStub.withArgs('/project/.git').throws(new Error('should not descend'));

    const seen: string[] = [];
    walkTree('/project', (filePath) => seen.push(filePath));

    expect(seen).to.deep.equal(['/project/App.brs']);
  });

  it('does not throw when a directory cannot be read', () => {
    readdirStub.withArgs('/project').throws(new Error('EACCES'));

    expect(() => walkTree('/project', () => { /* noop */ })).not.to.throw();
  });
});
