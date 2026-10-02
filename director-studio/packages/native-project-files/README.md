# Native project files: isolated adapter

This module prepares account-managed project files and complete portable exports. It is **not connected to the current editor, MCP tools, or server storage**. Existing D1/R2 data and application defaults remain untouched. Tests use synthetic host APIs and media; no native persistence or reopening across chats has been demonstrated.

## Verified API contracts

The installed `@openai/mcp-extensions` **0.1.0** README and `dist/app/resources.{d.ts,js}` expose `resources.read({uri, representation})` and `resources.write(uri, {text | blob, ifMatch})`. Read contents include parsed `openaiMetadata.etag` and `writable`. Writes return `saved`, `conflict`, or `too-large`. The extension may be absent after connection. The installed SDK's separate `files` extension only provides `open(path)`; it does not provide resource creation or uploads. The official [extension guide](https://developers.openai.com/plugins/build/extensions#file-viewers-and-editors) describes receiving a resource URI from a file entrypoint.

The optional [ChatGPT File APIs](https://developers.openai.com/plugins/reference#file-apis) provide upload, library selection, and fresh temporary download URLs. `HostFileLibrary` requests library storage when uploading, records the actual returned file ID, and marks its durability **requested-unverified**. Selection returns plugin-authorized library files. Neither a selected ID nor an upload request proves future cross-chat availability. No documented conversion from `fileId` to `resourceUri` is used.

## Implemented behavior

`ProjectFile` stores a validated Studio document, project identity/revision, bounded asset references, and JSON `state` for remaining canonical history and metadata. Core document schemas and asset links are checked. Unmapped fields are rejected rather than silently dropped; a legacy migration must explicitly preserve and map them. Asset locations allow an opaque host resource URI, a host file ID, or a relative content-addressed portable media path. The adapter deliberately rejects HTTP resource handles, signed download URLs, blob/data URLs, and transient URL fields. This is its storage policy, not an assertion that the SDK forbids all HTTP resource identifiers.

`HostProjectFiles` accepts the connected SDK's `read`/`write` methods through injection. It reads the exact resource, retains observed permissions and etag privately, and writes with mandatory `ifMatch`. Read-only files or absent etags cannot be overwritten. Saved writes advance revision; conflicts and oversized writes retain the unsaved draft. Host errors return an explicit unsaved result. A failed write may have reached the host: reopen and compare before retrying. No error invokes server persistence, widget state, localStorage, or an unconditional write.

```ts
// Use an actual resource URI received from the host's file entrypoint.
const files = new HostProjectFiles(openaiExtensions.resources);
const base = await files.open(hostFileInput.file.resourceUri);
const edited = structuredClone(base.project);
edited.title = 'New title';
const result = await files.save(base, edited);
// For conflict: reopen, present the differences, and merge explicitly.
```

`readHostResourceAsset` reauthorizes a stored media URI through the current host and verifies byte length/SHA256. `HostFileLibrary.withDownload` requests access to a stored file ID again and supplies the URL only to a transient consumer. Imported IDs are references, never permissions. The consumer must discard URLs and verify downloaded media against its asset hash before export or use.

`createPortableBundle` requires every referenced asset's actual bytes, verifies their hashes, deduplicates equal media, and returns a project JSON string plus a `media/<sha256>` file map. `openPortableBundle` checks the complete set before returning a project. The caller must save/download **both** the JSON and media directory or package them together; a JSON file containing host references alone is not a complete local backup. Physical browser downloads, filesystem atomic rename, and ZIP UI are not implemented here.

Host operations and generic project JSON parsing/serialization default to 2MiB JSON. The explicit local `createPortableBundle`/`openPortableBundle` recovery path has a separate 16MiB JSON default. Both retain 1,024 asset references, depth64, 128MiB per media file and 512MiB per portable bundle, including the JSON bytes. `DEFAULT_LIMITS` and `DEFAULT_PORTABLE_LIMITS` expose these product limits; overrides must be positive safe integers and are enforced during validation. They are configurable adapter limits, not ChatGPT quotas.

When `HostProjectFiles.save` returns `too-large`, the caller must retain `unsavedProject`, obtain every referenced media asset's actual bytes, and explicitly pass them to `createPortableBundle`. A draft between 2MiB and 16MiB can then be recovered with its document, history and media intact. This does not increase the host limit: the default host adapter still refuses to reopen oversized JSON. If local JSON exceeds 16MiB, recovery returns a `ProjectFileError` with code `too-large`; the caller must keep the unsaved draft in memory and present the overflow state until the user explicitly chooses a larger bounded local limit or reduces the project. A failed local recovery performs no download or persistence and must not silently omit state or media.

The generic `state` JSON is preserved but does not replace validation of each domain-specific historical operation during migration. This isolated prototype remains unwired; no backend TTL or cross-chat persistence has been implemented or verified.

## Check locally

From this package directory:

```sh
../../node_modules/.bin/vitest run --config vitest.config.ts
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
```

See [the rollout and legacy-data plan](../../apps/extension/release/native-storage-plan.md). Native host creation, resource size/format support, file-library availability, authorization across accounts, and reopening in another chat remain acceptance gates. The existing ChatGPT computer-use security block must not be bypassed to obtain that proof.
