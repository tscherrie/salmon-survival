/**
 * Leichtgewichtige deutsche Silbentrennung: fügt bedingte Trennstriche (U+00AD, „soft hyphen“) in lange
 * Wörter ein. Browser trennen dann NUR an diesen Stellen (unabhängig davon, ob Chromium ein
 * Trennwörterbuch hat – die Headless-Shell und Electron unter Linux/Windows haben keins), Vorschau und
 * Export brechen also identisch um.
 *
 * Heuristik (keine Trennmuster, nur kleine Listen häufiger Präfixe und Kompositionsglieder):
 * 1. Präfixe am Wortanfang (`ge`, `be`, `ver`, `unter`, `aus`, …) werden abgetrennt, wenn der Rest mit
 *    einem gültigen Silbenanlaut beginnt (`Ge-schwin…`, `Ver-ein`, `be-grenz…`). Mitten im Wort zusätzlich
 *    `be`/`ge`/`ver`/`unter`/`über`/`auf`/`aus`/`ein` nach passenden Konsonanten (`Kun-den-be-treu-ung`,
 *    `Da-ten-ver-ar-bei-tung`), häufige Bestimmungswörter mit Fugen-s (`Ord-nungs-amt`, `Ge-burts-tag`)
 *    und Grundwörter mit Vokal am Anfang (`Zu-sam-men-ar-beit`).
 * 2. Zwischen zwei Vokalkernen (Diphthonge/Doppelvokale bleiben zusammen) gilt die Grundregel „ein
 *    Konsonant kommt auf die neue Zeile“; `ch`, `ck`, `sch`, `qu` sind EIN Konsonant (`la-chen`,
 *    `Zu-cker`, `Ta-sche`), `ph`/`th` zwischen Vokalen ebenso (`Me-tho-de`).
 * 3. In Gruppen aus drei und mehr Konsonanten bevorzugt die Regel einen typischen Wortanlaut
 *    (`gr`, `tr`, `str`, `schr`, `st`, …) – das trifft die Fuge in Komposita (`Mor-gen-grau-en`,
 *    `Kühl-schrank`, `Kunst-stoff`); Endungen, die kein Wort beenden können (`…sz`, `…tl`), sind verboten.
 * 4. Vokalfolgen werden nur nach Diphthongen (`Bau-er`, `Frei-er`) und bei Fremdwortfolgen wie
 *    `ea`/`io` getrennt (`The-a-ter`, `Na-ti-on`).
 *
 * 5. Teilstücke aus nur einem Buchstaben werden vermieden (`Na-tio-nal`, `Thea-ter`).
 *
 * Grenzen: Komposita, deren zweiter Teil mit einem Vokal beginnt und nicht in den Listen steht, werden
 * wie einfache Wörter getrennt (`Kli-ma-schut-zab-kom-men`). Da der Browser nur trennt, wenn ein Wort nicht
 * in die Zeile passt, ist das ein guter Kompromiss gegenüber Brüchen mitten im Wort.
 */

export const SOFT_HYPHEN = '\u00AD';

export interface HyphenateOptions {
  /** Wörter mit weniger Buchstaben bleiben unverändert. Standard: 10. */
  minWordLength?: number;
  /** Mindestanzahl Buchstaben vor der ersten Trennstelle. Standard: 2. */
  leftMin?: number;
  /** Mindestanzahl Buchstaben nach der letzten Trennstelle. Standard: 2. */
  rightMin?: number;
  /** Eingefügtes Zeichen (Standard: U+00AD). Für Tests/Debugging z. B. `-` oder `·`. */
  hyphen?: string;
}

/** `true` für deutsche Sprachcodes (`de`, `de-DE`, `de_AT`, …). */
export function isGermanLang(lang: string | undefined | null): boolean {
  return !!lang && /^de(?:[-_]|$)/i.test(lang.trim());
}

const VOWELS = new Set(Array.from('aeiouyäöüàáâéèêëíìîïóòôúùûœæ'));
/** Zweibuchstabige Vokalkerne, die nie getrennt werden. */
const NUCLEI2 = new Set(['aa', 'ee', 'oo', 'ai', 'ei', 'au', 'eu', 'äu', 'ie', 'ay', 'ey', 'ou']);
/** Nach diesen Kernen darf vor einem weiteren Vokal getrennt werden (`Bau-er`, `Ei-er`). */
const DIPHTHONGS = new Set(['ai', 'ei', 'au', 'eu', 'äu', 'ay', 'ey']);
/** Trennbare Folgen einzelner Vokale (vor allem in Fremdwörtern). */
const VOWEL_SPLITS = new Set(['ea', 'eo', 'ia', 'io', 'iu', 'ua', 'uo']);

/**
 * Gültige Wortanlaute aus mehreren Konsonanten (für Präfix- und Gruppenregeln). Einzelne Konsonanten
 * sind immer gültig.
 */
const ONSETS = new Set([
  'bl', 'br', 'ch', 'chr', 'dr', 'fl', 'fr', 'gl', 'gr', 'kl', 'kn', 'kr', 'pf', 'pfl', 'pfr', 'ph', 'phr', 'pl', 'pr', 'ps', 'qu',
  'sch', 'schl', 'schm', 'schn', 'schr', 'schw', 'sk', 'sp', 'spl', 'spr', 'st', 'str', 'th', 'thr', 'tr', 'tsch', 'wr', 'zw',
]);
/** Wortanlaute, die in Konsonantengruppen (≥ 3) die Fuge markieren; längster Treffer gewinnt. */
const STRONG_ONSETS = new Set([
  'bl', 'br', 'dr', 'fl', 'fr', 'gl', 'gr', 'kl', 'kr', 'pl', 'pr', 'tr', 'pfl', 'pfr',
  'schl', 'schm', 'schn', 'schr', 'schw', 'sp', 'spl', 'spr', 'st', 'str',
]);
/** Zwei Konsonanten, mit denen kein deutsches Wort endet (Silbenende ungültig). */
const BAD_CODA_ENDINGS = new Set([
  'bl', 'br', 'dl', 'dr', 'fl', 'fr', 'gl', 'gn', 'gr', 'kl', 'kn', 'kr', 'pl', 'pr', 'tl', 'tr', 'tw', 'vr', 'wr',
  'sl', 'sm', 'sn', 'sr', 'sw', 'sz', 'zw', 'schl', 'schm', 'schn', 'schr', 'schw', 'chl', 'chr', 'chn',
]);

interface Prefix {
  text: string;
  /** Darf auf einen Vokal folgen (`Ver-ein`, `Aus-übung`)? Sonst nur auf einen gültigen Anlaut. */
  beforeVowel: boolean;
}

/** Präfixe am Wortanfang (längste zuerst geprüft). */
const PREFIXES: Prefix[] = [
  ...['zurück', 'wieder', 'hinter', 'gegen', 'durch', 'unter', 'über', 'aus', 'auf', 'ver', 'vor', 'mit'].map((text) => ({ text, beforeVowel: true })),
  ...['wider', 'nach', 'miss', 'voll', 'fort', 'bei', 'ein', 'emp', 'ent', 'her', 'hin', 'weg', 'zer', 'ab', 'an', 'be', 'er', 'ge', 'un', 'ur', 'zu'].map((text) => ({ text, beforeVowel: false })),
].sort((a, b) => b.text.length - a.text.length);

/** Morpheme, die mitten im Wort nach einem Konsonanten beginnen und vor die eine Fuge gehört. */
const INNER_PREFIXES = ['unter', 'über', 'ver'];

/**
 * Häufige Bestimmungswörter (meist mit Fugen-s): Fuge danach, wenn ein Vokal oder ein gültiger Anlaut
 * folgt (`Ord-nungs-amt`, `Ge-burts-tag`, `Wo-chen-en-de`, `Haus-auf-ga-be`).
 */
const LEFT_ELEMENTS = [
  'ungs', 'heits', 'keits', 'schafts', 'tions', 'ions', 'täts', 'lings', 'arbeits', 'bundes', 'lebens', 'staats', 'landes',
  'geburts', 'liebes', 'glücks', 'weihnachts', 'unternehmens', 'verkehrs', 'geschäfts', 'betriebs', 'volks', 'kriegs',
  'gerichts', 'zukunfts', 'jahres', 'tages', 'monats', 'kinder', 'abend', 'wochen', 'sonnen', 'straßen', 'daten', 'kunden',
  'familien', 'haus', 'zusammen', 'winter', 'sommer', 'bau', 'halte',
];

/** Häufige Grundwörter, die mit einem Vokal beginnen: Fuge davor (`Zu-sam-men-ar-beit`, `Wahl-er-geb-nis`). */
const RIGHT_ELEMENTS = [
  'arbeit', 'angebot', 'anfang', 'anlage', 'antrag', 'anschluss', 'aufgabe', 'aufgang', 'auftrag', 'aufnahme', 'ausgabe',
  'ausgang', 'ausbildung', 'austausch', 'eingang', 'einsatz', 'ergebnis', 'erfahrung', 'erklärung', 'abschnitt', 'umgebung',
  'eigentum', 'interesse', 'abteilung',
];

/**
 * Präfixartige Grundwörter mit Vokal am Anfang mitten im Wort, nur nach bestimmten Konsonanten
 * (`her-auf`, `Son-nen-auf-gang`, `Haupt-aus-gang`, `hin-ein`) – `Kauf`, `Lauf`, `Stein`, `-sein` bleiben heil.
 */
const INNER_VOWEL_PREFIXES: Array<{ text: string; after: string }> = [
  { text: 'auf', after: 'rnsdtgpz' },
  { text: 'aus', after: 'rnsdtgpz' },
  { text: 'ein', after: 'rndp' },
];

const LETTER_RUN = /\p{L}+/gu;

/**
 * Fügt bedingte Trennstriche in lange deutsche Wörter ein. Bereits (manuell) getrennte Wörter, URLs,
 * E-Mail-Adressen, Dateinamen und Binnenmajuskeln (`JavaScript`) bleiben unverändert. Idempotent.
 */
export function hyphenateDe(text: string, opts: HyphenateOptions = {}): string {
  if (!text) return text;
  return text
    .split(/(\s+)/)
    .map((chunk) => {
      if (!chunk || /^\s+$/.test(chunk)) return chunk;
      if (chunk.includes(SOFT_HYPHEN) || looksTechnical(chunk)) return chunk;
      return chunk.replace(LETTER_RUN, (word) => hyphenateWord(word, opts));
    })
    .join('');
}

function looksTechnical(chunk: string): boolean {
  return /:\/\/|@|[\\/]|^www\./i.test(chunk) || /\p{L}\.\p{L}{2,}/u.test(chunk) || /[_=#]/.test(chunk);
}

/** Ergebnis-Cache für Standardoptionen (Remotion rendert Textclips in jedem Frame neu). */
const POINT_CACHE = new Map<string, number[]>();
const POINT_CACHE_MAX = 5000;

/** Trennstellen (Index = Position VOR dem Buchstaben) eines einzelnen Wortes. */
export function hyphenationPoints(word: string, opts: HyphenateOptions = {}): number[] {
  const cacheable = opts.minWordLength === undefined && opts.leftMin === undefined && opts.rightMin === undefined;
  if (cacheable) {
    const hit = POINT_CACHE.get(word);
    if (hit) return [...hit];
    const points = computePoints(word, opts);
    if (POINT_CACHE.size >= POINT_CACHE_MAX) POINT_CACHE.clear();
    POINT_CACHE.set(word, points);
    return [...points];
  }
  return computePoints(word, opts);
}

function computePoints(word: string, opts: HyphenateOptions): number[] {
  const minLen = opts.minWordLength ?? 10;
  const leftMin = Math.max(1, opts.leftMin ?? 2);
  const rightMin = Math.max(1, opts.rightMin ?? 2);
  if (Array.from(word).length !== word.length) return []; // Astralzeichen: lieber nicht anfassen
  if (word.length < minLen) return [];
  if (/\p{Ll}\p{Lu}/u.test(word)) return []; // Binnenmajuskel (Produktnamen, Code)
  const lower = word.toLocaleLowerCase('de-DE');
  if (lower.length !== word.length) return [];
  const { breaks, boundaries } = computeBreaks(lower);
  return dropTinyFragments(
    breaks.filter((i) => i >= leftMin && i <= word.length - rightMin),
    boundaries,
  );
}

/** Ein Wort (nur Buchstaben) trennen. */
export function hyphenateWord(word: string, opts: HyphenateOptions = {}): string {
  const points = hyphenationPoints(word, opts);
  if (!points.length) return word;
  const hyphen = opts.hyphen ?? SOFT_HYPHEN;
  let out = '';
  let last = 0;
  for (const p of points) {
    out += word.slice(last, p) + hyphen;
    last = p;
  }
  return out + word.slice(last);
}

function isVowelAt(w: string, i: number): boolean {
  const ch = w[i];
  if (ch === undefined || !VOWELS.has(ch)) return false;
  // `u` nach `q` gehört zum Konsonanten `qu`.
  if (ch === 'u' && w[i - 1] === 'q') return false;
  // `y` am Wortanfang vor einem Vokal ist ein Konsonant (`Yacht`).
  if (ch === 'y' && i === 0 && VOWELS.has(w[1] ?? '')) return false;
  return true;
}

function hasVowel(w: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (isVowelAt(w, i)) return true;
  return false;
}

function onsetOf(w: string, from: number): string {
  let end = from;
  while (end < w.length && !isVowelAt(w, end)) end++;
  return w.slice(from, end);
}

function validPrefixOnset(onset: string): boolean {
  if (onset.length === 1) return !'ßxcqy'.includes(onset);
  return ONSETS.has(onset) && onset !== 'ch' && onset !== 'ph' && onset !== 'th';
}

/** Feste Morphemgrenzen: Präfixe, innere Präfixe, Bestimmungs- und Grundwörter. */
function morphemeBoundaries(w: string): Set<number> {
  const out = new Set<number>();
  // Präfixe am Anfang (bis zu drei hintereinander: `un-ver-ein-bar`).
  let pos = 0;
  for (let depth = 0; depth < 3; depth++) {
    const prefix = PREFIXES.find((p) => w.startsWith(p.text, pos) && acceptPrefix(w, pos, p));
    if (!prefix) break;
    pos += prefix.text.length;
    out.add(pos);
  }
  // `be`/`ge` vor einem Diphthong: `be-ein-flus-sen`, `ge-eig-net`, `be-auf-tra-gen`.
  for (const p of ['be', 'ge']) {
    if (w.startsWith(p) && /^(?:ei|eu|au|äu)/.test(w.slice(2)) && hasVowel(w, 4, w.length)) out.add(2);
  }
  // `be`/`ge` mitten im Wort nach einem Konsonanten vor einem mehrteiligen Anlaut:
  // `Kun-den-be-treu-ung`, `Selbst-be-stim-mung`, `An-ge-stell-te` (statt `bet-reu`, `bes-tim`, `ges-tell`).
  for (const m of ['be', 'ge']) {
    for (let i = w.indexOf(m, 2); i >= 0; i = w.indexOf(m, i + 1)) {
      if (isVowelAt(w, i - 1) || !hasVowel(w, 0, i)) continue;
      const onset = onsetOf(w, i + 2);
      if (onset.length < 2 || !validPrefixOnset(onset) || w.length - (i + 2) - onset.length < 2) continue;
      out.add(i);
      out.add(i + 2);
    }
  }
  // Innere Präfixe nach einem Konsonanten: `Da-ten-ver-ar-bei-tung`, `Son-nen-un-ter-gang`.
  for (const m of INNER_PREFIXES) {
    for (let i = w.indexOf(m, 2); i >= 0; i = w.indexOf(m, i + 1)) {
      if (isVowelAt(w, i - 1) || !hasVowel(w, 0, i) || !hasVowel(w, i + m.length, w.length)) continue;
      if (m === 'ver') {
        // `ver` nur vor einem Vokal (sonst greift die normale Regel ohnehin richtig).
        if (!isVowelAt(w, i + 3)) continue;
        out.add(i + 3);
      }
      out.add(i);
    }
  }
  // Bestimmungswörter (Fuge danach).
  for (const e of LEFT_ELEMENTS) {
    for (let i = w.indexOf(e); i >= 0; i = w.indexOf(e, i + 1)) {
      const end = i + e.length;
      if (end > w.length - 2 || !hasVowel(w, end, w.length)) continue;
      if (!isVowelAt(w, end) && !validPrefixOnset(onsetOf(w, end))) continue;
      out.add(end);
    }
  }
  // Grundwörter mit Vokal am Anfang (Fuge davor, nur nach einem Konsonanten).
  for (const e of RIGHT_ELEMENTS) {
    for (let i = w.indexOf(e, 2); i >= 0; i = w.indexOf(e, i + 1)) {
      if (isVowelAt(w, i - 1) || !hasVowel(w, 0, i)) continue;
      out.add(i);
    }
  }
  for (const { text, after } of INNER_VOWEL_PREFIXES) {
    for (let i = w.indexOf(text, 2); i >= 0; i = w.indexOf(text, i + 1)) {
      const end = i + text.length;
      if (!after.includes(w[i - 1]!) || !hasVowel(w, 0, i) || w.length - end < 2 || !hasVowel(w, end, w.length)) continue;
      out.add(i);
    }
  }
  // Präfixe auch nach erkannten Fugen (`Da-ten-aus-tausch`, `Kun-den-an-ge-bot`).
  for (const b of [...out].sort((x, y) => x - y)) {
    let pos = b;
    for (let depth = 0; depth < 2; depth++) {
      const prefix = PREFIXES.find((p) => w.startsWith(p.text, pos) && acceptPrefix(w, pos, p));
      if (!prefix) break;
      pos += prefix.text.length;
      out.add(pos);
    }
  }
  return out;
}

function acceptPrefix(w: string, pos: number, p: Prefix): boolean {
  const restStart = pos + p.text.length;
  if (w.length - restStart < 3 || !hasVowel(w, restStart, w.length)) return false;
  if (isVowelAt(w, restStart)) return p.beforeVowel;
  const onset = onsetOf(w, restStart);
  if (!validPrefixOnset(onset)) return false;
  // Der Rest braucht nach dem Anlaut noch mindestens zwei Buchstaben (`Ge-stal-tung` ja, `Ge-ste` nein).
  return w.length - restStart - onset.length >= 2;
}

interface Nucleus {
  start: number;
  end: number;
}

function nuclei(w: string, boundaries: Set<number>): Nucleus[] {
  const out: Nucleus[] = [];
  let i = 0;
  while (i < w.length) {
    if (!isVowelAt(w, i)) {
      i++;
      continue;
    }
    let end = i + 1;
    const pair = w.slice(i, i + 2);
    if (isVowelAt(w, i + 1) && NUCLEI2.has(pair) && !boundaries.has(i + 1)) {
      // `eei` → `e` + `ei` (`be-ei-len`), sonst Doppelvokal/Diphthong zusammenhalten.
      if (!(pair === 'ee' && w[i + 2] === 'i')) end = i + 2;
    }
    out.push({ start: i, end });
    i = end;
  }
  return out;
}

/** Zerlegt eine Konsonantengruppe in Einheiten (`sch`, `ch`, `ck`, `qu` als eine). */
function consonantUnits(w: string, from: number, to: number): string[] {
  const cluster = w.slice(from, to);
  // `ph`/`th` nur zwischen zwei Vokalen als Einheit (`Me-tho-de`), außer vor `-haus`, `-heit`, … (`Rat-haus`).
  if ((cluster === 'ph' || cluster === 'th') && !/^h(?:aus|eit|aft|of|alt|and|err|olz)/.test(w.slice(to - 1))) return [cluster];
  const units: string[] = [];
  let i = 0;
  while (i < cluster.length) {
    if (cluster.startsWith('sch', i)) {
      units.push('sch');
      i += 3;
    } else if (cluster.startsWith('ch', i) || cluster.startsWith('ck', i)) {
      units.push(cluster.slice(i, i + 2));
      i += 2;
    } else if (cluster.startsWith('qu', i)) {
      units.push('qu');
      i += 2;
    } else {
      units.push(cluster[i]!);
      i += 1;
    }
  }
  return units;
}

function validCoda(units: string[]): boolean {
  const letters = units.join('');
  // Doppelkonsonant nur direkt nach dem Vokal (`Schiff-fahrt` ja, `Arbeitss-telle` nein).
  for (let i = 2; i < letters.length; i++) if (letters[i] === letters[i - 1] && units.length > 1) return false;
  if (units.length >= 2) {
    const last2 = units.slice(-2).join('');
    if (BAD_CODA_ENDINGS.has(last2)) return false;
  }
  return true;
}

function validOnset(units: string[]): boolean {
  if (units.length === 0) return false;
  if (units.length === 1) return true;
  return ONSETS.has(units.join(''));
}

/** An Position `i` beginnt ein Suffix mit `l` (`-lich` – nicht `Licht` –, `-ling`, `-lein`, `-ler`). */
function lSuffixAt(w: string, i: number): boolean {
  if (w.startsWith('lich', i)) return w[i + 4] !== 't';
  if (w.startsWith('ling', i) || w.startsWith('lein', i)) return true;
  return /^ler(?:in|n|s)?$/.test(w.slice(i)) || w.startsWith('lerin', i);
}

/**
 * Wählt die Trennstelle in einer Konsonantengruppe; liefert die Anzahl Einheiten links oder -1.
 * `prevNucleus` ist der Vokalkern davor (für die Regel nach Diphthongen/langen Vokalen).
 */
function splitCluster(w: string, from: number, units: string[], prevNucleus: string): number {
  const n = units.length;
  const offsets: number[] = [];
  let acc = from;
  for (const u of units) {
    offsets.push(acc);
    acc += u.length;
  }
  const candidates: number[] = [];
  if (n >= 3) {
    // Längster „starker“ Anlaut zuerst (Kompositionsfuge).
    for (let j = 1; j < n - 1; j++) {
      const onset = units.slice(j).join('');
      if (!STRONG_ONSETS.has(onset)) continue;
      // `wirk-lich`, `Jüng-ling`, `mensch-lich`: zweiteiliger Anlaut, dessen `l` ein Suffix beginnt.
      if (n - j === 2 && units[n - 1] === 'l' && lSuffixAt(w, offsets[n - 1]!)) continue;
      // `Land-rat`, `Wald-rand`: nach n/l/r endet das Bestimmungswort meist auf `d`.
      if (onset === 'dr' && ['n', 'l', 'r'].includes(units[j - 1]!)) continue;
      // `dt` bleibt zusammen: `Stadt-re-gi-on`, nicht `Stad-tre…`.
      if (onset.startsWith('t') && units[j - 1] === 'd') continue;
      candidates.push(j);
      break;
    }
  }
  const pair = units.join('');
  if (n === 2 && prevNucleus.length === 2 && STRONG_ONSETS.has(pair) && pair !== 'st' && pair !== 'sp') {
    // Nach Diphthong/langem Vokal markiert ein Wortanlaut mit l/r fast immer die Fuge: `Schnee-flo-cke`,
    // `Bau-platz`, `Frei-flug` (aber `Kauf-leu-te`, `Weib-lich-keit`; `st`/`sp` nicht: `Meis-ter`).
    const suffix = units[1] === 'l' && lSuffixAt(w, from + units[0]!.length);
    if (!suffix && !(prevNucleus === 'au' && units[0] === 'f')) candidates.push(0);
  }
  for (let j = n - 1; j >= 0; j--) if (!candidates.includes(j)) candidates.push(j);
  for (const j of candidates) {
    const coda = units.slice(0, j);
    const onset = units.slice(j);
    if (!validOnset(onset)) continue;
    if (coda.length && !validCoda(coda)) continue;
    return j;
  }
  return -1;
}

function computeBreaks(w: string): { breaks: number[]; boundaries: Set<number> } {
  const boundaries = morphemeBoundaries(w);
  const ns = nuclei(w, boundaries);
  const breaks = new Set<number>();
  for (let k = 0; k + 1 < ns.length; k++) {
    const a = ns[k]!;
    const b = ns[k + 1]!;
    // Feste Grenze zwischen den Kernen hat Vorrang.
    let forced: number | undefined;
    for (let p = a.end; p <= b.start; p++) if (boundaries.has(p)) forced = p;
    if (forced !== undefined) {
      breaks.add(forced);
      continue;
    }
    if (a.end === b.start) {
      const first = w.slice(a.start, a.end);
      const pair = w[a.end - 1]! + w[b.start]!;
      if (DIPHTHONGS.has(first) || (first.length === 1 && b.end - b.start === 1 && VOWEL_SPLITS.has(pair))) breaks.add(a.end);
      continue;
    }
    const units = consonantUnits(w, a.end, b.start);
    const j = splitCluster(w, a.end, units, w.slice(a.start, a.end));
    if (j < 0) continue;
    breaks.add(a.end + units.slice(0, j).join('').length);
  }
  return { breaks: [...breaks].sort((x, y) => x - y), boundaries };
}

/**
 * Teilstücke aus nur einem Buchstaben vermeiden (`Na-tio-nal`, `Rea-li-tät` statt `Na-ti-o-nal`,
 * `Re-a-li-tät`): Morphemgrenzen gewinnen, sonst entfällt die frühere Trennstelle.
 */
function dropTinyFragments(points: number[], boundaries: Set<number>, minFragment = 2): number[] {
  const out: number[] = [];
  for (const p of points) {
    const prev = out.at(-1);
    if (prev === undefined || p - prev >= minFragment) {
      out.push(p);
      continue;
    }
    if (boundaries.has(prev) && !boundaries.has(p)) continue;
    if (p - (out.at(-2) ?? -Infinity) >= minFragment) out[out.length - 1] = p;
  }
  return out;
}

/** Entfernt bedingte Trennstriche (z. B. für Längenmessung oder Klartext). */
export function stripSoftHyphens(text: string): string {
  return text.includes(SOFT_HYPHEN) ? text.replaceAll(SOFT_HYPHEN, '') : text;
}

/**
 * Wendet `hyphenateDe` nur auf Textknoten eines (bereits maskierten) HTML-Fragments an – Tags,
 * Attribute und Entities bleiben unberührt; Inhalte von `<code>`, `<pre>`, `<style>`, `<script>` ebenso.
 */
export function hyphenateHtmlDe(html: string, opts: HyphenateOptions = {}): string {
  let skipDepth = 0;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        const m = /^<(\/?)(code|pre|style|script|kbd|samp)\b/i.exec(part);
        if (m) skipDepth = Math.max(0, skipDepth + (m[1] ? -1 : 1));
        return part;
      }
      if (skipDepth > 0 || !part) return part;
      // Entities (`&amp;`) nicht zerlegen: nur Wortläufe außerhalb von `&…;` trennen.
      return part
        .split(/(&[#a-zA-Z0-9]+;)/)
        .map((seg) => (seg.startsWith('&') && seg.endsWith(';') ? seg : hyphenateDe(seg, opts)))
        .join('');
    })
    .join('');
}
