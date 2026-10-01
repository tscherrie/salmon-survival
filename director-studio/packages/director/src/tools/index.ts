import { createTextAssetTool, getAssetTool, importUrlTool, rejectAssetTool, searchAssetsTool, updateAssetTool } from './assets.ts';
import { exportProjectTool, listSiteFilesTool, readSiteFileTool, renderStillTool, screenshotSiteTool, writeComponentTool, writeSiteFileTool } from './code.ts';
import { askUserTool, mergeCheckpointsTool, postUpdateTool, proposeCheckpointTool, setBriefTool } from './communication.ts';
import { applyDocumentOpsTool, getDocumentTool, restoreVersionTool } from './documents.ts';
import { awaitGenerationsTool, cancelGenerationTool, generateTool } from './generation.ts';
import { delegateTool, loadSkillTool, webFetchTool, webSearchTool } from './misc.ts';
import { estimateCostTool, getModelSchemaTool, searchModelsTool } from './models.ts';
import { analyzeAudioTool, checkAvSyncTool, contactSheetTool, cutAudioTool, framesTool, transcribeTool } from './perception.ts';
import type { AnyDirectorTool } from './registry.ts';
import { extractRotoscopeTool } from './rotoscope.ts';

export * from './registry.ts';
export * from './generation.ts';
export { resolveSitePath, assertInsideReal } from './code.ts';
export { summaryDiff, opsSchemaFor, assetNames } from './documents.ts';
export { DELEGATE_READ_ONLY_TOOLS, DELEGATE_MODELS } from './misc.ts';
export { ROTOSCOPE_KINDS, pickRotoscopeModel, type RotoscopeKind } from './rotoscope.ts';
export { capabilitySummary, modelLine } from './models.ts';

export interface ToolsetOptions {
  /** `web_search`/`web_fetch` als eigene Tools (wenn der Transport keine Server-Websuche hat und ein WebPort existiert). */
  webFallback?: boolean;
  /** `delegate` anbieten (nur im eigenen Tool-Loop). */
  delegate?: boolean;
}

/**
 * Alle Studio-Tools. Die Menge muss für eine Session stabil bleiben (Prompt-Cache, Thinking-Bindung):
 * deshalb unabhängig von Kategorie und Phase immer vollständig.
 */
export function buildDirectorTools(options: ToolsetOptions = {}): AnyDirectorTool[] {
  const tools: AnyDirectorTool[] = [
    // Kommunikation
    askUserTool,
    proposeCheckpointTool,
    mergeCheckpointsTool,
    postUpdateTool,
    setBriefTool,
    // Modelle
    searchModelsTool,
    getModelSchemaTool,
    estimateCostTool,
    generateTool,
    awaitGenerationsTool,
    cancelGenerationTool,
    // Assets
    searchAssetsTool,
    getAssetTool,
    updateAssetTool,
    rejectAssetTool,
    createTextAssetTool,
    importUrlTool,
    // Wahrnehmung & Analyse
    framesTool,
    contactSheetTool,
    analyzeAudioTool,
    transcribeTool,
    checkAvSyncTool,
    cutAudioTool,
    extractRotoscopeTool,
    // Dokumente
    getDocumentTool,
    applyDocumentOpsTool,
    restoreVersionTool,
    // Code & Render
    writeComponentTool,
    renderStillTool,
    writeSiteFileTool,
    readSiteFileTool,
    listSiteFilesTool,
    screenshotSiteTool,
    exportProjectTool,
    // Skills
    loadSkillTool,
  ];
  if (options.delegate ?? true) tools.push(delegateTool);
  if (options.webFallback) tools.push(webSearchTool, webFetchTool);
  return tools;
}

export const STUDIO_TOOL_NAMES = buildDirectorTools({ webFallback: true, delegate: true }).map((t) => t.name);
