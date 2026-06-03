import * as fs from 'fs';

export function existsSync(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readFileSync(filePath: string, encoding: BufferEncoding): string {
  return fs.readFileSync(filePath, encoding) as string;
}
