import { BrowserCapabilityError } from './types.ts';

// Each independently built editor/media document has its own module state. Only the trusted
// media entry point activates this role; being an opaque host widget does not grant it.
let mediaSandbox = false;
function assertOpaqueFrame(): void {
  if (typeof window === 'undefined' || window === window.parent || window.origin !== 'null') throw new BrowserCapabilityError('component-sandbox', 'Komponenten benötigen die isolierte Medienvorschau');
  let parentAccessible = false; try { parentAccessible = !!window.parent.document; } catch { /* opaque frame */ }
  if (parentAccessible) throw new BrowserCapabilityError('component-sandbox', 'Komponenten dürfen keinen Zugriff auf den Editor haben');
}
export function activateMediaSandbox(): void { assertOpaqueFrame(); mediaSandbox = true; }
export function assertMediaSandboxRole(): void {
  if (!mediaSandbox) throw new BrowserCapabilityError('component-sandbox', 'Dieses Widget ist der Editor; Komponenten benötigen das separate Medienframe');
  assertOpaqueFrame();
}
