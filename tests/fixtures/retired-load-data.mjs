// Retired fixture: used only by in-memory regression tests, including the
// one-time production cleanup. No CLI, filesystem output or remote executor.

export const loadTestBatch = 'loadtest-20261001';
export const seedTables = ['customers', 'fittings', 'exams', 'followups', 'repairs'];
const frequencies = [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
const editable = new Set([250, 500, 1000, 2000, 4000, 8000]);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function seedOptions({ storeId, count = 10000, date = '2026-10-01' }) {
  if (
    typeof storeId !== 'string' ||
    !storeId ||
    storeId.length > 200 ||
    /[\x00-\x1f]/.test(storeId)
  )
    throw new Error('需要有效的测试门店 ID');
  if (!Number.isInteger(count) || count < 100 || count > 50000)
    throw new Error('测试客户数量必须是 100 至 50000 的整数');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new Error('测试基准日期必须是有效的 YYYY-MM-DD');
  return {
    storeId,
    count,
    date,
    prefix: `${loadTestBatch}-${Buffer.from(storeId).toString('hex')}-`,
  };
}

function dateOffset(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
function curve(n, base) {
  return frequencies.map((frequency, i) => ({
    frequency,
    value: editable.has(frequency) ? Math.min(110, base + ((n + i) % 7) * 5) : null,
    masked: false,
    noResponse: false,
  }));
}

// All contact details are visibly fictional, rather than random real phone numbers.
export function seedRows(options, start, end) {
  const o = seedOptions(options);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > o.count
  )
    throw new Error('测试数据批次范围无效');
  const rows = Object.fromEntries(seedTables.map((table) => [table, []]));
  for (let n = start; n <= end; n++) {
    const number = String(n).padStart(6, '0');
    const customerId = `${o.prefix}c-${number}`;
    const created = `${dateOffset(o.date, -((n * 17) % 1460))} 09:30:${String(n % 60).padStart(2, '0')}`;
    rows.customers.push({
      id: customerId,
      tenant_id: o.storeId,
      name: `压测客户${number}`,
      gender: ['男', '女', '未填写'][n % 3],
      birth_date:
        n % 7 === 0 ? '' : `${1940 + (n % 65)}-${String(1 + (n % 12)).padStart(2, '0')}-15`,
      phone: `TEST-C${number}`,
      contact: `测试亲属${number}`,
      contact_phone: `TEST-F${number}`,
      address: `虚构地址：测试街${1 + (n % 800)}号`,
      source: ['自然到店', '老客转介绍', '社区活动', '网络咨询'][n % 4],
      status:
        n % 20 === 0 ? (n % 40 === 0 ? '长期随访' : '已验配') : n % 3 === 0 ? '试戴中' : '待评估',
      history: '虚构压测资料，无真实病史。',
      needs: '用于测试客户查询、分页和统计。',
      created_at: created,
    });
    if (n % 20 === 0) {
      const side = ['双耳', '左耳', '右耳'][Math.floor(n / 20) % 3];
      for (let version = 1; version <= (n % 200 === 0 ? 2 : 1); version++) {
        const serialLeft = side === '右耳' ? '' : `TEST-L${number}-${version}`;
        const serialRight = side === '左耳' ? '' : `TEST-R${number}-${version}`;
        const date = dateOffset(o.date, -((n * 7) % 730) - (version === 2 ? 800 : 0));
        rows.fittings.push({
          id: `${o.prefix}f-${number}-${version}`,
          tenant_id: o.storeId,
          customer_id: customerId,
          date,
          data: JSON.stringify({
            date,
            brand: '测试品牌',
            series: '',
            model: `测试机型${1 + (Math.floor(n / 20) % 5)}`,
            side,
            serialLeft,
            serialRight,
            serial: [serialLeft && `左耳：${serialLeft}`, serialRight && `右耳：${serialRight}`]
              .filter(Boolean)
              .join('；'),
            amount: 3000 + (n % 30) * 200,
            warranty:
              version === 2
                ? dateOffset(o.date, -400)
                : [
                    '',
                    dateOffset(o.date, -30),
                    dateOffset(o.date, 15),
                    dateOffset(o.date, 60),
                    dateOffset(o.date, 365),
                  ][Math.floor(n / 20) % 5],
            notes: '虚构验配记录。',
          }),
          created_at: `${date} 10:00:00`,
        });
      }
    }
    if (n % 100 === 0) {
      const date = dateOffset(o.date, -(n % 120));
      rows.exams.push({
        id: `${o.prefix}e-${number}`,
        tenant_id: o.storeId,
        customer_id: customerId,
        date,
        data: JSON.stringify({
          date,
          right: curve(n, 35),
          left: curve(n, 40),
          boneRight: curve(n, 25),
          boneLeft: curve(n, 30),
          uclRight: curve(n, 80),
          uclLeft: curve(n, 85),
          speech: '虚构言语检查结果。',
          other: '',
          conclusion: '仅用于软件压测。',
        }),
        created_at: `${date} 09:00:00`,
      });
    }
    if (n % 40 === 0) {
      const completed = Math.floor(n / 40) % 3 === 0 ? 1 : 0;
      rows.followups.push({
        id: `${o.prefix}u-${number}`,
        tenant_id: o.storeId,
        customer_id: customerId,
        due: dateOffset(o.date, completed ? -7 : (Math.floor(n / 40) % 15) - 7),
        type: ['适应回访', '听力复查', '清洁保养', '维修跟进', '到店预约'][Math.floor(n / 40) % 5],
        note: '虚构随访记录。',
        completed,
        result: completed ? '测试回访已完成。' : '',
        completed_at: completed ? `${dateOffset(o.date, -6)} 11:00:00` : null,
      });
    }
    if (n % 200 === 0) {
      const finished = Math.floor(n / 200) % 3 === 0;
      rows.repairs.push({
        id: `${o.prefix}r-${number}`,
        tenant_id: o.storeId,
        customer_id: customerId,
        fitting_id: `${o.prefix}f-${number}-1`,
        occurred_date: dateOffset(o.date, -10),
        received_date: dateOffset(o.date, -9),
        completed_date: finished ? dateOffset(o.date, -2) : '',
        status: finished ? '已完成' : n % 400 === 0 ? '待送修' : '维修中',
        problem: '虚构故障：测试声音异常。',
        findings: '测试检测记录。',
        work_done: finished ? '测试维修完成。' : '',
        parts: finished ? '测试受话器' : '',
        price: finished ? 200 + (n % 300) : 0,
        warranty_covered: n % 400 === 0 ? 1 : 0,
        notes: '非真实维修记录。',
        created_at: `${dateOffset(o.date, -9)} 10:00:00`,
      });
    }
  }
  return rows;
}

export function seedCounts(start, end) {
  const multiples = (step) => Math.floor(end / step) - Math.floor((start - 1) / step);
  return {
    customers: end - start + 1,
    fittings: multiples(20) + multiples(200),
    exams: multiples(100),
    followups: multiples(40),
    repairs: multiples(200),
  };
}

// Current production indexes: includes the TEXT primary-key indexes and excludes
// the customers_removed_page index, which does not contain active seed rows.
export function estimatedSeedWrites(counts) {
  return (
    counts.customers * 9 +
    counts.fittings * 8 +
    counts.exams * 4 +
    counts.followups * 7 +
    counts.repairs * 6
  );
}

function storeGuard(storeId) {
  return `EXISTS (SELECT 1 FROM stores s WHERE s.id=${quote(storeId)} AND s.deleted_at IS NULL AND s.abandoned_at IS NULL AND EXISTS (SELECT 1 FROM store_memberships m WHERE m.tenant_id=s.id AND m.enabled=1))`;
}

export function seedSQL(options, start, end) {
  const o = seedOptions(options),
    rows = seedRows(o, start, end);
  const statements = [];
  for (const table of seedTables) {
    if (!rows[table].length) continue;
    const columns = Object.keys(rows[table][0]);
    const parts = [];
    let part = [],
      bytes = 0;
    for (const row of rows[table]) {
      const tuple = `(${columns.map((key) => (row[key] === null ? 'NULL' : typeof row[key] === 'number' ? String(row[key]) : quote(row[key]))).join(',')})`;
      const size = Buffer.byteLength(tuple) + 2;
      // Bound UTF-8 bytes as well as row count (hearing JSON is much larger).
      if (part.length && (part.length === 100 || bytes + size > 70000)) {
        parts.push(part);
        part = [];
        bytes = 0;
      }
      part.push(tuple);
      bytes += size;
    }
    if (part.length) parts.push(part);
    for (const part of parts) {
      const values = part.join(',\n');
      const parent =
        table === 'customers'
          ? ''
          : ` AND EXISTS (SELECT 1 FROM customers c WHERE c.id=input.customer_id AND c.tenant_id=input.tenant_id AND c.deleted_at IS NULL)`;
      const fitting =
        table === 'repairs'
          ? ' AND EXISTS (SELECT 1 FROM fittings f WHERE f.id=input.fitting_id AND f.customer_id=input.customer_id AND f.tenant_id=input.tenant_id AND f.deleted_at IS NULL)'
          : '';
      statements.push(
        `WITH input(${columns.join(',')}) AS (VALUES\n${values})\nINSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map((key) => `input.${key}`).join(',')} FROM input WHERE ${storeGuard(o.storeId)}${parent}${fitting} ON CONFLICT(id) DO NOTHING;`,
      );
    }
  }
  return statements;
}

export function seedCountSQL(options, start = 1, end = options.count) {
  const o = seedOptions(options);
  return (
    'SELECT ' +
    seedTables
      .map((table) => {
        const kind = { customers: 'c', fittings: 'f', exams: 'e', followups: 'u', repairs: 'r' }[
          table
        ];
        const low = `${o.prefix}${kind}-${String(start).padStart(6, '0')}`;
        const high = `${o.prefix}${kind}-${String(end + 1).padStart(6, '0')}`;
        // These stable TEXT primary-key indexes avoid rescanning the whole store
        // for each import chunk, even before SQLite has collected statistics.
        return `(SELECT COUNT(*) FROM ${table} INDEXED BY sqlite_autoindex_${table}_1 WHERE tenant_id=${quote(o.storeId)} AND id>=${quote(low)} AND id<${quote(high)}) AS ${table}`;
      })
      .join(',') +
    ';'
  );
}
