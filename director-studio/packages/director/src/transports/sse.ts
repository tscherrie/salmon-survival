/**
 * Minimaler SSE-Parser (Server-Sent Events) für fetch-Streams. Kommentare (`: …`, z. B. OpenRouter-
 * Keep-Alives) werden ignoriert; mehrzeilige `data:`-Felder werden zusammengefügt.
 */
export interface SseEvent {
  event?: string | undefined;
  data: string;
  id?: string | undefined;
}

export async function* parseSse(body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  const flush = (): SseEvent | undefined => {
    if (dataLines.length === 0) {
      event = undefined;
      return undefined;
    }
    const out: SseEvent = { data: dataLines.join('\n'), ...(event ? { event } : {}), ...(id ? { id } : {}) };
    dataLines = [];
    event = undefined;
    return out;
  };

  const handleLine = (line: string): SseEvent | undefined => {
    if (line === '') return flush();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
    return undefined;
  };

  const iterable: AsyncIterable<Uint8Array> = isReadableStream(body) ? readableToIterable(body) : body;
  for await (const chunk of iterable) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.search(/\r\n|\n|\r/)) >= 0) {
      const line = buffer.slice(0, newline);
      const sepLength = buffer.startsWith('\r\n', newline) ? 2 : 1;
      buffer = buffer.slice(newline + sepLength);
      const ev = handleLine(line);
      if (ev) yield ev;
    }
  }
  buffer += decoder.decode();
  if (buffer) {
    const ev = handleLine(buffer);
    if (ev) yield ev;
  }
  const last = flush();
  if (last) yield last;
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return !!value && typeof (value as ReadableStream).getReader === 'function';
}

async function* readableToIterable(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
