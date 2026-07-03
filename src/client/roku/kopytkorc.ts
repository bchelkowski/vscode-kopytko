import * as fs from 'fs';
import * as path from 'path';

/**
 * Reads the `.kopytkorc` configuration file from the given workspace root
 * and returns the list of defined environment names.
 *
 * @param workspaceRoot Absolute path to the project root
 * @returns Array of environment name strings, or empty array if no environments are defined
 */
export function getAvailableEnvironments(workspaceRoot: string): string[] {
  const rcPath = path.join(workspaceRoot, '.kopytkorc');

  try {
    if (!fs.existsSync(rcPath)) return [];

    const content = fs.readFileSync(rcPath, 'utf-8');
    const rc = JSON.parse(content);

    if (rc && typeof rc.environments === 'object' && rc.environments !== null) {
      return Object.keys(rc.environments);
    }

    return [];
  } catch {
    return [];
  }
}
