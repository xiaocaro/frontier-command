/** Definitions contain only plain records/arrays and primitives. */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
export function freezeDefinitions<T extends object>(value: T): DeepReadonly<T> {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freezeDefinitions(child);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}
