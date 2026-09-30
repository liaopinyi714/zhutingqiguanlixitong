import type { AuthEnv, Session } from './auth';

export type Env = AuthEnv & { DB: D1Database; FILES: R2Bucket };
export type AppContext = { Bindings: Env; Variables: { session: Session } };
