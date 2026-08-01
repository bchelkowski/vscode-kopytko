import { expect } from 'chai';
import type { ParseResult } from 'kopytko-brightscript-parser';
import { collectCalledWorkwideFuncNames } from '../../src/analysis/calledFunctionNames';

function fileMap(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe('collectCalledWorkwideFuncNames', () => {
  it('collects a direct (non-method) call target', () => {
    const called = collectCalledWorkwideFuncNames(
      fileMap({ '/project/main.brs': 'sub main()\n  doWork()\nend sub' }),
      new Map<string, ParseResult>(),
    );
    expect(called.has('dowork')).to.be.true;
  });

  it('does not collect a method call as a bare function name', () => {
    const called = collectCalledWorkwideFuncNames(
      fileMap({ '/project/main.brs': 'sub main()\n  m.doWork()\nend sub' }),
      new Map<string, ParseResult>(),
    );
    expect(called.has('dowork')).to.be.false;
  });

  it('collects a function declared in a SceneGraph <interface>', () => {
    const xml = [
      '<component name="Widget" extends="Group">',
      '  <interface>',
      '    <function name="onFocus" />',
      '  </interface>',
      '</component>',
    ].join('\n');
    const called = collectCalledWorkwideFuncNames(
      fileMap({ '/project/Widget.xml': xml }),
      new Map<string, ParseResult>(),
    );
    expect(called.has('onfocus')).to.be.true;
  });

  it('collects an observeField/observeFieldScoped callback name string', () => {
    const called = collectCalledWorkwideFuncNames(
      fileMap({
        '/project/main.brs': [
          'sub init()',
          '  m.top.observeField("myField", "onMyFieldChange")',
          '  m.top.observeFieldScoped("otherField", "onOtherChange")',
          'end sub',
        ].join('\n'),
      }),
      new Map<string, ParseResult>(),
    );
    expect(called.has('onmyfieldchange')).to.be.true;
    expect(called.has('onotherchange')).to.be.true;
  });

  it('collects a callFunc first-argument string', () => {
    const called = collectCalledWorkwideFuncNames(
      fileMap({
        '/project/main.brs': [
          'sub init()',
          '  m.childNode.callFunc("doSomething", {})',
          'end sub',
        ].join('\n'),
      }),
      new Map<string, ParseResult>(),
    );
    expect(called.has('dosomething')).to.be.true;
  });

  it('collects Kopytko events: { prop: "fn" } string values', () => {
    const called = collectCalledWorkwideFuncNames(
      fileMap({
        '/project/main.brs': [
          'function createController() as Object',
          '  return {',
          '    events: {',
          '      click: "onClick",',
          '      hover: "onHover",',
          '    }',
          '  }',
          'end function',
        ].join('\n'),
      }),
      new Map<string, ParseResult>(),
    );
    expect(called.has('onclick')).to.be.true;
    expect(called.has('onhover')).to.be.true;
  });

  it('populates parseResultCache for every .brs entry, keyed the same as the input map', () => {
    const parseResultCache = new Map<string, ParseResult>();
    collectCalledWorkwideFuncNames(
      fileMap({ '/project/main.brs': 'sub main()\nend sub' }),
      parseResultCache,
    );
    expect(parseResultCache.has('/project/main.brs')).to.be.true;
    expect(parseResultCache.get('/project/main.brs')?.diagnostics).to.have.length(0);
  });

  it('does not add an entry to parseResultCache for .xml files', () => {
    const parseResultCache = new Map<string, ParseResult>();
    collectCalledWorkwideFuncNames(
      fileMap({ '/project/Widget.xml': '<component name="Widget" extends="Group" />' }),
      parseResultCache,
    );
    expect(parseResultCache.size).to.equal(0);
  });

  it('unions call targets across multiple files', () => {
    const called = collectCalledWorkwideFuncNames(
      fileMap({
        '/project/a.brs': 'sub a()\n  b()\nend sub',
        '/project/b.brs': 'sub b()\nend sub',
      }),
      new Map<string, ParseResult>(),
    );
    expect(called.has('b')).to.be.true;
  });
});
