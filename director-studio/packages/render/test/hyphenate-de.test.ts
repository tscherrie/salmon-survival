import { describe, expect, it } from 'vitest';
import { hyphenateDe, hyphenateHtmlDe, hyphenateWord, hyphenationPoints, isGermanLang, SOFT_HYPHEN, stripSoftHyphens } from '../src/browser.ts';

const show = (word: string) => hyphenateWord(word, { hyphen: '-' });

describe('hyphenateDe – deutsche Silbentrennung', () => {
  it('trennt typische Komposita an Silben- und Wortfugen', () => {
    expect(show('Geschwindigkeitsbegrenzung')).toBe('Ge-schwin-dig-keits-be-gren-zung');
    expect(show('Morgengrauen')).toBe('Mor-gen-grau-en');
    expect(show('Lichterkette')).toBe('Lich-ter-ket-te');
    expect(show('Donaudampfschifffahrtsgesellschaft')).toBe('Do-nau-dampf-schiff-fahrts-ge-sell-schaft');
    expect(show('Bundesverfassungsgericht')).toBe('Bun-des-ver-fas-sungs-ge-richt');
    expect(show('Datenschutzgrundverordnung')).toBe('Da-ten-schutz-grund-ver-ord-nung');
  });

  it('hält ch/ck/sch zusammen und findet Fugen in Konsonantengruppen', () => {
    expect(show('Wahrscheinlichkeit')).toBe('Wahr-schein-lich-keit');
    expect(show('Zuckerwatte')).toBe('Zu-cker-wat-te');
    expect(show('Kühlschrank')).toBe('Kühl-schrank');
    expect(show('Kunststoff')).toBe('Kunst-stoff');
    expect(show('Hauptstraße')).toBe('Haupt-stra-ße');
    expect(show('Arbeitsstelle')).toBe('Ar-beits-stel-le');
    expect(show('Schwarzwald')).toBe('Schwarz-wald');
    expect(show('Wirklichkeit')).toBe('Wirk-lich-keit');
  });

  it('erkennt Präfixe, Fugenelemente und Grundwörter mit Vokal', () => {
    expect(show('Veranstaltung')).toBe('Ver-an-stal-tung');
    expect(show('Beeinflussung')).toBe('Be-ein-flus-sung');
    expect(show('Datenverarbeitung')).toBe('Da-ten-ver-ar-bei-tung');
    expect(show('Ordnungsamt')).toBe('Ord-nungs-amt');
    expect(show('Hausaufgabe')).toBe('Haus-auf-ga-be');
    expect(show('Steuererklärung')).toBe('Steu-er-er-klä-rung');
    expect(show('Sonnenuntergang')).toBe('Son-nen-un-ter-gang');
    expect(show('Geburtstagsfeier')).toBe('Ge-burts-tags-fei-er');
  });

  it('Vokalfolgen und Fremdwörter; keine einbuchstabigen Teilstücke', () => {
    expect(show('Nationalmannschaft')).toBe('Na-tio-nal-mann-schaft');
    expect(show('Theaterstück')).toBe('Thea-ter-stück');
    expect(show('Mathematik')).toBe('Ma-the-ma-tik');
    expect(show('Bauernhöfe')).toBe('Bau-ern-hö-fe');
  });

  it('kurze Wörter, Groß-/Kleinschreibung, Binnenmajuskeln, URLs bleiben korrekt', () => {
    expect(hyphenateDe('Morgen Lichter')).toBe('Morgen Lichter');
    expect(show('GESCHWINDIGKEITSBEGRENZUNG')).toBe('GE-SCHWIN-DIG-KEITS-BE-GREN-ZUNG');
    expect(hyphenateDe('JavaScriptFramework')).toBe('JavaScriptFramework');
    expect(hyphenateDe('https://example.com/geschwindigkeitsbegrenzung')).toBe('https://example.com/geschwindigkeitsbegrenzung');
    expect(hyphenateDe('info@lichterkettenverleih.de')).toBe('info@lichterkettenverleih.de');
    expect(hyphenateDe('Lichterketten-Aktion!')).toBe(`Lich${SOFT_HYPHEN}ter${SOFT_HYPHEN}ket${SOFT_HYPHEN}ten-Aktion!`);
    expect(hyphenationPoints('Morgengrauen', { minWordLength: 20 })).toEqual([]);
  });

  it('Standard ist der bedingte Trennstrich (U+00AD); idempotent; Leerraum bleibt erhalten', () => {
    const text = 'Die  Geschwindigkeitsbegrenzung\nim Morgengrauen';
    const once = hyphenateDe(text);
    expect(once).toContain(`Ge${SOFT_HYPHEN}schwin`);
    expect(hyphenateDe(once)).toBe(once);
    expect(stripSoftHyphens(once)).toBe(text);
  });

  it('Invarianten über viele Wörter: nie in ch/ck/sch/qu, Teilstücke ≥ 2 Buchstaben', () => {
    const words = (
      'Krankenversicherung Bundeskanzlerin Zeitschrift Hauptschlüssel menschlicher Kirchturmpflicht Entwicklung Verständnis ' +
      'Mitarbeiterinnen Herausforderung Staatsanwalt Informationsaustausch Kundenbetreuung Selbstbestimmung Angestellte ' +
      'Lebenszweck Zusammenarbeit Zuverlässigkeit Gesellschaft Freundschaft Gesundheitswesen Sicherheitsgurt Kinderklinik ' +
      'Bürgermeister Bahnhofstraße Rathausplatz Methodenlehre Philosophie Familienangehörige Universität Lieblingsessen ' +
      'Schmetterling Taschenlampe Fischerdorf Wissenschaftler Konsequenzen Bequemlichkeit Aufenthaltsgenehmigung ' +
      'Straßenbahnhaltestelle Feuerwehrmann Abenteuerspielplatz Gebäudereinigung Elektrizitätswerk Telekommunikation ' +
      'Industriegebiet Kontrollzentrum Mehrwertsteuer Vergangenheit Zukunftsperspektive Gerechtigkeit Rücksichtnahme ' +
      'Ausstellungseröffnung Pflanzenschutzmittel Schokoladenkuchen Weihnachtsmarkt Kindergartenplatz Erdbeermarmelade'
    ).split(' ');
    for (const word of words) {
      const points = hyphenationPoints(word);
      expect(points.length, word).toBeGreaterThan(0);
      let prev = 0;
      for (const p of [...points, word.length]) {
        expect(p - prev, `${word}: Teilstück ${word.slice(prev, p)}`).toBeGreaterThanOrEqual(2);
        prev = p;
      }
      const lower = word.toLowerCase();
      for (const p of points) {
        const around = lower.slice(p - 1, p + 1);
        expect(['ch', 'ck', 'qu'].includes(around), `${word} bei ${p}`).toBe(false);
        expect(lower.slice(p - 1, p + 2) === 'sch' || lower.slice(p - 2, p + 1) === 'sch', `${word} trennt sch`).toBe(false);
      }
    }
  });

  it('hyphenateHtmlDe trennt nur Textknoten (Tags, Attribute, Entities und <code> bleiben)', () => {
    const html = '<p title="Geschwindigkeitsbegrenzung">Geschwindigkeitsbegrenzung &amp; <strong>Lichterkette</strong></p><code>Geschwindigkeitsbegrenzung</code>';
    const out = hyphenateHtmlDe(html);
    expect(out).toContain('title="Geschwindigkeitsbegrenzung"');
    expect(out).toContain(`>Ge${SOFT_HYPHEN}schwin`);
    expect(out).toContain('&amp;');
    expect(out).toContain(`<strong>Lich${SOFT_HYPHEN}ter`);
    expect(out).toContain('<code>Geschwindigkeitsbegrenzung</code>');
    expect(stripSoftHyphens(out)).toBe(html);
  });

  it('isGermanLang', () => {
    expect(isGermanLang('de')).toBe(true);
    expect(isGermanLang('de-AT')).toBe(true);
    expect(isGermanLang('de_CH')).toBe(true);
    expect(isGermanLang('en')).toBe(false);
    expect(isGermanLang('dex')).toBe(false);
    expect(isGermanLang(undefined)).toBe(false);
  });
});
