// Temporary diagnostics: switch off here after measuring, without changing
// bindings, authentication, queries or database structure.
export const PERFORMANCE_DIAGNOSTICS = true;

// Only fixed names and numeric durations can reach the response header.
const stages = [
  'access_jwt',
  'account_store',
  'summary_d1',
  'account_resolve_d1',
  'account_bootstrap_d1',
  'me_resolve_d1',
  'me_bootstrap_d1',
  'presence_d1',
  'demo_session_d1',
] as const;
type Stage = (typeof stages)[number];

export class RequestTimings {
  private readonly started: number;
  private readonly durations = new Map<Stage, number>();

  constructor(private readonly now: () => number = () => performance.now()) {
    this.started = now();
  }

  async measure<T>(stage: Stage, operation: () => Promise<T>): Promise<T> {
    const start = this.now();
    try {
      return await operation();
    } finally {
      const elapsed = Math.max(0, this.now() - start);
      this.durations.set(stage, (this.durations.get(stage) || 0) + elapsed);
    }
  }

  header(): string {
    const entries: [string, number][] = [['worker', Math.max(0, this.now() - this.started)]];
    for (const stage of stages) {
      const duration = this.durations.get(stage);
      if (duration !== undefined) entries.push([stage, duration]);
    }
    // Emit only the allowlisted stages, never query text or caller-provided labels.
    return entries
      .map(
        ([name, duration]) =>
          `${name};dur=${Number.isFinite(duration) ? duration.toFixed(2) : '0.00'}`,
      )
      .join(', ');
  }
}

export function measureTiming<T>(
  timings: RequestTimings | undefined,
  stage: Stage,
  operation: () => Promise<T>,
): Promise<T> {
  return timings ? timings.measure(stage, operation) : operation();
}
