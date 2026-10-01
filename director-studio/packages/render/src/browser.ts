/**
 * Browser-sichere Exporte von @studio/render (kein Node-Code!). Die UI importiert nur von hier.
 * Enthält: Remotion-Komposition, Deck-HTML, Leinwand-SVG, Picker-Skript, Komponenten-Lader, deutsche
 * Silbentrennung (`hyphenateDe`) und Textmessung.
 */
export * from './composition/types.ts';
export {
  TimelineComposition,
  orderVisualTracks,
  planTrackClips,
  clipFadeFactor,
  clipFadeGain,
  computeClipVolume,
  duckingDb,
  audibleClips,
  MEDIA_ERROR_LOG_PREFIX,
  type PlannedClip,
} from './composition/TimelineComposition.tsx';
export { resolveFormat, computeCompositionMeta, getSafeArea, dbToGain, type ResolvedFormat, type CompositionMeta, type SafeArea } from './composition/meta.ts';
export { seededRandom, hashString, randomFromSeed, makeClipRandom } from './composition/random.ts';
export { computeMediaStyle, clipLayerTransform, type MediaFit, type MediaLayoutInput } from './composition/layout.ts';
export { TextClipView, TEXT_STYLE_IDS, DEFAULT_FONT_STACK, wordsInClip, synthesizeWords, type TextStyleId, type TextClipViewProps } from './composition/text.tsx';
export { deckToHtml, slideToHtml, selectSlides, elementCss, themeValue, deckFontFaces, type DeckHtmlOptions, type DeckFontFace } from './deck/deck-html.ts';
export { chartToSvg, niceTicks, formatNumber, DEFAULT_CHART_COLORS, type ChartSpec, type ChartSvgOptions } from './deck/chart-svg.ts';
export { canvasToSvg, canvasToHtml, canvasPixelSize, canvasCssSize, wrapText, type CanvasSvgOptions, type CanvasHtmlOptions } from './canvas/canvas-svg.ts';
export { cssBackgroundToSvg, isCssGradient } from './canvas/css-gradient.ts';
export { hyphenateDe, hyphenateWord, hyphenateHtmlDe, hyphenationPoints, stripSoftHyphens, isGermanLang, SOFT_HYPHEN, type HyphenateOptions } from './text/hyphenate-de.ts';
export { estimateTextWidth, textWidthEm, wrapTextLines, fitFontSizeToWords, isBoldWeight, type MeasureOptions } from './text/measure.ts';
export { PICKER_SCRIPT, PICK_CONSOLE_PREFIX, parsePickConsoleMessage, type PickPayload } from './picker/picker-script.ts';
export { pickPayloadToRef } from './picker/pick-ref.ts';
export { loadCompiledComponent, COMPILED_COMPONENT_MARKER, ALLOWED_COMPONENT_IMPORTS, type ComponentDeps } from './component-loader.ts';
export { markdownToHtml, markdownToPlain, parseBlocks, parseInline, type TextBlock, type TextRun } from './util/markdown.ts';
export { sanitizeHtml, isDangerousUrl } from './util/sanitize.ts';
export { escapeHtml } from './util/html.ts';
export * as studioFx from './fx/index.ts';
