import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

export type AuthEnv = {
  DEMO_MODE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  STAFF_ACCOUNTS?: string;
};
export type Session = {
  role: string;
  tenant_id: string;
  actor: string;
  name: string;
  email?: string;
  storeName: string;
  avatar?: string;
};
export class AuthError extends Error {
  status: 401 | 403 | 503;
  constructor(message: string, status: 401 | 403 | 503) {
    super(message);
    this.status = status;
  }
}
export function isLocalDemo(env: AuthEnv, url: string) {
  return (
    env.DEMO_MODE === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  );
}
const staffSchema = z
  .array(
    z.object({
      email: z
        .string()
        .trim()
        .email()
        .transform((s) => s.toLowerCase()),
      name: z.string().trim().min(1).max(60),
      // Accept legacy configuration syntax without granting legacy roles access.
      role: z.enum(['店主', '验配师', '前台']),
      tenantId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,64}$/)
        .refine((s) => s !== 'demo-store'),
      storeName: z.string().trim().min(1).max(80),
    }),
  )
  .min(1)
  .max(50)
  .superRefine((rows, ctx) => {
    const emails = new Set<string>();
    const stores = new Map<string, string>();
    for (const row of rows) {
      if (
        emails.has(row.email) ||
        (stores.has(row.tenantId) && stores.get(row.tenantId) !== row.storeName)
      )
        ctx.addIssue({ code: 'custom', message: '员工邮箱不能重复，同一门店名称必须一致' });
      emails.add(row.email);
      stores.set(row.tenantId, row.storeName);
    }
  });
let lastStaffConfig: string | undefined;
let lastStaff: z.infer<typeof staffSchema>;
export function readStaffAccounts(raw: string | undefined) {
  if (raw && raw === lastStaffConfig) return lastStaff;
  try {
    if (new TextEncoder().encode(raw || '').length > 5120) throw new Error('Config too large');
    const staff = staffSchema.parse(JSON.parse(raw || ''));
    lastStaffConfig = raw;
    lastStaff = staff;
    return staff;
  } catch {
    throw new AuthError('员工权限尚未正确配置，请联系管理员', 503);
  }
}
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function accessSession(
  request: Request,
  env: AuthEnv,
  lookup?: (email: string) => Promise<Session>,
): Promise<Session> {
  const domain = env.ACCESS_TEAM_DOMAIN || '';
  const audience = env.ACCESS_AUD || '';
  if (
    !/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(domain) ||
    !audience ||
    audience.includes('REPLACE')
  )
    throw new AuthError('员工登录尚未配置，请联系管理员', 503);
  const staff = readStaffAccounts(env.STAFF_ACCOUNTS);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new AuthError('登录已过期，请重新验证员工身份', 401);
  const issuer = `https://${domain}`;
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 });
    if (keySets.size >= 4) keySets.clear();
    keySets.set(issuer, keys);
  }
  let email: string;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email', 'type'],
      clockTolerance: 5,
    });
    if (payload.type !== 'app' || typeof payload.email !== 'string')
      throw new Error('Invalid identity');
    email = payload.email.toLowerCase();
  } catch {
    throw new AuthError('无法验证登录身份，请重新登录', 401);
  }
  if (lookup) return lookup(email);
  const account = staff.find((entry) => entry.email === email);
  if (!account || account.role !== '店主')
    throw new AuthError('该员工尚未获得门店访问权限，请联系管理员', 403);
  return {
    role: account.role,
    tenant_id: account.tenantId,
    email,
    name: account.name,
    storeName: account.storeName,
    actor: `${account.name} <${email}>`,
  };
}
