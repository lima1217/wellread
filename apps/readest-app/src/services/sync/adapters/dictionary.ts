import { md5 } from '@/utils/md5';
import type { FieldEnvelope, FieldsObject, Manifest, ReplicaRow } from '@/types/replica';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';

export const DICTIONARY_KIND = 'dictionary';
export const DICTIONARY_SCHEMA_VERSION = 1;

const unwrapEnvelopeValue = (env: FieldEnvelope | undefined): unknown =>
  env && typeof env === 'object' && 'v' in env ? (env as FieldEnvelope).v : undefined;

const unwrapDictionaryFields = (fields: FieldsObject) => {
  const name = unwrapEnvelopeValue(fields['name']);
  const kind = unwrapEnvelopeValue(fields['kind']);
  const lang = unwrapEnvelopeValue(fields['lang']);
  const addedAt = unwrapEnvelopeValue(fields['addedAt']);
  const unsupported = unwrapEnvelopeValue(fields['unsupported']);
  const unsupportedReason = unwrapEnvelopeValue(fields['unsupportedReason']);

  return {
    name: typeof name === 'string' ? name : undefined,
    kind:
      kind === 'mdict' || kind === 'stardict' || kind === 'dict' || kind === 'slob'
        ? (kind as ImportedDictionary['kind'])
        : undefined,
    lang: typeof lang === 'string' ? lang : undefined,
    addedAt: typeof addedAt === 'number' ? addedAt : undefined,
    unsupported: unsupported === true ? true : undefined,
    unsupportedReason: typeof unsupportedReason === 'string' ? unsupportedReason : undefined,
  };
};

const filesFromManifest = (
  manifest: Manifest | null,
  kind: ImportedDictionary['kind'],
): ImportedDictionary['files'] => {
  const out: ImportedDictionary['files'] = {};
  if (!manifest) return out;

  const mdd: string[] = [];
  const css: string[] = [];

  for (const f of manifest.files) {
    const lower = f.filename.toLowerCase();
    if (lower.endsWith('.idx.offsets') || lower.endsWith('.syn.offsets')) continue;

    if (kind === 'mdict') {
      if (lower.endsWith('.mdx')) out.mdx = f.filename;
      else if (lower.endsWith('.mdd')) mdd.push(f.filename);
      else if (lower.endsWith('.css')) css.push(f.filename);
    } else if (kind === 'stardict') {
      if (lower.endsWith('.ifo')) out.ifo = f.filename;
      else if (lower.endsWith('.idx')) out.idx = f.filename;
      else if (lower.endsWith('.syn')) out.syn = f.filename;
      else if (lower.endsWith('.dict.dz') || lower.endsWith('.dict')) out.dict = f.filename;
    } else if (kind === 'dict') {
      if (lower.endsWith('.index')) out.index = f.filename;
      else if (lower.endsWith('.dict.dz') || lower.endsWith('.dict')) out.dict = f.filename;
    } else if (kind === 'slob') {
      if (lower.endsWith('.slob')) out.slob = f.filename;
    }
  }

  if (mdd.length > 0) out.mdd = mdd;
  if (css.length > 0) out.css = css;
  return out;
};

const buildLocalDictFromRow = (row: ReplicaRow, bundleDir: string): ImportedDictionary | null => {
  const fields = unwrapDictionaryFields(row.fields_jsonb);
  if (!fields.name || !fields.kind) return null;

  const dict: ImportedDictionary = {
    id: row.replica_id,
    contentId: row.replica_id,
    kind: fields.kind,
    name: fields.name,
    bundleDir,
    files: filesFromManifest(row.manifest_jsonb, fields.kind),
    addedAt: fields.addedAt ?? Date.now(),
    unavailable: true,
  };
  if (fields.lang !== undefined) dict.lang = fields.lang;
  if (fields.unsupported) dict.unsupported = true;
  if (fields.unsupportedReason) dict.unsupportedReason = fields.unsupportedReason;
  if (row.reincarnation) dict.reincarnation = row.reincarnation;

  return dict;
};

export interface DictionarySyncedFields {
  name: string;
  kind: ImportedDictionary['kind'];
  lang?: string;
  addedAt: number;
  unsupported?: boolean;
  unsupportedReason?: string;
}

export const primaryDictionaryFile = (d: ImportedDictionary): string | null => {
  switch (d.kind) {
    case 'mdict':
      return d.files.mdx ?? null;
    case 'stardict':
      return d.files.ifo ?? null;
    case 'dict':
      return d.files.dict ?? null;
    case 'slob':
      return d.files.slob ?? null;
    default:
      return null;
  }
};

export const enumerateDictionaryFiles = (
  d: ImportedDictionary,
): { logical: string; lfp: string; byteSize: number }[] => {
  const out: { logical: string; lfp: string; byteSize: number }[] = [];
  const push = (filename?: string) => {
    if (!filename) return;
    out.push({
      logical: filename,
      lfp: `${d.bundleDir}/${filename}`,
      byteSize: 0,
    });
  };
  switch (d.kind) {
    case 'mdict':
      push(d.files.mdx);
      d.files.mdd?.forEach(push);
      d.files.css?.forEach(push);
      break;
    case 'stardict':
      push(d.files.ifo);
      push(d.files.idx);
      push(d.files.dict);
      push(d.files.syn);
      break;
    case 'dict':
      push(d.files.dict);
      push(d.files.index);
      break;
    case 'slob':
      push(d.files.slob);
      break;
  }
  return out;
};

export const computeDictionaryReplicaId = (
  partialMd5: string,
  byteSize: number,
  filenames: string[],
): string => {
  const sortedFilenames = [...filenames].sort();
  return md5(`${partialMd5}|${byteSize}|${sortedFilenames.join(',')}`);
};

export const dictionaryAdapter: ReplicaAdapter<ImportedDictionary> = {
  kind: DICTIONARY_KIND,
  schemaVersion: DICTIONARY_SCHEMA_VERSION,

  pack(d: ImportedDictionary): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      name: d.name,
      kind: d.kind,
      addedAt: d.addedAt,
    };
    if (d.lang !== undefined) fields['lang'] = d.lang;
    if (d.unsupported) fields['unsupported'] = true;
    if (d.unsupportedReason) fields['unsupportedReason'] = d.unsupportedReason;
    return fields;
  },

  unpack(fields: Record<string, unknown>): ImportedDictionary {
    return {
      id: '',
      kind: fields['kind'] as ImportedDictionary['kind'],
      name: String(fields['name'] ?? ''),
      bundleDir: '',
      files: {},
      lang: fields['lang'] !== undefined ? String(fields['lang']) : undefined,
      addedAt: Number(fields['addedAt'] ?? 0),
      unsupported: fields['unsupported'] === true ? true : undefined,
      unsupportedReason:
        fields['unsupportedReason'] !== undefined ? String(fields['unsupportedReason']) : undefined,
    };
  },

  async computeId(d: ImportedDictionary): Promise<string> {
    return d.id;
  },

  unpackRow(row: ReplicaRow, bundleDir: string): ImportedDictionary | null {
    return buildLocalDictFromRow(row, bundleDir);
  },

  binary: {
    localBaseDir: 'Dictionaries',
    enumerateFiles: enumerateDictionaryFiles,
  },
};
