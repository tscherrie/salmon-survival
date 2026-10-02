import { useEffect, useState } from 'react';
import { useActions, useStudio } from '../../desktop/src/renderer/state/context.tsx';
import { useLanguage } from '../../desktop/src/renderer/i18n.ts';
import { Dialog } from '../../desktop/src/renderer/components/common/Dialog.tsx';
import type { BrowserStudioApi } from './BrowserStudioApi.ts';
import { SUNO_CREATE_URL, SUNO_PLATFORM_URL, sunoPromptText, type SunoHandoff, type SunoReceipt } from '../shared/suno.ts';

export function SunoMusicDialog({ api, onClose }: { api: BrowserStudioApi; onClose: () => void }) {
  const language = useLanguage(); const w = (de: string, en: string) => language === 'de' ? de : en;
  const actions = useActions(); const projectId = useStudio(s => s.projectId)!;
  const document = useStudio(s => s.document); const head = useStudio(s => s.documentVersion);
  const playhead = useStudio(s => s.playhead);
  const [title, setTitle] = useState(''); const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState(''); const [lyrics, setLyrics] = useState(''); const [instrumental, setInstrumental] = useState(false);
  const [handoffId, setHandoffId] = useState<string>(); const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState(''); const [error, setError] = useState('');
  const [sourceUrl, setSourceUrl] = useState(''); const [model, setModel] = useState(''); const [createdAt, setCreatedAt] = useState('');
  const [plan, setPlan] = useState<SunoReceipt['planAtCreation']>('unknown');
  const [use, setUse] = useState<SunoReceipt['intendedUse']>('undecided');
  const [rightsNote, setRightsNote] = useState(''); const [acknowledged, setAcknowledged] = useState(false);
  const [kind, setKind] = useState<'song' | 'stems'>('song'); const [files, setFiles] = useState<File[]>([]); const [audioUrl, setAudioUrl] = useState('');
  const [place, setPlace] = useState(document?.kind === 'timeline');
  useEffect(() => {
    let live = true;
    void api.action<SunoHandoff[]>(projectId, 'listSunoHandoffs').then(handoffs => {
      const latest = handoffs.at(-1); if (!live || !latest) return;
      setTitle(latest.title); setPrompt(latest.prompt); setStyle(latest.style ?? ''); setLyrics(latest.lyrics ?? ''); setInstrumental(latest.instrumental); setHandoffId(latest.id);
    }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [api, projectId]);
  async function copyPrompt() {
    setBusy(true); setError('');
    try {
      const input = { title, prompt, style, lyrics, instrumental };
      const result = await api.action<{ handoff: SunoHandoff }>(projectId, 'prepareSunoMusic', input);
      setHandoffId(result.handoff.id);
      await navigator.clipboard.writeText(sunoPromptText(input));
      setCopyStatus(w('Gespeichert und kopiert. In Suno einfügen.', 'Saved and copied. Paste into Suno.'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function importAudio() {
    setBusy(true); setError('');
    try {
      const receipt: SunoReceipt = { title, planAtCreation: plan, intendedUse: use, rightsAcknowledged: true,
        ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}), ...(model.trim() ? { model: model.trim() } : {}),
        ...(createdAt ? { createdAt: new Date(createdAt).toISOString() } : {}), ...(rightsNote.trim() ? { rightsNote: rightsNote.trim() } : {}), ...(handoffId ? { handoffId } : {}) };
      const placement = place && document?.kind === 'timeline' ? { startFrame: Math.max(0, Math.round(playhead)), expectedHead: head } : undefined;
      const result = files.length ? await api.importSunoFiles(projectId, files, receipt, kind, placement) : await api.importSunoAudioUrl(projectId, audioUrl.trim(), receipt, placement);
      await actions.refreshSnapshot();
      actions.toast('success', w(`${result.assets.length} Suno-Audiodatei(en) importiert.`, `${result.assets.length} Suno audio file(s) imported.`));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); await actions.refreshSnapshot(); }
    finally { setBusy(false); }
  }
  return <Dialog title={w('Musik mit Suno', 'Music with Suno')} onClose={() => { if (!busy) onClose(); }} width={640}>
    <div className="form suno-music-form">
      <p className="muted">{w('Erstelle Musik in deinem Suno-Konto und importiere deinen Export hier. Suno zeigt verfügbare Modelle, Kosten und Downloadoptionen. Fal bleibt die Standardquelle für andere Medien.', 'Create music in your Suno account, then import your export here. Suno shows available models, costs and download options. Fal remains the default for other media.')}</p>
      <label className="field-label">{w('Musiktitel', 'Music title')}<input className="field" value={title} onChange={e => setTitle(e.target.value)} maxLength={200}/></label>
      <details open><summary>{w('1. Prompt für Suno', '1. Prompt for Suno')}</summary>
        <label className="field-label">{w('Musikbeschreibung', 'Music description')}<textarea className="field" rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={10000}/></label>
        <label className="field-label">{w('Stil (optional)', 'Style (optional)')}<input className="field" value={style} onChange={e => setStyle(e.target.value)} maxLength={2000}/></label>
        <label><input type="checkbox" checked={instrumental} onChange={e => setInstrumental(e.target.checked)}/>{w(' Instrumental', ' Instrumental')}</label>
        {!instrumental && <label className="field-label">{w('Eigener Text (optional)', 'Your lyrics (optional)')}<textarea className="field" rows={2} value={lyrics} onChange={e => setLyrics(e.target.value)} maxLength={20000}/></label>}
        <div className="suno-actions"><button className="btn" disabled={busy || !title.trim() || !prompt.trim()} onClick={() => void copyPrompt()}>{w('Prompt kopieren', 'Copy prompt')}</button><button className="btn" disabled={busy} onClick={() => void api.openExternal(SUNO_CREATE_URL).catch(e => setError(String(e)))}>{w('Suno öffnen', 'Open Suno')}</button></div>
        {copyStatus && <p role="status">{copyStatus}</p>}
      </details>
      <details open><summary>{w('2. Export importieren', '2. Import export')}</summary>
        <label className="field-label">{w('Exportart', 'Export kind')}<select className="field" value={kind} onChange={e => { setKind(e.target.value as 'song' | 'stems'); setFiles([]); }}><option value="song">{w('Ganzer Song', 'Full song')}</option><option value="stems">{w('Stems auf getrennten Spuren', 'Stems on separate tracks')}</option></select></label>
        <label className="field-label">{w('Audiodatei(en)', 'Audio file(s)')}<input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg,.aac" multiple={kind === 'stems'} onChange={e => { setFiles(Array.from(e.target.files ?? [])); setAudioUrl(''); }}/></label>
        {files.length > 0 && <p className="muted">{files.map(f => f.name).join(', ')}</p>}
        {kind === 'song' && !files.length && <label className="field-label">{w('Oder direkter HTTPS-Audiodownload', 'Or direct HTTPS audio download')}<input type="url" className="field" value={audioUrl} onChange={e => setAudioUrl(e.target.value)} placeholder="https://…/song.wav"/></label>}
        <label className="field-label">{w('Suno-Songlink (optional, Herkunft)', 'Suno song link (optional, provenance)')}<input type="url" className="field" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://suno.com/song/…"/></label>
        <label className="field-label">{w('Modell laut Original (optional)', 'Original model (optional)')}<input className="field" value={model} onChange={e => setModel(e.target.value)} maxLength={200}/></label>
        <label className="field-label">{w('Ursprünglich erstellt (optional)', 'Originally created (optional)')}<input type="datetime-local" className="field" value={createdAt} onChange={e => setCreatedAt(e.target.value)}/></label>
        <label className="field-label">{w('Suno-Plan bei Erstellung', 'Suno plan at creation')}<select className="field" value={plan} onChange={e => setPlan(e.target.value as typeof plan)}><option value="unknown">{w('Unbekannt', 'Unknown')}</option><option value="free">Free</option><option value="pro">Pro</option><option value="premier">Premier</option><option value="other">{w('Andere Vereinbarung', 'Other agreement')}</option></select></label>
        <label className="field-label">{w('Geplante Nutzung', 'Intended use')}<select className="field" value={use} onChange={e => setUse(e.target.value as typeof use)}><option value="undecided">{w('Noch offen', 'Undecided')}</option><option value="personal">{w('Persönlich', 'Personal')}</option><option value="commercial">{w('Kommerziell', 'Commercial')}</option></select></label>
        <label className="field-label">{w('Rechtenachweis oder Anmerkung (optional)', 'Rights evidence or note (optional)')}<textarea className="field" rows={2} value={rightsNote} onChange={e => setRightsNote(e.target.value)} maxLength={2000}/></label>
        <p className="muted">{w('Entscheidend ist der Plan bei der ursprünglichen Erstellung. Ein späteres Abo gibt einem Free-Song keine rückwirkenden Rechte. Deine Angaben werden gespeichert; Director prüft oder garantiert die Rechte nicht.', 'The plan at original creation matters. A later subscription does not retroactively license a Free song. Your declaration is stored; Director does not verify or guarantee rights.')}</p>
        <label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/>{w(' Ich habe die erforderlichen Rechte für den Import und prüfe meine geplante Nutzung.', ' I have the rights required for import and will check my intended use.')}</label>
        {document?.kind === 'timeline' && <label><input type="checkbox" checked={place} onChange={e => setPlace(e.target.checked)}/>{w(' An der Abspielposition in die Timeline setzen', ' Place on the timeline at the playhead')}</label>}
        {kind === 'stems' && <p className="muted">{w('Wähle zeitlich ausgerichtete Stems aus demselben Export, ohne den vollständigen Mix. Alle starten gemeinsam; vorhandene Spuren bleiben erhalten.', 'Select aligned stems from the same export, excluding the full mix. All start together; existing tracks are preserved.')}</p>}
        <button className="btn primary" disabled={busy || !acknowledged || !title.trim() || (!files.length && !audioUrl.trim())} onClick={() => void importAudio()}>{busy ? w('Wird verarbeitet…', 'Processing…') : w('Suno-Audio importieren', 'Import Suno audio')}</button>
      </details>
      {error && <p role="alert">{error}</p>}
      <p className="muted">{w('Die offizielle Suno API existiert. Direkte Generierung in Director folgt erst mit freigeschaltetem API-Zugang und dokumentierter Anbindung.', 'The official Suno API exists. Direct generation in Director will follow once API access and a documented integration are available.')} <a href={SUNO_PLATFORM_URL} target="_blank" rel="noreferrer">Suno Platform</a></p>
    </div>
  </Dialog>;
}
