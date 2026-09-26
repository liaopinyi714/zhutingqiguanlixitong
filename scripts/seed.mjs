import { writeFileSync } from 'node:fs';
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const names = [
  '陈淑华',
  '王建国',
  '李明远',
  '周美琴',
  '张文清',
  '刘桂兰',
  '吴志成',
  '赵素芳',
  '徐正华',
  '孙秀英',
  '林海生',
  '郑玉珍',
];
const genders = ['女', '男', '男', '女', '女', '女', '男', '女', '男', '女', '男', '女'];
const statuses = [
  '长期随访',
  '试戴中',
  '已验配',
  '待评估',
  '长期随访',
  '已验配',
  '试戴中',
  '长期随访',
  '待评估',
  '已验配',
  '长期随访',
  '待评估',
];
const freq = [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
const points = (base) =>
  freq.map((frequency, i) => ({
    frequency,
    value: [125, 750, 1500, 3000, 6000].includes(frequency)
      ? null
      : Math.round((base + i * 2.5) / 5) * 5,
    noResponse: false,
    masked: false,
  }));
let sql = '-- All records below are fictional demonstration data.\n';
names.forEach((name, i) => {
  const cid = `demo-${i + 1}`;
  sql += `INSERT INTO customers(id,tenant_id,name,gender,birth_date,phone,contact,source,status,history,needs,created_at) VALUES(${[cid, 'demo-store', name, genders[i], `${1948 + i * 2}-0${(i % 9) + 1}-15`, '演示号码', i % 3 ? '女儿（演示联系人）' : '配偶（演示联系人）', ['老客转介绍', '自然到店', '社区活动'][i % 3], statuses[i], '自述近年听力逐渐下降。无明确耳部手术史。以上为虚构演示资料。', '希望改善家人交谈及看电视时的聆听体验。', `2026-09-${String(24 - i).padStart(2, '0')} 09:30:00`].map(q).join(',')});\n`;
  if (i % 4 !== 3) {
    const data = {
      date: '2026-09-18',
      right: points(35 + i),
      left: points(40 + i),
      boneRight: points(30 + i),
      boneLeft: points(35 + i),
      masked: false,
      speech: '安静环境言语识别：右耳 76%，左耳 72%（演示数据）',
      other: '耳镜检查：外耳道通畅。声导抗报告待补充。',
      conclusion: '记录客户在日常交谈中的困难，结合检查资料制定个体化试戴计划。',
    };
    sql += `INSERT INTO exams(id,tenant_id,customer_id,date,data) VALUES(${[`${cid}-exam`, 'demo-store', cid, data.date, JSON.stringify(data)].map(q).join(',')});\n`;
  }
  if (['已验配', '长期随访'].includes(statuses[i])) {
    const d = {
      date: '2026-09-20',
      brand: ['峰力', '奥迪康', '瑞声达'][i % 3],
      model: ['Audeo L50-R', 'Real 2 miniRITE R', 'OMNIA 5'][i % 3],
      side: '双耳',
      serial: `DEMO-L${i + 1} / DEMO-R${i + 1}`,
      amount: 12800 + i * 500,
      warranty: '2028-09-20',
      notes: '首次验配完成；已说明充电、佩戴和清洁方法。真耳验证结果请在实际服务中补充。',
    };
    sql += `INSERT INTO fittings(id,tenant_id,customer_id,date,data) VALUES(${[`${cid}-fit`, 'demo-store', cid, d.date, JSON.stringify(d)].map(q).join(',')});\n`;
  }
  sql += `INSERT INTO followups(id,tenant_id,customer_id,due,type,note,completed,result) VALUES(${[`${cid}-follow`, 'demo-store', cid, `2026-09-${String(24 + (i % 7)).padStart(2, '0')}`, ['适应回访', '听力复查', '清洁保养', '到店预约'][i % 4], '了解佩戴时长、舒适度，以及家庭交谈中的变化。'].map(q).join(',')},${i === 9 ? 1 : 0},${q(i === 9 ? '客户反馈佩戴舒适，继续观察噪声环境效果。' : '')});\n`;
  sql += `INSERT INTO audit(id,tenant_id,actor,action,customer_id) VALUES(${[`${cid}-audit`, 'demo-store', '验配师', '创建演示档案', cid].map(q).join(',')});\n`;
});
writeFileSync(new URL('../migrations/0002_demo_seed.sql', import.meta.url), sql);
