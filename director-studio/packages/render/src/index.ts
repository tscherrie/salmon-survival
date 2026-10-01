/**
 * Node-Exporte von @studio/render (Render-Worker / Electron-Main). Browser-sichere Teile: siehe
 * `./browser.ts` (werden hier mit re-exportiert).
 */
export * from './browser.ts';
export { compileComponent, checkComponentSource, blankCommentsAndStrings, isCompiledComponent, type CompileResult, type CompileOptions } from './node/compile.ts';
export { TimelineRenderer, COMPOSITION_ID, type TimelineRendererOptions, type RenderStillInput, type RenderVideoInput, type RenderInputBase } from './node/timeline-renderer.ts';
export { probeMedia, sniffMediaType, checkSniffedKind, type SniffedMediaType, type ProbeOptions } from './node/media-probe.ts';
export { BrowserPool, getDefaultBrowserPool, closeDefaultBrowserPool, resolveChromiumExecutable, CHROMIUM_ENV_VAR, type BrowserPoolOptions, type PageOptions } from './node/chromium.ts';
export {
  renderHtmlToPng,
  renderHtmlToPdf,
  renderDeck,
  renderCanvas,
  waitForPageAssets,
  type HtmlToPngOptions,
  type HtmlToPdfOptions,
  type RenderDeckOptions,
  type RenderCanvasOptions,
} from './node/html-render.ts';
export { deckToPptx, toPptxColor, type DeckToPptxOptions } from './node/pptx.ts';
export { SiteServer, screenshotSite, scrubEnv, injectPickerIntoHtml, findViteBin, type SiteServerOptions, type ScreenshotSiteOptions, type ScreenshotSiteResult, type SiteViewport } from './node/site-server.ts';
export { buildSiteZip, createZip, type ZipEntry } from './node/zip.ts';
export { AssetFileServer, sendFile, resolveSafePath, parseRange, mimeTypeFor, MIME_TYPES, PathError } from './node/static-server.ts';
export { readPngSize, encodePng, makeTestPattern } from './node/png.ts';
export { readImageSize, imageSizeFromBuffer } from './node/image-size.ts';
export { crc32 } from './node/crc32.ts';
