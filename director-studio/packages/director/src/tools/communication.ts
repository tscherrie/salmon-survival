import { z } from 'zod';
import {
  CATEGORY_LABELS,
  formatUsd,
  mergeCheckpoints,
  PROJECT_CATEGORIES,
  projectBriefSchema,
  proposeCheckpoint,
  STANDARD_FORMATS,
  type DirectorQuestion,
  type FormatSpec,
} from '@studio/core';
import { errorMessage } from '../util.ts';
import { defineTool, errorResult, textResult, type ToolContext } from './registry.ts';

export const askUserTool = defineTool({
  name: 'ask_user',
  description: [
    'Stellt dem Nutzer 1–4 Fragen als Optionen-Karte im Panel und wartet auf die Antworten (blockiert).',
    'Nutze es für Entscheidungen, die beim Nutzer liegen (Geschmack, Story, Marke, Budget, Formate) – im Planungsgespräch in kleinen Runden.',
    'Jede Frage hat 2–4 konkrete Optionen; markiere deine Empfehlung im Label mit „(Empfehlung)“ und setze sie an erste Stelle. Der Nutzer kann immer auch Freitext antworten.',
    'Handwerkliche Entscheidungen triffst du selbst, statt zu fragen.',
  ].join(' '),
  input: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().describe('Die vollständige Frage.'),
          header: z.string().optional().describe('Kurzes Etikett (max. ~12 Zeichen), z. B. "Format", "Ton".'),
          options: z
            .array(z.object({ label: z.string().describe('Kurze Option (1–5 Wörter).'), description: z.string().optional().describe('Was die Option bedeutet / Folgen.') }))
            .min(2)
            .max(4),
          multiSelect: z.boolean().optional().describe('true, wenn mehrere Optionen gewählt werden dürfen.'),
        }),
      )
      .min(1)
      .max(4),
  }),
  sideEffect: 'local',
  async run(args, ctx) {
    const questions: DirectorQuestion[] = args.questions.map((q, i) => ({
      id: `q${i + 1}`,
      question: q.question,
      header: q.header,
      options: q.options.map((o) => ({ label: o.label, description: o.description })),
      multiSelect: q.multiSelect,
    }));
    const answers = await ctx.ui.askUser(questions, ctx.signal, { runId: ctx.runId });
    const lines = questions.map((q) => {
      const answer = answers[q.id] ?? answers[q.question] ?? '(keine Antwort)';
      return `${q.header ? `[${q.header}] ` : ''}${q.question}\n→ ${answer}`;
    });
    return textResult(`Antworten des Nutzers:\n${lines.join('\n')}`);
  },
});

export const proposeCheckpointTool = defineTool({
  name: 'propose_checkpoint',
  description: [
    'Legt einen Checkpoint (z. B. Treatment, Style Bible, Storyboard) mit Zusammenfassung, Belegen (Asset-IDs) und Budgetantrag zur Freigabe vor. Erzeugt eine Freigabekarte im Panel und wartet NICHT.',
    'Die Entscheidung des Nutzers erfährst du später über den <checkpoints>- bzw. <budget>-Kontext. Gib nichts über das freigegebene Budget hinaus aus.',
    'Die Zusammenfassung ist Markdown: Idee/Inhalt, was geprüft wurde, Kostenaufstellung (Modell × Menge × Preis) und was du vom Nutzer brauchst.',
  ].join(' '),
  input: z.object({
    checkpointId: z.string().describe('ID aus <checkpoints>, z. B. "cp_1_treatment".'),
    summary: z.string().describe('Markdown-Zusammenfassung für die Freigabekarte.'),
    assetIds: z.array(z.string()).optional().describe('Belege: Treatment-Text, Style-Bible-Bilder, Shotliste …'),
    budgetRequestedUsd: z.number().min(0).optional().describe('Beantragtes Budget für die nächste Phase in USD.'),
  }),
  sideEffect: 'local',
  async run(args, ctx) {
    const missing = (args.assetIds ?? []).filter((id) => !ctx.project.getAsset(id));
    if (missing.length) return errorResult(`Unbekannte Asset-IDs: ${missing.join(', ')}`);
    const known = ctx.project.manifest.checkpoints;
    if (!known.some((c) => c.id === args.checkpointId)) {
      return errorResult(`Checkpoint „${args.checkpointId}“ existiert nicht. Vorhanden: ${known.map((c) => `${c.id} (${c.title}, ${c.status})`).join(', ') || 'keine (Kategorie noch nicht gesetzt – set_brief zuerst)'}`);
    }
    try {
      const manifest = await ctx.project.updateManifest((m) => {
        m.checkpoints = proposeCheckpoint(
          m.checkpoints,
          args.checkpointId,
          {
            summary: args.summary,
            ...(args.assetIds ? { assetIds: args.assetIds } : {}),
            ...(args.budgetRequestedUsd !== undefined ? { budgetRequestedUsd: args.budgetRequestedUsd } : {}),
          },
          ctx.clock(),
        );
      });
      ctx.ui.emit({ type: 'checkpoints', projectId: ctx.projectId, checkpoints: manifest.checkpoints });
      ctx.ui.emit({ type: 'manifest', projectId: ctx.projectId, manifest });
      const cp = manifest.checkpoints.find((c) => c.id === args.checkpointId)!;
      return textResult(
        `Checkpoint „${cp.title}“ vorgelegt${args.budgetRequestedUsd !== undefined ? ` mit Budgetantrag ${formatUsd(args.budgetRequestedUsd)}` : ''}. Die Freigabe erfolgt durch den Nutzer; bis dahin keine kostenpflichtigen Schritte für die nächste Phase.`,
      );
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});

export const mergeCheckpointsTool = defineTool({
  name: 'merge_checkpoints',
  description: [
    'Legt mehrere noch offene Checkpoints (Status pending oder changes_requested) zu einem zusammen, z. B. Treatment und Style Bible bei kleinen Projekten.',
    'Der zusammengelegte Checkpoint behält ID und Position des in der Reihenfolge ersten und bekommt den neuen Titel; die übrigen entfallen.',
    'Bereits vorgelegte, freigegebene oder übersprungene Checkpoints lassen sich nicht zusammenlegen. Danach mit propose_checkpoint vorlegen.',
  ].join(' '),
  input: z.object({
    ids: z.array(z.string()).min(2).describe('IDs aus <checkpoints>, mindestens zwei.'),
    title: z.string().min(1).describe('Titel des zusammengelegten Checkpoints, z. B. "Treatment & Style Bible".'),
  }),
  sideEffect: 'local',
  async run(args, ctx) {
    try {
      const manifest = await ctx.project.updateManifest((m) => {
        m.checkpoints = mergeCheckpoints(m.checkpoints, args.ids, args.title);
      });
      ctx.ui.emit({ type: 'checkpoints', projectId: ctx.projectId, checkpoints: manifest.checkpoints });
      ctx.ui.emit({ type: 'manifest', projectId: ctx.projectId, manifest });
      const merged = manifest.checkpoints.find((c) => args.ids.includes(c.id));
      const cps = manifest.checkpoints.map((c) => `${c.id} (${c.title}, ${c.status})`).join(', ');
      return textResult(`Checkpoints zusammengelegt${merged ? ` zu ${merged.id} „${merged.title}“` : ''}.\nCheckpoints: ${cps}`);
    } catch (error) {
      return errorResult(errorMessage(error));
    }
  },
});

export const postUpdateTool = defineTool({
  name: 'post_update',
  description:
    'Schreibt eine Nachricht wörtlich ins Director-Panel, während du weiterarbeitest – für Inhalte, die der Nutzer genau so sehen soll (Zwischenstand mit klickbaren Zeitstempeln, Shotliste, Kostenaufstellung, exakte Werte). Für kurze Fortschrittsnotizen reicht normaler Text; nutze dieses Tool für längere Turns, damit das Panel nicht verstummt.',
  input: z.object({ markdown: z.string().describe('Nachricht in Markdown, in der Sprache des Nutzers.') }),
  sideEffect: 'local',
  async run(args, ctx) {
    const message = await ctx.postMessage(args.markdown);
    return textResult(`Im Panel veröffentlicht (${message.id}).`);
  },
});

const FORMAT_IDS = Object.keys(STANDARD_FORMATS) as [string, ...string[]];

export const setBriefTool = defineTool({
  name: 'set_brief',
  description: [
    'Hält das Ergebnis des Planungsgesprächs als strukturierten Projekt-Brief fest und beendet die Planungsphase (Phase → Produktion).',
    'Rufe es auf, sobald du einen starken Vorschlag machen kannst – danach legst du mit propose_checkpoint den ersten Checkpoint vor.',
    'Ist die Projektkategorie noch offen, setzt du sie hier (video, audio, slides, graphic, web); das legt Dokument und Checkpoint-Folge an. Formate als IDs ("16:9", "9:16", "1:1", "4:5"). Später erneut aufrufen, um den Brief zu aktualisieren.',
  ].join(' '),
  input: z.object({
    goal: z.string().describe('Ziel / Kernidee in 1–3 Sätzen.'),
    audience: z.string().describe('Zielgruppe und Ort der Ausspielung.'),
    platforms: z.array(z.string()).optional(),
    formats: z.array(z.enum(FORMAT_IDS)).optional().describe('Ausgabeformate, erstes = Hauptformat.'),
    lengthSec: z.number().positive().optional(),
    tone: z.string().optional(),
    references: z.array(z.string()).optional().describe('Referenzen (Werke, URLs, Asset-IDs) mit Stichwort, was übernommen wird.'),
    constraints: z.string().optional(),
    budgetUsd: z.number().min(0).optional().describe('Vom Nutzer genannter Gesamtrahmen.'),
    deadline: z.string().optional(),
    language: z.string().optional().describe('Sprache des Inhalts, z. B. "de".'),
    notes: z.string().optional(),
    category: z.enum(PROJECT_CATEGORIES).optional().describe('Projektkategorie, falls noch nicht gesetzt.'),
  }),
  sideEffect: 'local',
  async run(args, ctx) {
    const { category, formats: formatIds, ...briefInput } = args;
    const brief = projectBriefSchema.parse({ ...briefInput, ...(formatIds ? { formats: formatIds } : {}) });
    const formats: FormatSpec[] | undefined = formatIds?.map((id) => STANDARD_FORMATS[id]!).filter(Boolean);
    const notes: string[] = [];
    const before = ctx.project.manifest;
    if (category && !before.category) {
      try {
        await ctx.project.setCategory(category, formats);
        notes.push(`Kategorie gesetzt: ${CATEGORY_LABELS[category]}; Dokument und Checkpoints angelegt.`);
        const head = await ctx.project.head();
        if (head) {
          const { document: _d, ops: _o, ...meta } = head;
          ctx.ui.emit({ type: 'document', projectId: ctx.projectId, version: meta });
        }
      } catch (error) {
        return errorResult(`Kategorie konnte nicht gesetzt werden: ${errorMessage(error)}`);
      }
    } else if (category && before.category && category !== before.category) {
      notes.push(`Hinweis: Kategorie bleibt ${before.category} (nachträglich nicht änderbar).`);
    } else if (!category && !before.category) {
      return errorResult('Die Projektkategorie ist noch offen – gib category an (video, audio, slides, graphic, web).');
    }
    const manifest = await ctx.project.updateManifest((m) => {
      m.brief = brief;
      m.phase = 'production';
    });
    ctx.ui.emit({ type: 'manifest', projectId: ctx.projectId, manifest });
    ctx.ui.emit({ type: 'checkpoints', projectId: ctx.projectId, checkpoints: manifest.checkpoints });
    const cps = manifest.checkpoints.map((c) => `${c.id} (${c.title}, ${c.status})`).join(', ');
    return textResult(`Brief gespeichert, Phase: Produktion. ${notes.join(' ')}\nCheckpoints: ${cps}\nNächster Schritt: ersten Checkpoint vorbereiten und mit propose_checkpoint vorlegen.`);
  },
});

export type { ToolContext };
