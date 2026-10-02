# Retention and request-process proposal

Prepared 2026-10-02 from the current implementation. This is an engineering proposal, not an active deletion service or a published retention promise. It introduces no arbitrary storage period or personal-address requirement.

## What the implementation actually retains

`server/storage.ts` and `migrations/0001_projects.sql` persist owner-scoped project JSON, settings and immutable document/source versions in D1. Project JSON includes material metadata, questions/decisions, approvals, receipts, jobs and upload records. `server/service.ts` stores uploaded/imported/derived media, authored code and exports in R2 under an owner-hash/project prefix. Replacing material can leave older object bytes; history may still refer to them.

`server/transfers.ts` gives incomplete uploads a 24-hour **validity** period. Successful completion attempts to delete temporary chunks when the R2 binding supports deletion. Expiry has no scheduled cleanup, and a failed chunk deletion is swallowed. This is not a 24-hour erasure policy. Rejecting assets, cancelling jobs, disconnecting the plugin or clearing browser preferences does not delete the cloud project. No complete project/account erasure endpoint or tool exists.

`.openai/hosting.json` binds Sites D1 and R2; it specifies no geographic location, application retention period or backup policy. The exposed Sites metadata does not establish actual D1/R2 location, provider-log retention or backup deletion. Do not invent those values. Host conversations, Fal jobs and Remotion request logs are separate provider records.

## Concrete proposed policy for this release

Persist projects, versions, media and settings so users can reopen them. Describe the current absence of automatic general deletion accurately. Offer a request through the confirmed support/privacy contact only after the operator has a verified execution path; no completion deadline or complete-backup-erasure claim is made in advance. The policy can state these present implementation facts without asking the user to choose an arbitrary number of days.

For temporary uploads, the next maintenance implementation should inventory expired incomplete uploads, reconcile their recorded chunk keys, delete only those keys and record failures for retry. It must preserve completed assets and anything referenced by history. Run this against synthetic fixtures before enabling it in production. The existing 24-hour validity supplies an engineering cutoff, but successful cleanup must be measured before a deletion guarantee is published.

## Request procedure to implement and verify

1. Receive a request at the published contact and identify the authenticated Director owner without collecting passwords, private session tokens or unrelated media.
2. Produce a dry-run inventory of that owner's D1 project/settings/version rows and all R2 objects under the owner's project and temporary prefixes. Include superseded bytes and incomplete uploads, rather than relying only on the current asset list.
3. Prevent that owner's active jobs/uploads from creating new objects during deletion; retain other owners' data and jobs.
4. Delete the inventoried owned R2 objects and D1 records through an authenticated operator capability, then re-inventory both stores. Handle partial failure explicitly. The current runtime lacks this complete operator workflow; writing this procedure does not make it available.
5. Report the verified application-store result and any provider-managed backup/log limitations. Separate access revocation from data erasure. Obtain platform documentation or support evidence for provider retention before promising backup deletion.

Meaningful acceptance covers a second unaffected owner, immutable versions, relinked old bytes, expired chunks, active jobs, partial R2 deletion failure and retry. No production deletion, account change or new maintenance schedule was performed.

## Inputs still needed

The actual public support/privacy contact and country choice remain factual publisher inputs. Additional identity/address or jurisdiction-specific text should be requested only when a concrete applicable requirement is identified; a placeholder in our draft is not such evidence. The current OpenAI [submission field reference](https://developers.openai.com/plugins/deploy/submission) requires four HTTPS information/policy URLs, but does not establish a universal public street-address or governing-law field. Portal legal attestations remain with the authorized developer. This proposal does not decide an unknown operator jurisdiction or legal basis.
