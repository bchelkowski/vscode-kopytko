import '../roku/vscode-mock';

/** Map-backed vscode.Memento fake. */
export class MockMemento {
  private readonly map = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T {
    return (this.map.has(key) ? this.map.get(key) : defaultValue) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.map.delete(key);
    } else {
      // Match real Memento semantics: values round-trip through JSON.
      this.map.set(key, JSON.parse(JSON.stringify(value)));
    }
  }

  keys(): readonly string[] {
    return [...this.map.keys()];
  }

  /** Test helper: the raw stored value for asserting on persistence content. */
  raw(key: string): unknown {
    return this.map.get(key);
  }
}

/** Map-backed vscode.SecretStorage fake. */
export class MockSecretStorage {
  readonly secrets = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  onDidChange = (): { dispose(): void } => ({ dispose: () => {} });
}
