import { expect } from 'chai';
import {
  ComponentDeclaration,
  DUPLICATE_COMPONENT_RULE,
  duplicateComponentDiagnostics,
  findDuplicateComponents,
  isProjectFile,
} from '../../src/analysis/duplicateComponents';

function declaration(name: string, filePath: string, line = 0, column = 17): ComponentDeclaration {
  return { name, filePath, line, column };
}

const APP_CARD = declaration('Card', '/project/src/components/Card.xml');
const OUT_CARD = declaration('Card', '/project/out/components/Card.xml');
const PKG_CARD = declaration('Card', '/project/node_modules/kopytko-ui/app/Card.xml');
const APP_BUTTON = declaration('Button', '/project/src/components/Button.xml');

describe('duplicateComponents', () => {
  describe('findDuplicateComponents', () => {
    it('groups two declarations of the same name', () => {
      const groups = findDuplicateComponents([APP_CARD, APP_BUTTON, OUT_CARD]);

      expect(groups).to.have.length(1);
      expect(groups[0].name).to.equal('Card');
      expect(groups[0].declarations.map((d) => d.filePath))
        .to.deep.equal([OUT_CARD.filePath, APP_CARD.filePath]);
    });

    it('matches names case-insensitively', () => {
      const groups = findDuplicateComponents([
        declaration('Card', '/a/Card.xml'),
        declaration('card', '/b/card.xml'),
      ]);

      expect(groups).to.have.length(1);
    });

    it('returns nothing when every name is unique', () => {
      expect(findDuplicateComponents([APP_CARD, APP_BUTTON])).to.be.empty;
    });

    it('drops excluded files before counting', () => {
      const groups = findDuplicateComponents(
        [APP_CARD, OUT_CARD],
        (filePath) => filePath.includes('/out/'),
      );

      expect(groups).to.be.empty;
    });

    it('sorts groups by name', () => {
      const groups = findDuplicateComponents([
        declaration('Zebra', '/a/Zebra.xml'), declaration('Zebra', '/b/Zebra.xml'),
        declaration('Alpha', '/a/Alpha.xml'), declaration('Alpha', '/b/Alpha.xml'),
      ]);

      expect(groups.map((g) => g.name)).to.deep.equal(['Alpha', 'Zebra']);
    });
  });

  describe('isProjectFile', () => {
    it('rejects paths inside node_modules', () => {
      expect(isProjectFile('/project/node_modules/kopytko-ui/app/Card.xml')).to.be.false;
      expect(isProjectFile('C:\\project\\node_modules\\kopytko-ui\\Card.xml')).to.be.false;
    });

    it('accepts project paths', () => {
      expect(isProjectFile('/project/src/components/Card.xml')).to.be.true;
      // A directory merely containing the substring is still a project file
      expect(isProjectFile('/project/src/node_modules_helpers/Card.xml')).to.be.true;
    });
  });

  describe('duplicateComponentDiagnostics', () => {
    it('reports every declaration, pointing at the others', () => {
      const diagnostics = duplicateComponentDiagnostics([APP_CARD, OUT_CARD]);

      expect(diagnostics).to.have.length(2);
      expect(diagnostics.map((d) => d.filePath))
        .to.deep.equal([OUT_CARD.filePath, APP_CARD.filePath]);
      expect(diagnostics[0].message).to.contain('Duplicate component name "Card"');
      expect(diagnostics[0].message).to.contain(APP_CARD.filePath);
      expect(diagnostics[0].message).to.not.contain(OUT_CARD.filePath);
    });

    it('uses the rule code and defaults to warning', () => {
      const [diagnostic] = duplicateComponentDiagnostics([APP_CARD, OUT_CARD]);

      expect(diagnostic.code).to.equal(DUPLICATE_COMPONENT_RULE);
      expect(diagnostic.code).to.equal('component/duplicate-name');
      expect(diagnostic.severity).to.equal('warning');
    });

    it('honours a configured severity', () => {
      const [diagnostic] = duplicateComponentDiagnostics([APP_CARD, OUT_CARD], { severity: 'error' });

      expect(diagnostic.severity).to.equal('error');
    });

    it('ranges over the name attribute value', () => {
      const [diagnostic] = duplicateComponentDiagnostics([APP_CARD, OUT_CARD]);

      expect(diagnostic.line).to.equal(0);
      expect(diagnostic.column).to.equal(17);
      expect(diagnostic.endLine).to.equal(0);
      expect(diagnostic.endColumn).to.equal(21);
    });

    it('counts a package declaration but does not report inside node_modules', () => {
      const diagnostics = duplicateComponentDiagnostics([APP_CARD, PKG_CARD]);

      expect(diagnostics).to.have.length(1);
      expect(diagnostics[0].filePath).to.equal(APP_CARD.filePath);
      expect(diagnostics[0].message).to.contain('kopytko-ui');
    });

    it('reports nothing when both declarations are in packages', () => {
      const other = declaration('Card', '/project/node_modules/kopytko-other/app/Card.xml');

      expect(duplicateComponentDiagnostics([PKG_CARD, other])).to.be.empty;
    });

    it('reports nothing once an excluded copy is discounted', () => {
      const diagnostics = duplicateComponentDiagnostics([APP_CARD, OUT_CARD], {
        isExcluded: (filePath) => filePath.includes('/out/'),
      });

      expect(diagnostics).to.be.empty;
    });

    it('renders other paths through displayPath', () => {
      const [diagnostic] = duplicateComponentDiagnostics([APP_CARD, OUT_CARD], {
        displayPath: (filePath) => filePath.replace('/project/', ''),
      });

      expect(diagnostic.message).to.contain('src/components/Card.xml');
      expect(diagnostic.message).to.not.contain('/project/src');
    });

    it('reports nothing for a project with no duplicates', () => {
      expect(duplicateComponentDiagnostics([APP_CARD, APP_BUTTON])).to.be.empty;
    });
  });
});
