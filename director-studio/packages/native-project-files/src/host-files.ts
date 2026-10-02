import { ProjectFileError, assetLocationSchema, limitsWith, type HostFileLocation, type ProjectFileLimits } from './project-file.ts';
/** Optional window.openai signatures from the official plugin File APIs; distinct from SDK files.open. */
export interface ChatGptFileApi {
 uploadFile?: (file: File, options?: { library?: boolean }) => Promise<{ fileId: string }>;
 selectFiles?: () => Promise<Array<{ fileId: string; fileName: string; mimeType: string }>>;
 getFileDownloadUrl?: (input: { fileId: string }) => Promise<{ downloadUrl: string }>;
}
export interface SelectedHostFile { location: HostFileLocation; fileName: string; mimeType: string; }
/** Only actual host results establish new file references; download URLs are used transiently. */
export class HostFileLibrary {
 private readonly observed = new Map<string, HostFileLocation>();
 private readonly limits: ProjectFileLimits;
 constructor(private readonly host: ChatGptFileApi | undefined, overrides: Partial<ProjectFileLimits> = {}) { this.limits = limitsWith(overrides); }
 async upload(file: File): Promise<HostFileLocation> {
  if (!this.host?.uploadFile) throw new ProjectFileError('host-unavailable', 'Host file upload is unavailable; keep a portable local copy.');
  if (file.size > this.limits.maxMediaBytes) throw new ProjectFileError('too-large', 'Media exceeds the configured upload limit.');
  const result = await this.host.uploadFile(file, { library: true });
  const location = assetLocationSchema.parse({ kind: 'host-file', fileId: result.fileId, library: 'requested-unverified' }) as HostFileLocation;
  this.observed.set(location.fileId, structuredClone(location));
  return location; // No API field confirms that the optional library actually retained this upload.
 }
 async select(): Promise<SelectedHostFile[]> {
  if (!this.host?.selectFiles) throw new ProjectFileError('host-unavailable', 'Host file library selection is unavailable.');
  const result = await this.host.selectFiles();
  if (result.length > this.limits.maxAssets) throw new ProjectFileError('too-large', 'Too many selected host files.');
  const selected = result.map(file => {
   if (typeof file.fileName !== 'string' || file.fileName.length > 512 || typeof file.mimeType !== 'string' || file.mimeType.length > 255) throw new ProjectFileError('invalid', 'Host file metadata is invalid.');
   const location = assetLocationSchema.parse({ kind: 'host-file', fileId: file.fileId, library: 'selected' }) as HostFileLocation;
   return { location, fileName: file.fileName, mimeType: file.mimeType };
  });
  for (const file of selected) this.observed.set(file.location.fileId, structuredClone(file.location));
  return selected;
 }
 reference(fileId: string): HostFileLocation {
  const location = this.observed.get(fileId);
  if (!location) throw new ProjectFileError('unobserved-file', 'A new file reference must come from a host upload or selection.');
  return structuredClone(location);
 }
 async withDownload<T>(location: HostFileLocation, consume: (temporaryUrl: string) => Promise<T>): Promise<T> {
  const parsed = assetLocationSchema.parse(location);
  if (parsed.kind !== 'host-file') throw new ProjectFileError('invalid', 'Expected a host file reference.');
  if (!this.host?.getFileDownloadUrl) throw new ProjectFileError('host-unavailable', 'Host file downloads are unavailable.');
  // Reauthorize stored IDs through the current host. IDs in imported JSON are not permissions.
  const { downloadUrl } = await this.host.getFileDownloadUrl({ fileId: parsed.fileId });
  const url = new URL(downloadUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new ProjectFileError('invalid', 'Host returned an invalid temporary download URL.');
  return consume(downloadUrl);
 }
}
