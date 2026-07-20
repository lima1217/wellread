import { lstatSync, readlinkSync } from 'node:fs';

/** Sync Node realpath lookup for scopedFs authorize* calls. */
export function createNodeRealpathLookup() {
  return (absoluteHostPath) => {
    try {
      const st = lstatSync(absoluteHostPath);
      if (st.isSymbolicLink()) {
        return { kind: 'symlink', target: readlinkSync(absoluteHostPath) };
      }
      return { kind: st.isDirectory() ? 'dir' : 'file' };
    } catch {
      return { kind: 'missing' };
    }
  };
}
