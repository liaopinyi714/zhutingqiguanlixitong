// Pure rules shared by the browser, export generator and server validation.
// This module must not import request handlers, storage bindings or Zod.
export const frequencies = [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
export const editableFrequencies = [250, 500, 1000, 2000, 4000, 8000];

export function blankCurve() {
  return frequencies.map((frequency) => ({
    frequency,
    value: null,
    masked: false,
    noResponse: false,
  }));
}

export function pta(points: { frequency: number; value: number | null; noResponse?: boolean }[]) {
  const selected = [500, 1000, 2000, 4000].map((f) => points.find((p) => p.frequency === f));
  return selected.some((p) => !p || p.value === null || p.noResponse)
    ? null
    : Math.round((selected.reduce((n, p) => n + p!.value!, 0) / 4) * 10) / 10;
}
