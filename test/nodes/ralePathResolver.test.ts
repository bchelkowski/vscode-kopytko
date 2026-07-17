import { expect } from 'chai';
import {
  resolveRalePath,
  subtypeCompatible,
  type ItemListFetcher,
} from '../../src/client/nodes/ralePathResolver';
import type { PathStep } from '../../src/client/nodes/webview/xmlDiff';

interface FakeNode {
  subtype: string;
  id?: string;
  children?: FakeNode[];
}

/**
 * Builds an ItemListFetcher over a fake device tree. Child `index` values are
 * the *real* positions in the children array — including non-renderable
 * nodes that app-ui would omit.
 */
function fetcherFor(scene: FakeNode): { fetch: ItemListFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetch: ItemListFetcher = async (path) => {
    calls.push(JSON.stringify(path));
    let node = scene;
    for (const seg of path) {
      if (!('child' in seg)) throw new Error('field segments not supported in fake');
      const next = node.children?.[seg.child];
      if (!next) throw new Error(`TrackerTask: Invalid Path`);
      node = next;
    }
    return {
      item: { subtype: node.subtype, id: node.id ?? '', type: 'roSGNode' },
      childList: (node.children ?? []).map((child, index) => ({
        item: { subtype: child.subtype, id: child.id ?? '', index, type: 'roSGNode' },
      })),
    };
  };
  return { fetch, calls };
}

function step(subtype: string, ordinal = 0, id?: string): PathStep {
  return { subtype, ordinal, id };
}

describe('nodes/ralePathResolver', () => {
  it('resolves a straight path when app-ui and device indices agree', async () => {
    const { fetch } = fetcherFor({
      subtype: 'MainScene',
      children: [{ subtype: 'Group', children: [{ subtype: 'Label' }] }],
    });
    const result = await resolveRalePath(
      [step('MainScene'), step('Group'), step('Label')],
      fetch,
    );
    expect(result).to.deep.equal({ ok: true, path: [{ child: 0 }, { child: 0 }] });
  });

  it('skips non-renderable device children that app-ui omits (the RALE index space)', async () => {
    // Device: [Timer, Task, Label, Task, Label] — app-ui sees only the two Labels.
    const { fetch } = fetcherFor({
      subtype: 'MainScene',
      children: [
        { subtype: 'Timer' },
        { subtype: 'Task' },
        { subtype: 'Label', id: 'first' },
        { subtype: 'Task' },
        { subtype: 'Label', id: 'second' },
      ],
    });
    // app-ui shows the second Label as the scene's child #1; its ordinal
    // among Labels is 1 — which must resolve to device index 4.
    const result = await resolveRalePath(
      [step('MainScene'), step('Label', 1)],
      fetch,
    );
    expect(result).to.deep.equal({ ok: true, path: [{ child: 4 }] });
  });

  it('prefers a unique id match over the ordinal', async () => {
    const { fetch } = fetcherFor({
      subtype: 'MainScene',
      children: [
        { subtype: 'Label', id: 'a' },
        { subtype: 'Label', id: 'b' },
      ],
    });
    // Wrong ordinal (0), but the id pins it to device index 1.
    const result = await resolveRalePath(
      [step('MainScene'), step('Label', 0, 'b')],
      fetch,
    );
    expect(result).to.deep.equal({ ok: true, path: [{ child: 1 }] });
  });

  it('falls back to the ordinal when the id matches more than one child', async () => {
    const { fetch } = fetcherFor({
      subtype: 'MainScene',
      children: [
        { subtype: 'Label', id: 'dup' },
        { subtype: 'Label', id: 'dup' },
      ],
    });
    const result = await resolveRalePath(
      [step('MainScene'), step('Label', 1, 'dup')],
      fetch,
    );
    expect(result).to.deep.equal({ ok: true, path: [{ child: 1 }] });
  });

  it('fails with the location when a step cannot be found', async () => {
    const { fetch } = fetcherFor({
      subtype: 'MainScene',
      children: [{ subtype: 'Group', children: [] }],
    });
    const result = await resolveRalePath(
      [step('MainScene'), step('Group'), step('Poster')],
      fetch,
    );
    expect(result.ok).to.be.false;
    if (result.ok) return;
    expect(result.error).to.include('<Poster>');
    expect(result.error).to.include('MainScene > Group > Poster');
  });

  it('fails when the device scene subtype does not match the view', async () => {
    const { fetch } = fetcherFor({ subtype: 'OtherScene', children: [] });
    const result = await resolveRalePath([step('MainScene')], fetch);
    expect(result.ok).to.be.false;
    if (result.ok) return;
    expect(result.error).to.match(/Scene mismatch/);
  });

  it('resolves <RenderableNode> app-ui tags to plain Group device nodes by id', async () => {
    // Verified live: app-ui prints plain Group nodes as <RenderableNode>
    // (custom components and other built-ins print their real subtype).
    const { fetch } = fetcherFor({
      subtype: 'MainScene',
      children: [
        {
          subtype: 'HomeView',
          id: 'renderedView',
          children: [
            {
              subtype: 'Group',
              id: 'container',
              children: [
                { subtype: 'Group', id: 'heroContainer', children: [{ subtype: 'Hero', id: 'hero' }] },
                { subtype: 'LayoutGroup', id: 'homeLayout' },
              ],
            },
          ],
        },
      ],
    });
    const result = await resolveRalePath(
      [
        step('MainScene'),
        step('HomeView', 0, 'renderedView'),
        step('RenderableNode', 0, 'container'),
        step('RenderableNode', 0, 'heroContainer'),
        step('Hero', 0, 'hero'),
      ],
      fetch,
    );
    expect(result).to.deep.equal({
      ok: true,
      path: [{ child: 0 }, { child: 0 }, { child: 0 }, { child: 0 }],
    });
  });

  it('resolves an unnamed <RenderableNode> step by ordinal among Groups', async () => {
    const { fetch } = fetcherFor({
      subtype: 'MainScene',
      children: [
        { subtype: 'Timer' },
        { subtype: 'Group' },
        { subtype: 'LayoutGroup' },
        { subtype: 'Group', children: [{ subtype: 'Label', id: 'target' }] },
      ],
    });
    // app-ui shows [RenderableNode, LayoutGroup, RenderableNode]; the second
    // RenderableNode (ordinal 1) must land on device index 3.
    const result = await resolveRalePath(
      [step('MainScene'), step('RenderableNode', 1), step('Label', 0, 'target')],
      fetch,
    );
    expect(result).to.deep.equal({ ok: true, path: [{ child: 3 }, { child: 0 }] });
  });

  it('id match wins even when the id sits outside the subtype-ordinal guess', async () => {
    const { fetch } = fetcherFor({
      subtype: 'MainScene',
      children: [
        { subtype: 'Group', id: 'other' },
        { subtype: 'Group', id: 'container' },
      ],
    });
    const result = await resolveRalePath(
      [step('MainScene'), step('RenderableNode', 0, 'container')],
      fetch,
    );
    expect(result).to.deep.equal({ ok: true, path: [{ child: 1 }] });
  });

  it('resolves deep chains through mixed renderable/non-renderable levels', async () => {
    const { fetch, calls } = fetcherFor({
      subtype: 'MainScene',
      children: [
        { subtype: 'ContentNode' },
        {
          subtype: 'Group',
          id: 'content',
          children: [
            { subtype: 'Task' },
            {
              subtype: 'LayoutGroup',
              children: [
                { subtype: 'Poster', id: 'logo' },
              ],
            },
          ],
        },
      ],
    });
    const result = await resolveRalePath(
      [step('MainScene'), step('Group', 0, 'content'), step('LayoutGroup'), step('Poster', 0, 'logo')],
      fetch,
    );
    expect(result).to.deep.equal({
      ok: true,
      path: [{ child: 1 }, { child: 1 }, { child: 0 }],
    });
    // One fetch per level: scene, Group, LayoutGroup.
    expect(calls).to.have.length(3);
  });

  describe('subtypeCompatible', () => {
    it('accepts exact matches', () => {
      expect(subtypeCompatible('Label', 'Label')).to.be.true;
      expect(subtypeCompatible('Hero', 'Hero')).to.be.true;
    });
    it('maps app-ui RenderableNode to device Group', () => {
      expect(subtypeCompatible('RenderableNode', 'Group')).to.be.true;
      expect(subtypeCompatible('RenderableNode', 'RenderableNode')).to.be.true;
      expect(subtypeCompatible('RenderableNode', 'LayoutGroup')).to.be.false;
    });
    it('rejects mismatches and unknowns', () => {
      expect(subtypeCompatible('Label', 'Poster')).to.be.false;
      expect(subtypeCompatible('Group', 'RenderableNode')).to.be.false;
      expect(subtypeCompatible('Label', undefined)).to.be.false;
    });
  });
});
