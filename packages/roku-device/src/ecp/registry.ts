export interface RegistrySection {
  name: string;
  items: Array<{ key: string; value: string }>;
}

export interface RegistryData {
  devId: string;
  plugins: string;
  spaceAvailable: string;
  sections: RegistrySection[];
  status?: string;
  error?: string;
}

/**
 * Parses the XML response from `GET /query/registry/<channelId>`.
 *
 * Example response:
 * ```xml
 * <plugin-registry>
 *   <registry>
 *     <dev-id>e090ac01...</dev-id>
 *     <plugins>dev</plugins>
 *     <space-available>9168</space-available>
 *     <sections>
 *       <section>
 *         <name>UserInfo</name>
 *         <items>
 *           <item><key>UserId</key><value>1429</value></item>
 *         </items>
 *       </section>
 *     </sections>
 *   </registry>
 * </plugin-registry>
 * ```
 */
export function parseRegistryXml(xml: string): RegistryData {
  const leafTag = (src: string, tag: string): string => {
    const m = src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return m?.[1] ?? '';
  };

  const devId = leafTag(xml, 'dev-id');
  const plugins = leafTag(xml, 'plugins');
  const spaceAvailable = leafTag(xml, 'space-available');
  const status = leafTag(xml, 'status') || undefined;
  const error = leafTag(xml, 'error') || undefined;

  const sections: RegistrySection[] = [];
  const sectionPattern = /<section>([\s\S]*?)<\/section>/g;
  let secMatch: RegExpExecArray | null;

  while ((secMatch = sectionPattern.exec(xml)) !== null) {
    const secBody = secMatch[1];
    const name = leafTag(secBody, 'name');
    const items: Array<{ key: string; value: string }> = [];

    const itemPattern = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemPattern.exec(secBody)) !== null) {
      const itemBody = itemMatch[1];
      items.push({
        key: leafTag(itemBody, 'key'),
        value: leafTag(itemBody, 'value'),
      });
    }

    sections.push({ name, items });
  }

  return { devId, plugins, spaceAvailable, sections, status, error };
}
