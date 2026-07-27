import { expect } from 'chai';
import {
  CONSOLE_COMMANDS,
  CONSOLE_PORT_LABELS,
  completeCommand,
  findCommand,
  isDestructiveCommand,
} from '../../src/console/commandCatalog';

describe('commandCatalog', () => {
  describe('catalog shape', () => {
    it('covers both interactive ports', () => {
      expect(Object.keys(CONSOLE_COMMANDS).map(Number).sort()).to.deep.equal([8080, 8085]);
      expect(CONSOLE_PORT_LABELS[8085]).to.equal('BrightScript runtime');
      expect(CONSOLE_PORT_LABELS[8080]).to.equal('SceneGraph debug server');
    });

    it('gives every command a non-empty description and a known source', () => {
      for (const [port, commands] of Object.entries(CONSOLE_COMMANDS)) {
        for (const cmd of commands) {
          expect(cmd.description, `${port} ${cmd.name}`).to.have.length.greaterThan(0);
          expect(cmd.source, `${port} ${cmd.name}`).to.be.oneOf(['docs', 'device']);
        }
      }
    });

    it('has no duplicate names or aliases within a port', () => {
      for (const [port, commands] of Object.entries(CONSOLE_COMMANDS)) {
        const seen = new Set<string>();
        for (const cmd of commands) {
          for (const token of [cmd.name, ...(cmd.aliases ?? [])]) {
            expect(seen.has(token), `${port} duplicate "${token}"`).to.be.false;
            seen.add(token);
          }
        }
      }
    });
  });

  describe('completeCommand — command names', () => {
    it('completes a prefix on 8085', () => {
      const values = completeCommand(8085, 'b').map((c) => c.value);
      expect(values).to.have.members(['bt', 'bsc', 'bscs', 'brkd']);
    });

    it('returns the whole catalog for an empty line', () => {
      expect(completeCommand(8085, '')).to.have.length(CONSOLE_COMMANDS[8085].length);
    });

    it('matches on aliases as well as names', () => {
      // "th" is both a prefix of "threads"/"thread" and the alias of "thread".
      const values = completeCommand(8085, 'th').map((c) => c.value);
      expect(values).to.have.members(['threads', 'thread']);

      // "ths" only matches via the alias on "threads".
      expect(completeCommand(8085, 'ths').map((c) => c.value)).to.deep.equal(['threads']);
    });

    it('is case-insensitive', () => {
      expect(completeCommand(8080, 'CHAN').map((c) => c.value)).to.deep.equal(['chanperf']);
    });

    it('ignores leading whitespace', () => {
      expect(completeCommand(8080, '   free').map((c) => c.value)).to.deep.equal(['free']);
    });

    it('carries args, description, source and the destructive flag through', () => {
      const [chanperf] = completeCommand(8080, 'chanperf');
      expect(chanperf.args).to.equal('[-r <seconds>]');
      expect(chanperf.source).to.equal('docs');
      expect(chanperf.destructive).to.be.undefined;

      const [genkey] = completeCommand(8080, 'genkey');
      expect(genkey.source).to.equal('device');
      expect(genkey.destructive).to.be.true;
    });

    it('returns nothing for an unknown prefix', () => {
      expect(completeCommand(8085, 'zzz')).to.be.empty;
      expect(completeCommand(8080, 'zzz')).to.be.empty;
    });

    it('keeps the two port catalogs separate', () => {
      // chanperf is 8080-only, bt is 8085-only.
      expect(completeCommand(8085, 'chanperf')).to.be.empty;
      expect(completeCommand(8080, 'bt')).to.be.empty;
    });
  });

  describe('completeCommand — subcommands', () => {
    it('completes sgnodes scopes after a space', () => {
      const values = completeCommand(8080, 'sgnodes ').map((c) => c.value);
      expect(values).to.deep.equal(['all', 'roots', 'counts']);
    });

    it('filters subcommands by prefix', () => {
      expect(completeCommand(8080, 'sgnodes r').map((c) => c.value)).to.deep.equal(['roots']);
    });

    it('completes sgperf actions', () => {
      const values = completeCommand(8080, 'sgperf ').map((c) => c.value);
      expect(values).to.deep.equal(['start', 'clear', 'report', 'stop']);
    });

    it('returns nothing for a command with no fixed subcommands', () => {
      expect(completeCommand(8080, 'chanperf ')).to.be.empty;
      expect(completeCommand(8085, 'print ')).to.be.empty;
    });

    it('stops completing once a second argument has begun', () => {
      expect(completeCommand(8080, 'sgnodes all ')).to.be.empty;
    });

    it('returns nothing for an unknown subcommand prefix', () => {
      expect(completeCommand(8080, 'sgnodes zzz')).to.be.empty;
    });
  });

  describe('findCommand', () => {
    it('resolves by name and by alias', () => {
      expect(findCommand(8085, 'cont')?.name).to.equal('cont');
      expect(findCommand(8085, 'c')?.name).to.equal('cont');
      expect(findCommand(8085, '?')?.name).to.equal('print');
      expect(findCommand(8080, 'q')?.name).to.equal('exit');
    });

    it('is case- and whitespace-insensitive', () => {
      expect(findCommand(8080, '  FREE ')?.name).to.equal('free');
    });

    it('returns undefined for an unknown command', () => {
      expect(findCommand(8080, 'nope')).to.be.undefined;
    });
  });

  describe('isDestructiveCommand', () => {
    it('flags genkey and remove_plugin on 8080', () => {
      expect(isDestructiveCommand(8080, 'genkey')).to.be.true;
      expect(isDestructiveCommand(8080, 'remove_plugin dev')).to.be.true;
    });

    it('does not flag ordinary commands', () => {
      expect(isDestructiveCommand(8080, 'chanperf -r 5')).to.be.false;
      expect(isDestructiveCommand(8085, 'bt')).to.be.false;
    });

    it('does not flag an empty or unknown line', () => {
      expect(isDestructiveCommand(8080, '')).to.be.false;
      expect(isDestructiveCommand(8080, '   ')).to.be.false;
      expect(isDestructiveCommand(8080, 'nope')).to.be.false;
    });

    it('ignores arguments that merely contain a destructive name', () => {
      expect(isDestructiveCommand(8080, 'print genkey')).to.be.false;
    });
  });
});
