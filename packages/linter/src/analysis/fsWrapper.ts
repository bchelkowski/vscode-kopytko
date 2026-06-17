import * as fs from 'fs';

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/**
 * Thin fs wrapper. All filesystem access goes through this module so that
 * tests can stub individual functions via `sinon.stub(fsWrapper, 'existsSync')`.
 *
 * Exported as a mutable object (not direct function exports) to ensure
 * property descriptors remain configurable under all module systems.
 */
const fsWrapper = {
  existsSync(filePath: string): boolean {
    return fs.existsSync(filePath);
  },

  readFileSync(filePath: string, encoding: BufferEncoding): string {
    return fs.readFileSync(filePath, encoding) as string;
  },

  readdirSync(dirPath: string): string[] {
    return fs.readdirSync(dirPath) as string[];
  },

  readdirTyped(dirPath: string): DirEntry[] {
    return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  },
};

export default fsWrapper;
