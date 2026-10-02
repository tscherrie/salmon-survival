# AI Director Studio — privacy policy

Last updated: 2 October 2026.

## Operator and scope

AI Director Studio is an independent project operated by **Jeremias Grenzebach**. Contact for privacy questions or requests: **l@lll.uno**.

This policy describes the current Director editor and this public information site. The information site has no application forms, file uploads or Director analytics scripts. Its hosting service can receive normal request information, including IP addresses and HTTP headers. Project processing takes place in the separately authenticated editor.

## Data used by the editor

The hosting platform supplies an authenticated user identifier and email address to authorize requests. Director uses the identifier to associate projects and settings with their owner. The application database stores the owner identifier; application code does not automatically copy the supplied authentication email into project or settings tables. Hosting-platform processing and logs are separate.

Stored project information can include titles and briefs, questions and answers, decisions, approvals, document and website source, version history, checkpoints, asset metadata and lineage, transcripts or analysis results, cost estimates and receipts, and job status and errors. Uploaded or imported files, thumbnails, derived media and exports are stored as file objects. Names and metadata can themselves contain personal information.

Public-URL imports download the requested file into the project. The source server receives that download request. The editor can keep display preferences and hints in browser storage and use memory caches and temporary media URLs. Preview, analysis and export processing runs on the user's device while the editor is open; output files and receipts may then be saved to the project. Local rendering does not mean that the whole service is local-only.

## Purposes

Director uses this information to authenticate access, save and reopen projects, edit and restore documents, manage user-approved work, process material, generate previews and exports, and identify processing failures. Avoid supplying personal information that is unnecessary for your project.

## Native host and external services

Project information is exchanged with the ChatGPT Work or Codex host through tool requests and results. Where supported, selection context supplies the project title, identifiers, version and selected references for a future chat turn. Copying the fallback into a conversation also gives that text to the host. Director does not independently retrieve the user's whole chat history or hidden memory and does not operate a separate model inference loop or collect a model-provider API key.

AI media generation and transcription require the separate official Fal plugin and the user's connected account. When the user approves that workflow, the host may send the selected prompt, settings and input material to Fal and import its media and receipt into Director. Fal and the native host have their own account terms and data practices. Director does not obtain their private API tokens. Deleting a Director record would not itself delete a host conversation or a Fal-provider job.

The editor uses OpenAI Sites hosting with Cloudflare D1 for project/settings storage and R2 for file storage. Browser compilation may request allowed dependency modules from esm.sh without application credentials. Authored website or media source can reference external resources. Hosting, dependency and source providers can receive request metadata and maintain their own logs. The deployment configuration does not establish a particular hosting region or provider log/backup retention period; this policy makes no such promise.

## Remotion rendering usage requests

Remotion Web Renderer attempts a licensing/usage POST to https://www.remotion.pro/api/track/register-usage-point during rendering, independently of Fal and the native host. The pinned code sends the event name web-render, the browser frame origin, and flags for success, still-image rendering and production mode. Director uses Remotion's free-license option, which sends a null API-key value. An opaque frame reports its origin as the string null.

That event payload contains no clips, text, project IDs or Director owner credentials. The recipient nevertheless receives network information such as the request IP address and headers. Failures can cause retries. The application permits that exact recipient and currently offers no switch to disable the dependency's usage requests; the host's own policy may still block them. Free licensing does not mean zero external telemetry.

## Access and security

Project and file requests require the hosting boundary's authenticated identity and check project ownership. Authored website and component code runs in isolated browser frames with the material needed for rendering, rather than the owner's general project API capability. These controls are not a promise of end-to-end encryption or immunity from incidents. Never send passwords, authentication tokens or API keys in project files or support messages.

## Retention and deletion

The current release persists project history, files, settings and receipts across reopening and deployments. There is no general automatic project-retention schedule or complete user-facing project/account deletion workflow. Replacing a file, rejecting an asset, cancelling a job, clearing browser preferences or disconnecting the plugin is not a complete erasure operation.

Incomplete uploads have a 24-hour validity period. Successful upload completion attempts to remove temporary chunks; expiry alone does not guarantee their deletion. Old file objects, temporary chunks and provider-managed logs/backups are not represented as erased by that expiry. No general storage period, deletion deadline or complete backup-erasure guarantee is promised.

Users can download supported exports and keep independent copies of their source files. Exports are not described as a complete personal-data access report. Contact **l@lll.uno** for questions or requests concerning access, correction, export or deletion, providing only what is needed to locate and verify the relevant account. The contact route does not imply that a complete deletion process has been implemented. Applicable statutory rights are not changed by this description of the current technical limits.

## Updates

Updates to this policy are published on this page with the last-updated date. For questions about the current practices, use **l@lll.uno**.
