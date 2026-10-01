import type { Hono, Context } from 'hono';
import type { AppContext } from './types';
import { today } from '../shared/calendar';
import { retentionCutoff } from './retention';
import { decodeCursor, listInput, ListInputError, pageResult } from './pagination';
import { measureTiming } from './timing';

export const repairRank = "CASE r.status WHEN '待送修' THEN 2 WHEN '维修中' THEN 1 ELSE 0 END";
export const warrantyKey = "COALESCE(NULLIF(json_extract(f.data,'$.warranty'),''),'9999')";
const customerColumns =
  'c.id,c.name,c.gender,c.birth_date,c.phone,c.contact,c.contact_phone,c.address,c.source,c.status,c.created_at,c.deleted_at';
const mapCustomer = (r: any) => ({ ...r, birthDate: r.birth_date, contactPhone: r.contact_phone });
const activeCustomer =
  'JOIN customers c ON c.id=f.customer_id AND c.tenant_id=f.tenant_id AND c.deleted_at IS NULL';
type Kind = 'customers' | 'removed' | 'devices' | 'repairs' | 'followups' | 'warranties';

export function buildListQuery(
  kind: Kind,
  tenant: string,
  query: Record<string, string>,
  date = today(),
) {
  const filters =
    kind === 'customers'
      ? ['全部', '全部客户', '待评估', '试戴中', '已验配', '长期随访']
      : kind === 'followups'
        ? ['全部', '待完成', '今日', '已逾期', '已完成']
        : kind === 'repairs'
          ? ['全部', '待送修', '维修中', '已完成', '无法修复']
          : kind === 'warranties'
            ? ['全部', '需关注', '90 天内到期', '已到期', '保修中', '未填写']
            : kind === 'devices'
              ? ['全部', '双耳', '左耳', '右耳']
              : ['全部'];
  const params = listInput(query, filters);
  // Relative-date filters reset at Beijing midnight; other cursors remain valid.
  const scope = JSON.stringify([
    tenant,
    kind,
    params.filter,
    params.q,
    kind === 'warranties' || kind === 'followups' || kind === 'removed' ? date : '',
  ]);
  const where: string[] = [];
  const values: any[] = [tenant];
  let select = '',
    from = '',
    order: string[] = [],
    keys: string[] = [],
    direction = 'DESC';
  if (kind === 'customers' || kind === 'removed') {
    // Older open tabs use list rows as editable profiles. Retain their notes in
    // bounded legacy arrays; current paged lists fetch a complete profile by ID.
    select = params.paged === '1' ? customerColumns : 'c.*';
    from = 'customers c';
    where.push('c.tenant_id=?');
    if (kind === 'removed') {
      where.push('c.deleted_at IS NOT NULL', 'c.deleted_at>?');
      values.push(retentionCutoff());
      order = ['c.deleted_at', 'c.id'];
      keys = ['deleted_at', 'id'];
    } else {
      where.push('c.deleted_at IS NULL');
      if (!['全部', '全部客户'].includes(params.filter)) {
        where.push('c.status=?');
        values.push(params.filter);
      }
      order = ['c.created_at', 'c.id'];
      keys = ['created_at', 'id'];
    }
    if (params.q) {
      where.push(
        "(c.name LIKE ? ESCAPE '!' OR c.phone LIKE ? ESCAPE '!' OR c.id LIKE ? ESCAPE '!')",
      );
      values.push(...Array(3).fill(params.pattern));
    }
  } else if (kind === 'devices' || kind === 'warranties') {
    select = `f.id,f.customer_id,f.date,f.created_at,c.name,c.phone,f.data,${warrantyKey} AS _warranty,
      (SELECT COUNT(*) FROM repairs r WHERE r.fitting_id=f.id AND r.customer_id=f.customer_id AND r.tenant_id=f.tenant_id AND r.deleted_at IS NULL) AS repair_count`;
    from = `fittings f ${activeCustomer}`;
    where.push('f.tenant_id=?', 'f.deleted_at IS NULL');
    order = ['f.date', 'f.created_at', 'f.id'];
    keys = ['date', 'created_at', 'id'];
    if (kind === 'devices' && params.filter !== '全部') {
      where.push("json_extract(f.data,'$.side')=?");
      values.push(params.filter);
    }
    if (kind === 'warranties') {
      direction = 'ASC';
      order = [warrantyKey, 'f.id'];
      keys = ['_warranty', 'id'];
      if (params.filter === '未填写') where.push(`${warrantyKey}='9999'`);
      else if (params.filter !== '全部') {
        // Use the same indexed expression as ORDER BY, with date-range bounds.
        if (params.filter === '需关注') {
          where.push(`${warrantyKey}<=date(?,'+90 days')`);
          values.push(date);
        }
        if (params.filter === '90 天内到期') {
          where.push(`${warrantyKey} BETWEEN ? AND date(?,'+90 days')`);
          values.push(date, date);
        }
        if (params.filter === '已到期') {
          where.push(`${warrantyKey}<?`);
          values.push(date);
        }
        if (params.filter === '保修中') {
          where.push(`${warrantyKey}>=? AND ${warrantyKey}<>'9999'`);
          values.push(date);
        }
      }
    }
    if (params.q) {
      where.push(`(c.name LIKE ? ESCAPE '!' OR c.phone LIKE ? ESCAPE '!' OR
      (COALESCE(json_extract(f.data,'$.brand'),'')||' · '||COALESCE(json_extract(f.data,'$.series'),'')||' · '||COALESCE(json_extract(f.data,'$.model'),'')) LIKE ? ESCAPE '!' OR
      COALESCE(json_extract(f.data,'$.serialLeft'),'') LIKE ? ESCAPE '!' OR COALESCE(json_extract(f.data,'$.serialRight'),'') LIKE ? ESCAPE '!' OR COALESCE(json_extract(f.data,'$.serial'),'') LIKE ? ESCAPE '!')`);
      values.push(...Array(6).fill(params.pattern));
    }
  } else if (kind === 'repairs') {
    select = `r.*,c.name,c.phone,f.data AS device_data,${repairRank} AS _rank`;
    from =
      'repairs r JOIN customers c ON c.id=r.customer_id AND c.tenant_id=r.tenant_id AND c.deleted_at IS NULL JOIN fittings f ON f.id=r.fitting_id AND f.customer_id=r.customer_id AND f.tenant_id=r.tenant_id AND f.deleted_at IS NULL';
    where.push('r.tenant_id=?', 'r.deleted_at IS NULL');
    order = [repairRank, 'r.occurred_date', 'r.created_at', 'r.id'];
    keys = ['_rank', 'occurred_date', 'created_at', 'id'];
    if (params.filter !== '全部') {
      where.push('r.status=?');
      values.push(params.filter);
    }
    if (params.q) {
      where.push(
        `(c.name LIKE ? ESCAPE '!' OR c.phone LIKE ? ESCAPE '!' OR r.problem LIKE ? ESCAPE '!' OR r.parts LIKE ? ESCAPE '!' OR r.work_done LIKE ? ESCAPE '!' OR f.data LIKE ? ESCAPE '!')`,
      );
      values.push(...Array(6).fill(params.pattern));
    }
  } else {
    select = 'f.*,c.name,c.phone';
    from = `followups f ${activeCustomer}`;
    where.push('f.tenant_id=?', 'f.deleted_at IS NULL');
    direction = 'ASC';
    order = ['f.completed', 'f.due', 'f.id'];
    keys = ['completed', 'due', 'id'];
    if (params.filter === '已完成') where.push('f.completed=1');
    else if (params.filter !== '全部') {
      where.push('f.completed=0');
      if (params.filter === '今日') {
        where.push('f.due=?');
        values.push(date);
      }
      if (params.filter === '已逾期') {
        where.push('f.due<?');
        values.push(date);
      }
    }
    if (params.q) {
      where.push(
        "(c.name LIKE ? ESCAPE '!' OR c.phone LIKE ? ESCAPE '!' OR f.type LIKE ? ESCAPE '!' OR f.note LIKE ? ESCAPE '!' OR f.result LIKE ? ESCAPE '!')",
      );
      values.push(...Array(5).fill(params.pattern));
    }
  }
  const cursor = decodeCursor(params.cursor, scope, keys.length);
  if (cursor && (kind === 'repairs' || kind === 'warranties')) {
    // SQLite cannot seek an expression as part of a row-value tuple. Split the
    // expression prefix and the remaining ordinary columns into two ordered
    // ranges. Only fetch the second range if the first cannot fill this page.
    const compare = direction === 'ASC' ? '>' : '<';
    const prefix = `SELECT ${select} FROM ${from} WHERE ${where.join(' AND ')}`;
    const tail = order.slice(1),
      tailValues = cursor.slice(1);
    const tailCondition =
      tail.length === 1
        ? `${tail[0]}${compare}?`
        : `(${tail.join(',')})${compare}(${tail.map(() => '?').join(',')})`;
    const sql = `${prefix} AND ${order[0]}=? AND ${tailCondition}
      ORDER BY ${tail.map((column) => `${column} ${direction}`).join(',')} LIMIT ?`;
    const continuation = {
      sql: `${prefix} AND ${order[0]}${compare}?
      ORDER BY ${order.map((column) => `${column} ${direction}`).join(',')} LIMIT ?`,
      values: [...values, cursor[0], params.limit + 1],
    };
    return {
      sql,
      values: [...values, cursor[0], ...tailValues, params.limit + 1],
      continuation,
      params,
      scope,
      keys,
    };
  }
  if (cursor) {
    let seekOrder = order,
      seekCursor = cursor;
    if (kind === 'followups' && params.filter !== '全部') {
      // A fixed leading column inside a tuple prevents SQLite from seeking its
      // later columns. The equality is already in WHERE: seek only the suffix.
      const completed = params.filter === '已完成' ? 1 : 0;
      if (cursor[0] !== completed || (params.filter === '今日' && cursor[1] !== date))
        throw new ListInputError('分页位置已失效，请从第一页重新加载');
      const prefix = params.filter === '今日' ? 2 : 1;
      seekOrder = order.slice(prefix);
      seekCursor = cursor.slice(prefix);
    }
    where.push(
      `(${seekOrder.join(',')})${direction === 'ASC' ? '>' : '<'}(${seekOrder.map(() => '?').join(',')})`,
    );
    values.push(...seekCursor);
  }
  const sql = `SELECT ${select} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${order.map((column) => `${column} ${direction}`).join(',')} LIMIT ?`;
  values.push(params.limit + 1);
  return { sql, values, params, scope, keys };
}

export function installReadRoutes(app: Hono<AppContext>) {
  const paths: [string, Kind][] = [
    ['/customers', 'customers'],
    ['/customers/removed', 'removed'],
    ['/devices', 'devices'],
    ['/repairs', 'repairs'],
    ['/followups', 'followups'],
    ['/warranties', 'warranties'],
  ];
  for (const [path, kind] of paths)
    app.get('/api' + path, async (c) => {
      if (kind === 'removed' && c.get('session').role !== '店主')
        return c.json({ error: '只有店主可以查看已删除档案' }, 403);
      try {
        const plan = buildListQuery(kind, c.get('session').tenant_id, c.req.query());
        const rows = (
          await c.env.DB.prepare(plan.sql)
            .bind(...plan.values)
            .all()
        ).results;
        if (plan.continuation && rows.length < plan.params.limit + 1) {
          const next = plan.continuation;
          const extra = (
            await c.env.DB.prepare(next.sql)
              .bind(...next.values.slice(0, -1), plan.params.limit + 1 - rows.length)
              .all()
          ).results;
          rows.push(...extra);
        }
        const result = pageResult(rows, plan.params.limit, plan.scope, plan.keys, (row) => {
          if (kind === 'customers' || kind === 'removed') return mapCustomer(row);
          const { _rank, _warranty, data, device_data, ...rest } = row;
          if (kind === 'devices' || kind === 'warranties') return { ...JSON.parse(data), ...rest };
          if (kind === 'repairs')
            return { ...rest, device: { ...JSON.parse(device_data), id: rest.fitting_id } };
          return rest;
        });
        // Bounded array compatibility for old tabs; the current UI requests paged=1.
        return c.json(plan.params.paged === '1' ? result : result.items);
      } catch (error) {
        if (error instanceof ListInputError) return c.json({ error: error.message }, 400);
        throw error;
      }
    });
  app.get('/api/customers/duplicates', async (c) => {
    const name = (c.req.query('name') || '').trim(),
      birthDate = c.req.query('birthDate') || '',
      exclude = c.req.query('exclude') || '';
    if (name.length > 40 || !/^(\d{4}-\d{2}-\d{2})?$/.test(birthDate) || exclude.length > 64)
      return c.json({ error: '客户查询参数无效' }, 400);
    if (!name) return c.json([]);
    const rows = await c.env.DB.prepare(
      'SELECT id,name FROM customers WHERE tenant_id=? AND name=? AND birth_date=? AND id<>? AND deleted_at IS NULL LIMIT 5',
    )
      .bind(c.get('session').tenant_id, name, birthDate, exclude)
      .all();
    return c.json(rows.results);
  });
  app.get('/api/customers/:id', async (c) => {
    const row = await c.env.DB.prepare(
      'SELECT * FROM customers WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
    )
      .bind(c.req.param('id'), c.get('session').tenant_id)
      .first();
    return row ? c.json(mapCustomer(row)) : c.json({ error: '没有找到这位客户' }, 404);
  });
  app.get('/api/summary', summary);
}

async function summary(c: Context<AppContext>) {
  const tenant = c.get('session').tenant_id,
    date = today(),
    detailed = c.req.query('detail') === '1';
  const customerSql = detailed
    ? `SELECT status,source,
       CASE WHEN birth_date='' OR date(birth_date) IS NULL THEN '未填写'
         WHEN (CAST(substr(?,1,4) AS INTEGER)-CAST(substr(birth_date,1,4) AS INTEGER)-(substr(?,6)<substr(birth_date,6)))<40 THEN '40 岁以下'
         WHEN (CAST(substr(?,1,4) AS INTEGER)-CAST(substr(birth_date,1,4) AS INTEGER)-(substr(?,6)<substr(birth_date,6)))<60 THEN '40–59 岁'
         WHEN (CAST(substr(?,1,4) AS INTEGER)-CAST(substr(birth_date,1,4) AS INTEGER)-(substr(?,6)<substr(birth_date,6)))<80 THEN '60–79 岁'
         ELSE '80 岁及以上' END AS age_bucket, COUNT(*) AS count
       FROM customers WHERE tenant_id=? AND deleted_at IS NULL GROUP BY status,source,age_bucket`
    : 'SELECT status,COUNT(*) AS count FROM customers WHERE tenant_id=? AND deleted_at IS NULL GROUP BY status';
  const [customers, followups, devices, repairs] = await measureTiming(
    c.get('timings'),
    'summary_d1',
    () =>
      c.env.DB.batch([
        c.env.DB.prepare(customerSql).bind(
          ...(detailed ? [...Array(6).fill(date), tenant] : [tenant]),
        ),
        c.env.DB.prepare(
          `SELECT f.completed,${detailed ? 'f.type,' : ''}COUNT(*) AS count,
      SUM(f.completed=0 AND f.due=?) AS today_count,SUM(f.completed=0 AND f.due<?) AS overdue_count
      FROM followups f ${activeCustomer} WHERE f.tenant_id=? AND f.deleted_at IS NULL GROUP BY f.completed${detailed ? ',f.type' : ''}`,
        ).bind(date, date, tenant),
        c.env.DB.prepare(
          `SELECT COUNT(*) AS count,SUM(${warrantyKey}<=date(?,'+90 days')) AS alerts
      FROM fittings f ${activeCustomer} WHERE f.tenant_id=? AND f.deleted_at IS NULL`,
        ).bind(date, tenant),
        c.env.DB.prepare(
          `SELECT COUNT(*) AS count FROM repairs r
      JOIN customers c ON c.id=r.customer_id AND c.tenant_id=r.tenant_id AND c.deleted_at IS NULL
      JOIN fittings f ON f.id=r.fitting_id AND f.customer_id=r.customer_id AND f.tenant_id=r.tenant_id AND f.deleted_at IS NULL
      WHERE r.tenant_id=? AND r.deleted_at IS NULL`,
        ).bind(tenant),
      ]),
  );
  const status: Record<string, number> = Object.create(null),
    sources: Record<string, number> = Object.create(null),
    ages: Record<string, number> = Object.create(null),
    types: Record<string, number> = Object.create(null);
  let customerCount = 0,
    fitted = 0,
    pending = 0,
    completed = 0,
    todayCount = 0,
    overdue = 0;
  for (const row of customers.results as any[]) {
    customerCount += row.count;
    status[row.status] = (status[row.status] || 0) + row.count;
    if (['已验配', '长期随访'].includes(row.status)) fitted += row.count;
    if (detailed) {
      sources[row.source || '未填写'] = (sources[row.source || '未填写'] || 0) + row.count;
      ages[row.age_bucket] = (ages[row.age_bucket] || 0) + row.count;
    }
  }
  for (const row of followups.results as any[]) {
    if (row.completed) completed += row.count;
    else pending += row.count;
    todayCount += row.today_count || 0;
    overdue += row.overdue_count || 0;
    if (detailed) types[row.type] = (types[row.type] || 0) + row.count;
  }
  const device = devices.results[0] as any;
  return c.json({
    date,
    customers: customerCount,
    fitted,
    status,
    pending,
    completed,
    today: todayCount,
    overdue,
    devices: device.count,
    repairs: (repairs.results[0] as any).count,
    warrantyAlerts: device.alerts || 0,
    ...(detailed ? { sources, ages, types } : {}),
  });
}
