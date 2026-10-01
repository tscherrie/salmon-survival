/**
 * Dateien, die neben einer Ablagezone (z. B. Composer) fallen gelassen werden, darf der Browser nicht selbst
 * öffnen – sonst navigiert das Fenster zur Datei (Electron blockiert das im Hauptprozess zusätzlich). Ablagezonen
 * rufen `preventDefault()` selbst auf; alles, was danach unbehandelt bis zum Fenster durchläuft, wird hier verworfen.
 */
export function installDropGuard(target: Window = window): () => void {
  const onDragOver = (event: DragEvent) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  const onDrop = (event: DragEvent) => {
    if (!event.defaultPrevented) event.preventDefault();
  };
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
