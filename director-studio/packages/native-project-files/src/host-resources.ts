import type { OpenAIResourceReadResult, OpenAIResources } from '@openai/mcp-extensions/app';
import { OpenAIResourceWriteResultSchema } from '@openai/mcp-extensions/app';
import { ProjectFileError, digest, isOpaqueHostResourceUri, limitsWith, parseProjectFile, readProjectText, serializeProjectFile, type ProjectAsset, type ProjectFile, type ProjectFileLimits } from './project-file.ts';
export type ResourceApi = Pick<OpenAIResources, 'read' | 'write'>;
export interface ProjectSnapshot { readonly uri: string; readonly etag: string | null; readonly writable: boolean; readonly project: ProjectFile; }
export type SaveResult =
 | { outcome: 'saved'; snapshot: ProjectSnapshot }
 | { outcome: 'conflict'; currentEtag: string; unsavedProject: ProjectFile }
 | { outcome: 'too-large'; maxBytes: number; unsavedProject: ProjectFile }
 | { outcome: 'unavailable'; reason: 'resource-api-missing' | 'read-only' | 'etag-required'; unsavedProject: ProjectFile }
 | { outcome: 'host-error'; unsavedProject: ProjectFile };
interface Observed { uri: string; etag: string | null; writable: boolean; id: string; revision: number; }
/** Inject the connected SDK extension. This class never creates a URI or uses a backend fallback. */
export class HostProjectFiles {
 private readonly observed = new WeakMap<ProjectSnapshot, Observed>();
 private readonly limits: ProjectFileLimits;
 constructor(private readonly resources: ResourceApi | undefined, overrides: Partial<ProjectFileLimits> = {}) { this.limits = limitsWith(overrides); }
 private snapshot(uri: string, project: ProjectFile, etag: string | null, writable: boolean): ProjectSnapshot {
  const snapshot = { uri, project: structuredClone(project), etag, writable };
  this.observed.set(snapshot, { uri, etag, writable, id: project.id, revision: project.revision });
  return snapshot;
 }
 async open(uri: string): Promise<ProjectSnapshot> {
  if (!this.resources) throw new ProjectFileError('host-unavailable', 'Host resource support is unavailable; use an explicit portable project file.');
  if (!isOpaqueHostResourceUri(uri) || uri.length > 1024) throw new ProjectFileError('invalid', 'Expected an opaque host-supplied resource URI.');
  const result: OpenAIResourceReadResult = await this.resources.read({ uri, representation: 'text' });
  if (result.contents.length !== 1 || result.contents[0]?.uri !== uri) throw new ProjectFileError('invalid', 'Host returned an ambiguous or different project resource.');
  const content = result.contents[0];
  let text: string;
  if ('text' in content) text = content.text;
  else {
   if (content.blob.length > Math.ceil(this.limits.maxJsonBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content.blob)) throw new ProjectFileError('invalid', 'Invalid or oversized project resource blob.');
   try { text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content.blob), char => char.charCodeAt(0))); }
   catch { throw new ProjectFileError('invalid', 'Project resource blob is not UTF-8.'); }
  }
  const project = readProjectText(text, this.limits);
  const etag = content.openaiMetadata?.etag;
  return this.snapshot(uri, project, typeof etag === 'string' && etag.trim().length > 0 ? etag : null, content.openaiMetadata?.writable === true);
 }
 async save(base: ProjectSnapshot, changed: ProjectFile): Promise<SaveResult> {
  const observed = this.observed.get(base);
  if (!observed) throw new ProjectFileError('invalid', 'Save requires a snapshot read by this adapter.');
  const project = parseProjectFile(changed, { ...this.limits, maxJsonBytes: Number.MAX_SAFE_INTEGER });
  if (project.id !== observed.id || project.revision !== observed.revision) throw new ProjectFileError('invalid', 'Edits must retain the read project identity and base revision.');
  if (!this.resources) return { outcome: 'unavailable', reason: 'resource-api-missing', unsavedProject: project };
  if (!observed.writable) return { outcome: 'unavailable', reason: 'read-only', unsavedProject: project };
  if (!observed.etag) return { outcome: 'unavailable', reason: 'etag-required', unsavedProject: project };
  project.revision++;
  const text = serializeProjectFile(project, { ...this.limits, maxJsonBytes: Number.MAX_SAFE_INTEGER });
  if (new TextEncoder().encode(text).length > this.limits.maxJsonBytes) { project.revision--; return { outcome: 'too-large', maxBytes: this.limits.maxJsonBytes, unsavedProject: project }; }
  let result;
  try { result = OpenAIResourceWriteResultSchema.parse(await this.resources.write(observed.uri, { text, ifMatch: observed.etag })); }
  catch { project.revision--; return { outcome: 'host-error', unsavedProject: project }; }
  if (result.outcome === 'saved') {
   if (!result.etag.trim()) { project.revision--; return { outcome: 'host-error', unsavedProject: project }; }
   this.observed.delete(base); // The successful base cannot accidentally be replayed.
   return { outcome: 'saved', snapshot: this.snapshot(observed.uri, project, result.etag, true) };
  }
  project.revision--;
  if (result.outcome === 'conflict') return { outcome: 'conflict', currentEtag: result.etag, unsavedProject: project };
  if (result.outcome === 'too-large' && Number.isSafeInteger(result.maxBytes) && result.maxBytes >= 0) return { outcome: 'too-large', maxBytes: result.maxBytes, unsavedProject: project };
  return { outcome: 'host-error', unsavedProject: project };
 }
}
/** A stored resource URI is reauthorized by the host and its bytes verified before use. */
export async function readHostResourceAsset(resources: ResourceApi | undefined, asset: ProjectAsset, overrides: Partial<ProjectFileLimits> = {}): Promise<Uint8Array> {
 const limits = limitsWith(overrides);
 if (!resources) throw new ProjectFileError('host-unavailable', 'Host resources are unavailable.');
 if (asset.location.kind !== 'host-resource' || !isOpaqueHostResourceUri(asset.location.uri)) throw new ProjectFileError('invalid', 'Expected an opaque resource asset reference.');
 if (asset.bytes > limits.maxMediaBytes) throw new ProjectFileError('too-large', 'Resource asset exceeds the configured media limit.');
 const result = await resources.read({ uri: asset.location.uri, representation: 'blob' });
 const content = result.contents[0];
 if (result.contents.length !== 1 || !content || content.uri !== asset.location.uri) throw new ProjectFileError('invalid', 'Host returned a different asset resource.');
 let bytes: Uint8Array;
 if ('blob' in content) {
  if (content.blob.length > Math.ceil(limits.maxMediaBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content.blob)) throw new ProjectFileError('invalid', 'Invalid resource asset blob.');
  bytes = Uint8Array.from(atob(content.blob), char => char.charCodeAt(0));
 } else bytes = new TextEncoder().encode(content.text);
 if (bytes.length !== asset.bytes || await digest(bytes) !== asset.sha256) throw new ProjectFileError('integrity', 'Host resource asset differs from its recorded bytes and SHA256.');
 return bytes;
}
