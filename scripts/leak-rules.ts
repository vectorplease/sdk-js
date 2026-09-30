/** Scoped packages that are public. Every other `@vectorplease/*` name is private. */
export const PUBLIC_PACKAGES = ['sdk', 'mcp'];

const PRIVATE_PACKAGE = /@vectorplease\/([a-z0-9][a-z0-9-]*)/g;
const PRIVATE_REPO = /vectorplease\/vectorplease\b/g;

export interface Leak {
  file: string;
  line: number;
  match: string;
}

/** References to private packages or the private repo in one file's text. */
export function findLeaks(file: string, text: string): Leak[] {
  const leaks: Leak[] = [];
  text.split('\n').forEach((content, index) => {
    for (const match of content.matchAll(PRIVATE_PACKAGE)) {
      if (!PUBLIC_PACKAGES.includes(match[1] as string))
        leaks.push({ file, line: index + 1, match: match[0] });
    }
    for (const match of content.matchAll(PRIVATE_REPO))
      leaks.push({ file, line: index + 1, match: match[0] });
  });
  return leaks;
}
