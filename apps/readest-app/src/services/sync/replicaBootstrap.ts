import { dictionaryAdapter } from './adapters/dictionary';
import { fontAdapter } from './adapters/font';
import { textureAdapter } from './adapters/texture';
import { opdsCatalogAdapter } from './adapters/opdsCatalog';
import { settingsAdapter } from './adapters/settings';
import { getReplicaAdapter, registerReplicaAdapter } from './replicaRegistry';
import type { ReplicaAdapter } from './replicaRegistry';

const KNOWN_ADAPTERS: ReplicaAdapter<unknown>[] = [
  dictionaryAdapter as unknown as ReplicaAdapter<unknown>,
  fontAdapter as unknown as ReplicaAdapter<unknown>,
  textureAdapter as unknown as ReplicaAdapter<unknown>,
  opdsCatalogAdapter as unknown as ReplicaAdapter<unknown>,
  settingsAdapter as unknown as ReplicaAdapter<unknown>,
];

let didBootstrap = false;

export const bootstrapReplicaAdapters = (): void => {
  if (didBootstrap) return;
  for (const adapter of KNOWN_ADAPTERS) {
    if (getReplicaAdapter(adapter.kind)) continue;
    registerReplicaAdapter(adapter);
  }
  didBootstrap = true;
};

export const __resetBootstrapForTests = (): void => {
  didBootstrap = false;
};
