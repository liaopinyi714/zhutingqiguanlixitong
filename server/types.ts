import type { AuthEnv, Session } from './auth';
import type { RequestTimings } from './timing';
import type { AccountResolution } from './account-resolution';

export type Env = AuthEnv & { DB: D1Database; FILES: R2Bucket };
export type AppContext = {
  Bindings: Env;
  Variables: { session: Session; timings?: RequestTimings; accountResolution?: AccountResolution };
};
