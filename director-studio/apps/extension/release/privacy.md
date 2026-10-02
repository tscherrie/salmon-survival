# AI Director Studio — privacy policy draft

Status: unpublished technical and policy draft, prepared 2 October 2026. The operator must complete the marked fields and approve the data practices before this becomes the public policy. Effective date: **[CONFIRM after approval]**.

## Who operates the service

AI Director Studio is an independent project operated by **Jeremias Grenzebach**, as confirmed by the operator. No unverified street address or jurisdiction is inserted. Additional jurisdiction-specific identity details require a concrete applicable requirement; our template is not evidence of one. Contact for privacy questions or requests: **l@lll.uno**, expressly confirmed for public use by the operator. The existing developer label uses the same name; the individual Verified identity is observed in a read-only Portal view, while the canonical Sites-app submission-project mapping remains unresolved. This draft makes no legal or Portal attestation.

## Data used by Director Studio

The hosting platform supplies an authenticated user identifier and email address to authorize requests. Director uses the identifier to associate projects and settings with their owner. The current application database stores the owner identifier; application code does not automatically copy the supplied authentication email into its project or settings tables. Hosting-platform processing and logs are a separate matter.

Stored project data can include project titles and briefs, questions and answers, decisions, approvals, document and website source, version history, checkpoints, asset metadata and lineage, transcript or analysis results, cost estimates and receipts, and processing-job status and errors. Uploaded or imported source files, thumbnails, derived media and exports are stored as file objects. Names and metadata can themselves contain personal information. Public-URL imports download the requested file into the project; the source server receives that download request.

The editor processes the files and project data needed for its current view and operations on the user's device. It can keep display preferences and hints in browser storage and use in-memory caches and temporary URLs for media and runtime files. Browser exports and analysis run on the device while an editor executor is available, and their outputs and receipts may subsequently be saved to the project. Local rendering does not mean the whole service is local-only.

## Why the data is used

Director uses this information to authenticate access, save and reopen projects, edit and restore documents, manage approved work, process material, generate previews and exports, and identify processing failures. **[CONFIRM the operator's applicable legal basis for each purpose, and any required legitimate-interest description or consent process.]** A feature description is not a legal-basis determination.

## Native host, Fal and other network requests

Project information is exchanged with the native ChatGPT Work or Codex host through tool requests and results. Where supported, selection context supplies the project title, identifiers, version and selected references for a future chat turn. Copying the fallback into a conversation also discloses that text to the host. Director does not independently retrieve the user's whole chat history or hidden memory and does not operate a separate inference loop or collect a model-provider API key.

AI media generation and transcription require a separately installed official Fal plugin and connected account. When the user approves that workflow, the host may send the chosen prompt, settings and input material to Fal and import the resulting media and receipt into Director. Fal and the native host have their own data practices and account terms. Director does not obtain their private API tokens. Deleting a Director record would not by itself delete a host conversation or a Fal-provider job.

The deployment uses OpenAI Sites hosting with Cloudflare D1 project/settings storage and R2 file storage. Browser compilation may request allowed dependency modules from `esm.sh` without application credentials. Website or media source can contain external links or resources. Hosting and dependency providers can process request metadata and keep their own logs. **[CONFIRM the final provider list, processing arrangements, hosting region, international-transfer safeguards and actual platform-log retention.]**

Remotion Web Renderer also attempts a licensing/usage POST to `https://www.remotion.pro/api/track/register-usage-point` during its renders, independently of Fal and the native model host. The pinned dependency sends `event: "web-render"`, the browser's `window.location.origin` as `host`, and the `succeeded`, `isStill` and `isProduction` flags. In an opaque native frame the origin is the string `"null"`; an ordinary browser frame can report its origin. Director uses the confirmed free-license option, which sends `apiKey: null`. This event payload includes no clips, text, project IDs or Director owner credentials. The recipient nevertheless receives network information such as the request IP address and headers. Network failures can cause retries.

The release configuration permits this exact Remotion recipient; the actual host's policy may still block the request. Earlier controlled evidence of blocked telemetry is not a promise that it will remain blocked. Director currently provides no switch that disables these dependency usage requests. The operator has confirmed an independent entity of at most three people, meeting Remotion's free-license size criterion; free licensing does not mean zero external telemetry. **[CONFIRM the operator's policy/legal basis and recipient arrangements for this usage processing.]**

## Access and security

Project and file endpoints require the hosting boundary's authenticated identity and check project ownership. Other users cannot retrieve a project by merely knowing its identifier. Authored website and component code runs in isolated browser frames; these frames receive the material required for rendering, without the owner's general authenticated project API capability. These implementation controls are not a claim of end-to-end encryption, immunity from security incidents or complete provider-level isolation.

## Retention and deletion

The current release persists project history, files, settings and receipts across reopening and deployment changes. It has no user-facing complete project/account deletion workflow or general automatic project-retention schedule. Replacing a file, rejecting an asset, cancelling a job, clearing browser preferences or disconnecting the plugin is not a verified complete erasure operation.

Chunked uploads have a 24-hour validity period. Successful upload completion attempts to remove temporary chunks; expiry alone is not implemented as guaranteed storage deletion. Older media objects, backups and platform logs need an executable retention/request plan. The concrete engineering proposal is in [retention-proposal.md](retention-proposal.md); it makes no unverified deadline or automatic-erasure claim.

The concrete proposal is to retain project history and files for reopening and provide an authenticated request route through the confirmed contact once an executable operator process has been verified. It introduces no arbitrary general storage period. The current release cannot promise complete project/account erasure. [retention-proposal.md](retention-proposal.md) specifies the D1/R2 inventory, old-object and upload cleanup, concurrency protection, recheck and failure handling to implement before promising that process. Provider backup/log handling remains unverified; no deletion deadline is promised by this draft. Users can download supported exports and retain their own source files; these exports are not described as a complete personal-data access report.

## Requests and changes

For a request concerning access, correction, export or deletion, use **l@lll.uno** and provide only the information needed to locate and verify the relevant account. Never send passwords, API keys or unrelated private media. The contact does not establish a complete deletion procedure or completion deadline. **[CONFIRM applicable rights, complaint route and the relevant authority for the selected operator/jurisdiction.]** Publish material policy changes with an effective date and an appropriate notice method **[CONFIRM]**.

Preparation notes and unresolved decisions are in [publisher-approval.md](publisher-approval.md). This file is not a published policy or a legal attestation.
