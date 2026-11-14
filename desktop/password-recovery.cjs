const crypto = require('node:crypto');
const QUESTIONS = Object.freeze([
  { id: 'birthday', label: '我的生日（例如 1990-01-01）' },
  { id: 'phone', label: '我常用的电话号码' },
  { id: 'id-last-four', label: '我的身份证后四位' },
  { id: 'teacher', label: '我的初中班主任姓名' },
  { id: 'father-phone', label: '我父亲的电话号码' },
  { id: 'mother-phone', label: '我母亲的电话号码' }
]);
const ITERATIONS = 210000;
const normalize = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN') : '';
const derive = (answer, salt) => crypto.pbkdf2Sync(normalize(answer), Buffer.from(salt, 'hex'), ITERATIONS, 32, 'sha256').toString('hex');
function valid(record) {
  return QUESTIONS.some(question => question.id === record?.question) && /^[a-f0-9]{32}$/.test(record?.salt) && /^[a-f0-9]{64}$/.test(record?.hash);
}
function create(question, answer) {
  if (!QUESTIONS.some(item => item.id === question) || !normalize(answer) || typeof answer !== 'string' || answer.length > 128) throw Error('请选择密保问题，并填写 1 至 128 个字符的答案');
  const salt = crypto.randomBytes(16).toString('hex');
  return { question, salt, hash: derive(answer, salt), iterations: ITERATIONS, failedAttempts: 0, retryAt: 0 };
}
function verify(record, answer, now = Date.now()) {
  if (!valid(record)) return { ok: false, error: '尚未设置密保问题，无法通过密保重置密码' };
  if (record.retryAt > now) return { ok: false, error: `回答次数过多，请 ${Math.ceil((record.retryAt - now) / 1000)} 秒后重试` };
  if (typeof answer !== 'string' || answer.length > 128 || !crypto.timingSafeEqual(Buffer.from(record.hash, 'hex'), Buffer.from(derive(answer, record.salt), 'hex'))) {
    record.failedAttempts = (record.failedAttempts || 0) + 1;
    if (record.failedAttempts >= 5) { record.failedAttempts = 0; record.retryAt = now + 30000; }
    return { ok: false, error: record.retryAt > now ? '回答次数过多，请 30 秒后重试' : '密保答案不正确' };
  }
  record.failedAttempts = 0; record.retryAt = 0;
  return { ok: true };
}
module.exports = { QUESTIONS, create, verify, valid };
