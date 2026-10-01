/** Erzeugt IDs der Form `<prefix>_<suffix>`. Injizierbar, damit Tests deterministisch bleiben. */
export type IdGenerator = (prefix: string) => string;

let counter = 0;

export const defaultIdGenerator: IdGenerator = (prefix) => {
  counter = (counter + 1) % 1_679_616;
  const time = Date.now().toString(36);
  const seq = counter.toString(36).padStart(4, '0');
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `${prefix}_${time}${seq}${rand}`;
};

/** Deterministischer Generator: `ast_1`, `ast_2`, … je Präfix. */
export function sequentialIds(): IdGenerator {
  const counts = new Map<string, number>();
  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}
