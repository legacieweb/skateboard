import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const env = {};
try {
  const source = await readFile(path.join(root, '.env'), 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !match[1].startsWith('#')) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;

const config = {
  port: Number(env.PORT || 4173),
  host: env.HOST || '127.0.0.1',
  baseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 4173}`).replace(/\/$/, ''),
  corsOrigin: env.CORS_ORIGIN || '',
  dbUrl: (env.IYONICDB_URL || 'https://api.iyonicorp.com/api/iyonicdb/v1').replace(/\/$/, ''),
  dbKey: env.IYONICDB_API_KEY || '',
  mailUrl: (env.IYONIC_MAILER_API_URL || 'https://api.iyonicorp.com/api/mailer/v1').replace(/\/$/, ''),
  mailKey: env.IYONIC_MAILER_API_KEY || '',
  mailFrom: env.MAIL_FROM_NAME || 'Roll Call',
  mailFromEmail: env.MAIL_FROM_EMAIL || env.ADMIN_EMAIL || '',
  paystackKey: env.PAYSTACK_SECRET_KEY || '',
  paystackPublicKey: env.PAYSTACK_PUBLIC_KEY || '',
  currency: (env.PAYSTACK_CURRENCY || 'USD').toUpperCase(),
  sessionDays: Math.min(30, Math.max(1, Number(env.SESSION_DAYS || 7))),
  adminBootstrapEnabled: env.ADMIN_BOOTSTRAP_ENABLED === 'true',
};

const requestWindows = new Map();
let inventoryQueue = Promise.resolve();
const KES_PER_USD = 130;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const hashToken = value => createHash('sha256').update(value).digest('hex');
const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
const isoNow = () => new Date().toISOString();
const dbHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${config.dbKey}` };

async function db(pathname, options = {}) {
  if (!config.dbKey) throw new HttpError(503, 'IyonicDB is not configured on this server.');
  const response = await fetch(`${config.dbUrl}${pathname}`, { ...options, headers: { ...dbHeaders, ...(options.headers || {}) } });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 300) }; }
  if (!response.ok) {
    const message = data.message || data.error || `IyonicDB request failed (${response.status}).`;
    if (response.status === 404) throw new HttpError(404, message);
    throw new HttpError(response.status >= 500 ? 502 : response.status, message);
  }
  return data;
}

function recordsFrom(data) {
  const list = Array.isArray(data) ? data : data.documents || data.rows || data.data || data.results || [];
  if (!Array.isArray(list)) return [];
  return list.map(item => {
    const value = item.document || item.row || item;
    if (!value || typeof value !== 'object') return null;
    return item !== value && (item.id || item.documentId) ? { ...value, _dbId: item.documentId || item.id } : value;
  }).filter(Boolean);
}
function recordId(item) { return item._dbId || item.documentId || item._id || item.id; }
async function listDocs(collection) { return recordsFrom(await db(`/documents/${encodeURIComponent(collection)}`)); }
async function saveDoc(collection, value) {
  const result = await db(`/documents/${encodeURIComponent(collection)}`, { method: 'POST', body: JSON.stringify({ document: value }) });
  const saved = result.document || result.data || result;
  return { ...saved, ...(result.id || result.documentId ? { _dbId: result.documentId || result.id } : {}) };
}
async function replaceDoc(collection, id, value) {
  const result = await db(`/documents/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ document: value }) });
  const saved = result.document || result.data || result;
  return { ...saved, ...(result.id || result.documentId ? { _dbId: result.documentId || result.id } : {}) };
}
async function patchDoc(collection, id, mutate) {
  const docs = await listDocs(collection);
  const current = docs.find(item => recordId(item) === id || item.id === id);
  if (!current) throw new HttpError(404, 'Record not found.');
  const updated = mutate({ ...current });
  await replaceDoc(collection, id, updated);
  return updated;
}

async function products() {
  const docs = await listDocs('products');
  return docs.filter(product => product.active !== false);
}
function safeUser(user) { const { passwordHash, passwordSalt, verificationTokenHash, verificationExpiresAt, resetTokenHash, _dbId, ...publicUser } = user; return publicUser; }
function publicProduct(product) { const { _dbId, ...value } = product; return value; }
function throttle(req, key, max = 8) {
  const now = Date.now(); const address = req.socket.remoteAddress || 'unknown'; const mapKey = `${key}:${address}`; const previous = requestWindows.get(mapKey) || { start: now, hits: 0 };
  if (now - previous.start > 15 * 60 * 1000) { previous.start = now; previous.hits = 0; }
  previous.hits += 1; requestWindows.set(mapKey, previous);
  if (previous.hits > max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
}
async function passwordHash(password, salt = token(16)) { const derived = await scrypt(password, salt, 64); return { salt, hash: Buffer.from(derived).toString('hex') }; }
async function verifyPassword(password, user) {
  const derived = Buffer.from(await scrypt(password, user.passwordSalt, 64));
  const stored = Buffer.from(user.passwordHash || '', 'hex');
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}
function cookieValue(header, name) { return header.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function cookieHeader(value, maxAge) { const crossSite = Boolean(config.corsOrigin && config.baseUrl.startsWith('https:')); return `rc_session=${value}; Path=/; HttpOnly; SameSite=${crossSite ? 'None' : 'Lax'}; Max-Age=${maxAge}${config.baseUrl.startsWith('https:') ? '; Secure' : ''}`; }
async function createSession(userId) {
  const sessionToken = token(); const expiresAt = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
  await saveDoc('sessions', { id: randomUUID(), userId, tokenHash: hashToken(sessionToken), expiresAt, createdAt: isoNow() });
  return sessionToken;
}
async function currentUser(req) {
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const sessionToken = bearer || cookieValue(req.headers.cookie || '', 'rc_session');
  if (!sessionToken) return null;
  const sessions = await listDocs('sessions');
  const session = sessions.find(item => item.tokenHash === hashToken(decodeURIComponent(sessionToken)) && item.expiresAt > isoNow());
  if (!session) return null;
  return (await listDocs('users')).find(item => item.id === session.userId && item.active !== false) || null;
}
async function requireUser(req) { const user = await currentUser(req); if (!user) throw new HttpError(401, 'Sign in to continue.'); return user; }
async function requireAdmin(req) { const user = await requireUser(req); if (user.role !== 'admin') throw new HttpError(403, 'Administrator access is required.'); return user; }

async function sendMail(to, subject, text, html) {
  const from = config.mailFromEmail ? `${config.mailFrom} <${config.mailFromEmail}>` : config.mailFrom;
  if (!config.mailKey) throw new HttpError(503, 'IyonicMailer is not configured on this server.');
  const response = await fetch(`${config.mailUrl}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': config.mailKey }, body: JSON.stringify({ to, from, subject, text, html }) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new HttpError(response.status >= 500 ? 502 : response.status, body.message || `IyonicMailer could not send this email (${response.status}).`);
  }
  return await response.json().catch(() => ({}));
}
async function verifyPaystack(reference) {
  if (!config.paystackKey) throw new HttpError(503, 'Paystack checkout is not configured on this server.');
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${config.paystackKey}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.status) throw new HttpError(502, result.message || 'Could not verify this payment.');
  return result.data;
}
async function markPaymentPaid(reference, payment) {
  const operation = inventoryQueue.then(() => markPaymentPaidLocked(reference, payment));
  inventoryQueue = operation.catch(() => {});
  return operation;
}
async function markPaymentPaidLocked(reference, payment) {
  const orders = await listDocs('orders');
  const order = orders.find(item => item.paymentReference === reference);
  if (!order) throw new HttpError(404, 'Order for this payment was not found.');
  if (order.status === 'paid' && order.stockCommitted) {
    return await sendOrderReceipt(order);
  }
  if (payment.status !== 'success' || Number(payment.amount) !== order.amountSubunit || payment.currency !== order.currency) throw new HttpError(402, 'Payment verification did not match this order.');
  let fulfillmentStatus = 'ready';
  const catalogue = await listDocs('products');
  const affectedProducts = order.items.map(line => ({ line, product: catalogue.find(item => item.id === line.productId) }));
  const stockLineKey = line => `${order.id}:${line.variantId || 'base'}`;
  const lineAlreadyApplied = (product, line) => (product.stockAppliedOrderLines || []).includes(stockLineKey(line)) || (!line.variantId && (product.stockAppliedOrders || []).includes(order.id));
  const variantForLine = (product, line) => line.variantId ? (product.variants || []).find(variant => variant.id === line.variantId) : null;
  if (affectedProducts.some(({ line, product }) => {
    if (!product) return true;
    const variant = variantForLine(product, line);
    const stock = variant ? (variant.stock ?? product.stock) : product.stock;
    return !variant && line.variantId || Number(stock) + (lineAlreadyApplied(product, line) ? line.quantity : 0) < line.quantity;
  })) fulfillmentStatus = 'stock_review';
  if (fulfillmentStatus === 'ready') {
    for (const { line, product } of affectedProducts) {
      if (lineAlreadyApplied(product, line)) continue;
      await patchDoc('products', recordId(product), current => {
        const variants = Array.isArray(current.variants) ? current.variants : [];
        if (line.variantId) return { ...current, variants: variants.map(variant => variant.id === line.variantId ? { ...variant, stock: Math.max(0, Number(variant.stock ?? current.stock ?? 0) - line.quantity) } : variant), stockAppliedOrderLines: [...(current.stockAppliedOrderLines || []), stockLineKey(line)], updatedAt: isoNow() };
        return { ...current, stock: Math.max(0, Number(current.stock || 0) - line.quantity), stockAppliedOrders: [...(current.stockAppliedOrders || []), order.id], updatedAt: isoNow() };
      });
    }
  }
  const updated = await patchDoc('orders', recordId(order), current => ({ ...current, status: 'paid', fulfillmentStatus, stockCommitted: true, paidAt: current.paidAt || isoNow(), paystackTransactionId: String(payment.id || current.paystackTransactionId || ''), receiptEmailStatus: current.receiptEmailStatus || 'pending', updatedAt: isoNow() }));
  return await sendOrderReceipt(updated);
}
async function sendOrderReceipt(order) {
  if (!order.email || order.receiptEmailStatus === 'sent') return order;
  if (order.receiptEmailStatus === 'sending' && Date.now() - Date.parse(order.receiptEmailAttemptAt || 0) < 5 * 60 * 1000) return order;
  const sending = await patchDoc('orders', recordId(order), current => ({ ...current, receiptEmailStatus: 'sending', receiptEmailAttemptAt: isoNow(), receiptEmailAttempts: Number(current.receiptEmailAttempts || 0) + 1, updatedAt: isoNow() }));
  const itemRows = sending.items.map(item => `<tr><td style="padding:10px 0;border-bottom:1px solid #e8e5dc">${escapeHtml(item.name)}${item.variantName ? ` · ${escapeHtml(item.variantName)}${item.variantOption && item.variantOption !== item.variantName ? ` / ${escapeHtml(item.variantOption)}` : ''}` : ''} × ${item.quantity}</td><td style="padding:10px 0;border-bottom:1px solid #e8e5dc;text-align:right">${escapeHtml(sending.currency)} ${(item.unitPrice * item.quantity).toFixed(2)}</td></tr>`).join('');
  const total = `${escapeHtml(sending.currency)} ${(sending.amountSubunit / 100).toFixed(2)}`;
  const text = `Roll Call order ${sending.orderNumber} is confirmed. Thanks, ${sending.name}. Items: ${sending.items.map(item => `${item.name}${item.variantName ? ` (${item.variantName}${item.variantOption && item.variantOption !== item.variantName ? ` / ${item.variantOption}` : ''})` : ''} x ${item.quantity}`).join(', ')}. Total: ${total}. We will email you when your order ships.`;
  const html = `<div style="margin:0;background:#f3f0e8;padding:32px 16px;font-family:Arial,sans-serif;color:#171916"><div style="max-width:600px;margin:auto;background:#fff;padding:32px;border-top:6px solid #ff5836"><p style="font-size:12px;letter-spacing:2px;color:#777">ROLL CALL · ORDER RECEIPT</p><h1 style="font-size:30px;margin:22px 0 8px">You’re good to roll.</h1><p>Thanks, ${escapeHtml(sending.name)}. Your payment is confirmed and our crew has your order.</p><p style="color:#666">ORDER NUMBER <strong style="color:#171916">${escapeHtml(sending.orderNumber)}</strong></p><table style="width:100%;border-collapse:collapse;margin:24px 0">${itemRows}<tr><td style="padding-top:16px;font-weight:bold">Total paid</td><td style="padding-top:16px;text-align:right;font-weight:bold">${total}</td></tr></table><p style="line-height:1.6;color:#555">We’ll send another email when your board is on its way. Questions? Reply to this email.</p><p style="font-size:11px;color:#888;margin-top:30px">ROLL CALL SKATE SHOP · MADE FOR THE NEXT SESSION</p></div></div>`;
  try {
    await sendMail(sending.email, `Roll Call order ${sending.orderNumber} is confirmed`, text, html);
    return await patchDoc('orders', recordId(sending), current => ({ ...current, receiptEmailStatus: 'sent', receiptEmailSentAt: isoNow(), receiptEmailError: null, updatedAt: isoNow() }));
  } catch (error) {
    const failed = await patchDoc('orders', recordId(sending), current => ({ ...current, receiptEmailStatus: 'failed', receiptEmailError: String(error.message || 'Email delivery failed').slice(0, 240), updatedAt: isoNow() })).catch(() => sending);
    console.error('Roll Call order receipt email could not be sent:', error.message);
    return failed;
  }
}
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
async function readBody(req, limit = 9 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
  const raw = Buffer.concat(chunks);
  try { return { raw, data: raw.length ? JSON.parse(raw.toString('utf8')) : {} }; } catch { throw new HttpError(400, 'Send a valid JSON request.'); }
}
function json(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(data)); }
function safeError(error) { return error instanceof HttpError ? error : new HttpError(502, 'A connected service is temporarily unavailable. Please try again.'); }

async function route(req, res) {
  const url = new URL(req.url, config.baseUrl);
  const method = req.method || 'GET';
  if (url.pathname.startsWith('/api/')) {
    const origin = req.headers.origin;
    const sameOrigin = origin && origin !== 'null' && origin === new URL(config.baseUrl).origin;
    const configuredOrigin = origin && config.corsOrigin && origin === config.corsOrigin;
    if (origin && !sameOrigin && !configuredOrigin) throw new HttpError(403, 'Request origin is not allowed.');
    if (configuredOrigin) {
      res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
  }
  if (method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, services: { database: Boolean(config.dbKey), mailer: Boolean(config.mailKey), paystack: Boolean(config.paystackKey && config.paystackPublicKey) } });
  if (method === 'GET' && url.pathname === '/api/products') return json(res, 200, { products: (await products()).map(publicProduct) });

  if (method === 'POST' && url.pathname === '/api/auth/register') {
    throttle(req, 'register', 5);
    const { data } = await readBody(req); const email = String(data.email || '').trim().toLowerCase(); const name = String(data.name || '').trim(); const password = String(data.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2 || password.length < 10) throw new HttpError(400, 'Enter your name, a valid email, and a password with at least 10 characters.');
    const users = await listDocs('users'); if (users.some(user => user.email === email)) throw new HttpError(409, 'An account with this email already exists.');
    const credentials = await passwordHash(password); const verifyToken = token();
    const user = { id: randomUUID(), name, email, role: 'user', active: true, emailVerified: false, passwordSalt: credentials.salt, passwordHash: credentials.hash, verificationTokenHash: hashToken(verifyToken), verificationExpiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: isoNow(), updatedAt: isoNow() };
    await saveDoc('users', user);
    const link = `${config.baseUrl}/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
    let emailSent = true;
    try { await sendMail(email, 'Welcome to Roll Call · Verify your email', `Hi ${name}, welcome to Roll Call. Verify your email to finish setting up your account: ${link}`, `<div style="margin:0;background:#f3f0e8;padding:32px 16px;font-family:Arial,sans-serif;color:#171916"><div style="max-width:560px;margin:auto;background:#fff;padding:32px;border-top:6px solid #ff5836"><p style="font-size:12px;letter-spacing:2px;color:#777">ROLL CALL · ACCOUNT</p><h1>Welcome to the crew, ${escapeHtml(name)}.</h1><p>One quick step and your account is ready for the next session.</p><p style="margin:28px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#171916;color:#fff;text-decoration:none;padding:15px 20px;font-weight:bold">VERIFY MY EMAIL</a></p><p style="font-size:12px;color:#777">If you didn’t create a Roll Call account, you can ignore this message.</p></div></div>`); }
    catch { emailSent = false; }
    return json(res, 201, { message: emailSent ? 'Your account is created. Check your inbox for the verification link.' : 'Your account is created and ready to use. The verification email could not be sent, so email verification and password recovery will be unavailable until delivery is restored.' });
  }
  if (method === 'GET' && url.pathname === '/api/auth/verify-email') {
    const given = url.searchParams.get('token') || ''; const users = await listDocs('users'); const user = users.find(item => item.verificationTokenHash === hashToken(given));
    if (!user || !user.verificationExpiresAt || user.verificationExpiresAt < isoNow()) throw new HttpError(400, 'This verification link is invalid or has expired.');
    await patchDoc('users', recordId(user), current => ({ ...current, emailVerified: true, verificationTokenHash: null, verificationExpiresAt: null, verifiedAt: isoNow(), updatedAt: isoNow() }));
    res.writeHead(302, { Location: `${config.baseUrl}/#account?verified=1`, 'Cache-Control': 'no-store' }); return res.end();
  }
  if (method === 'POST' && url.pathname === '/api/auth/resend-verification') {
    throttle(req, 'resend-verification', 3);
    const { data } = await readBody(req); const email = String(data.email || '').trim().toLowerCase();
    if (/^\S+@\S+\.\S+$/.test(email)) {
      const user = (await listDocs('users')).find(item => item.email === email && item.active !== false && !item.emailVerified);
      if (user) {
        const verifyToken = token();
        await patchDoc('users', recordId(user), current => ({ ...current, verificationTokenHash: hashToken(verifyToken), verificationExpiresAt: new Date(Date.now() + 86400000).toISOString(), updatedAt: isoNow() }));
        const link = `${config.baseUrl}/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
        await sendMail(email, 'Verify your Roll Call account', `Verify your account: ${link}`, `<h1>Finish setting up your Roll Call account.</h1><p><a href="${escapeHtml(link)}">Verify your email</a> to sign in.</p>`);
      }
    }
    return json(res, 202, { message: 'If your account needs verification, a fresh link is on its way.' });
  }
  if (method === 'POST' && url.pathname === '/api/auth/request-password-reset') {
    throttle(req, 'password-reset', 3);
    const { data } = await readBody(req); const email = String(data.email || '').trim().toLowerCase();
    if (/^\S+@\S+\.\S+$/.test(email)) {
      const user = (await listDocs('users')).find(item => item.email === email && item.active !== false);
      if (user) {
        const resetToken = token();
        await patchDoc('users', recordId(user), current => ({ ...current, resetTokenHash: hashToken(resetToken), resetExpiresAt: new Date(Date.now() + 3600000).toISOString(), updatedAt: isoNow() }));
        const link = `${config.baseUrl}/#reset-password?token=${encodeURIComponent(resetToken)}`;
        await sendMail(email, 'Reset your Roll Call password', `Choose a new password within one hour: ${link}`, `<h1>Reset your password.</h1><p><a href="${escapeHtml(link)}">Choose a new password</a>. This link expires in one hour.</p>`).catch(error => console.error('Password reset email could not be sent:', error.message));
      }
    }
    return json(res, 202, { message: 'If an account matches that email, a password reset link is on its way.' });
  }
  if (method === 'POST' && url.pathname === '/api/auth/reset-password') {
    throttle(req, 'password-reset-complete', 8);
    const { data } = await readBody(req); const resetToken = String(data.token || ''); const password = String(data.password || '');
    if (password.length < 10) throw new HttpError(400, 'Choose a password with at least 10 characters.');
    const user = (await listDocs('users')).find(item => item.resetTokenHash === hashToken(resetToken) && item.resetExpiresAt > isoNow() && item.active !== false);
    if (!user) throw new HttpError(400, 'This password reset link is invalid or has expired. Request a new one and try again.');
    const credentials = await passwordHash(password);
    await patchDoc('users', recordId(user), current => ({ ...current, passwordSalt: credentials.salt, passwordHash: credentials.hash, emailVerified: true, verificationTokenHash: null, verificationExpiresAt: null, resetTokenHash: null, resetExpiresAt: null, passwordChangedAt: isoNow(), updatedAt: isoNow() }));
    const sessions = await listDocs('sessions').catch(() => []);
    await Promise.all(sessions.filter(session => session.userId === user.id).map(session => db(`/documents/sessions/${encodeURIComponent(recordId(session))}`, { method: 'DELETE' }).catch(() => {})));
    return json(res, 200, { message: 'Password updated. Sign in with your new password.' });
  }
  if (method === 'POST' && url.pathname === '/api/auth/login') {
    throttle(req, 'login', 10);
    const { data } = await readBody(req); const email = String(data.email || '').trim().toLowerCase(); const password = String(data.password || '');
    const user = (await listDocs('users')).find(item => item.email === email && item.active !== false);
    if (!user || !(await verifyPassword(password, user))) throw new HttpError(401, 'Email or password is incorrect.');
    const sessionToken = await createSession(user.id);
    const signedInAt = new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
    let loginEmailSent = false;
    try {
      await sendMail(user.email, 'New sign-in to your Roll Call account', `Hi ${user.name}, a sign-in to your Roll Call account was completed on ${signedInAt} (East Africa Time). If this was you, no action is needed. If you don’t recognize this sign-in, reset your password and contact the shop team.`, `<div style="margin:0;background:#f3f0e8;padding:32px 16px;font-family:Arial,sans-serif;color:#171916"><div style="max-width:560px;margin:auto;background:#fff;padding:32px;border-top:6px solid #ff5836"><p style="font-size:12px;letter-spacing:2px;color:#777">ROLL CALL · SECURITY</p><h1 style="font-size:28px">New account sign-in</h1><p>Hi ${escapeHtml(user.name)}, your Roll Call account was signed in at <strong>${escapeHtml(signedInAt)} EAT</strong>.</p><p>If this was you, no action is needed. If you don’t recognize this sign-in, reset your password and contact the shop team.</p></div></div>`);
      loginEmailSent = true;
    } catch (error) { console.error('Login activity email could not be sent:', error.message); }
    return json(res, 200, { user: safeUser(user), loginEmailSent, ...(!loginEmailSent ? { loginEmailNotice: 'You are signed in, but we could not send the sign-in alert email.' } : {}), ...(req.headers.origin === 'null' && config.corsOrigin === 'null' ? { sessionToken } : {}) }, { 'Set-Cookie': cookieHeader(sessionToken, config.sessionDays * 86400) });
  }
  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    const sessionToken = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || cookieValue(req.headers.cookie || '', 'rc_session');
    if (sessionToken) { const sessions = await listDocs('sessions'); const session = sessions.find(item => item.tokenHash === hashToken(decodeURIComponent(sessionToken))); if (session) await db(`/documents/sessions/${encodeURIComponent(recordId(session))}`, { method: 'DELETE' }).catch(() => {}); }
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
  }
  if (method === 'GET' && url.pathname === '/api/auth/me') { const user = await currentUser(req); return json(res, 200, { user: user ? safeUser(user) : null }); }
  if (method === 'PATCH' && url.pathname === '/api/account/profile') {
    const user = await requireUser(req); const { data } = await readBody(req);
    const name = String(data.name || '').trim().slice(0, 100);
    const profile = {
      phone: String(data.phone || '').trim().slice(0, 32),
      address: String(data.address || '').trim().slice(0, 200),
      city: String(data.city || '').trim().slice(0, 100),
      region: String(data.region || '').trim().slice(0, 100),
      postalCode: String(data.postalCode || '').trim().slice(0, 30),
      country: String(data.country || '').trim().slice(0, 100),
    };
    if (name.length < 2) throw new HttpError(400, 'Enter your full name.');
    if (profile.phone && profile.phone.length < 7) throw new HttpError(400, 'Enter a phone number with at least 7 characters.');
    await patchDoc('users', recordId(user), current => ({ ...current, name, profile, updatedAt: isoNow() }));
    const updatedUser = (await listDocs('users')).find(item => item.id === user.id);
    return json(res, 200, { user: safeUser(updatedUser) });
  }
  if (method === 'GET' && url.pathname === '/api/account/orders') { const user = await requireUser(req); const orders = (await listDocs('orders')).filter(order => order.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); return json(res, 200, { orders }); }

  if (method === 'POST' && url.pathname === '/api/checkout/initialize') {
    const user = await currentUser(req); if (!config.paystackKey || !config.paystackPublicKey) throw new HttpError(503, 'Paystack popup keys are not configured on this server.');
    const { data } = await readBody(req); const requested = Array.isArray(data.items) ? data.items : []; const shippingInput = data.shipping || {};
    const currency = String(data.currency || config.currency).toUpperCase();
    if (!['USD', 'KES'].includes(currency)) throw new HttpError(400, 'Choose USD or KES for payment.');
    const email = String(data.email || user?.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter a valid email address so we can send your receipt and delivery updates.');
    const shipping = {
      name: String(shippingInput.name || data.name || user?.name || '').trim().slice(0, 100), phone: String(shippingInput.phone || '').trim().slice(0, 32),
      address: String(shippingInput.address || '').trim().slice(0, 200), city: String(shippingInput.city || '').trim().slice(0, 100),
      region: String(shippingInput.region || '').trim().slice(0, 100), postalCode: String(shippingInput.postalCode || '').trim().slice(0, 30),
      country: String(shippingInput.country || '').trim().slice(0, 100),
    };
    if (shipping.name.length < 2 || shipping.phone.length < 7 || shipping.address.length < 5 || shipping.city.length < 2 || shipping.region.length < 2 || shipping.postalCode.length < 2 || shipping.country.length < 2) throw new HttpError(400, 'Complete every delivery address field before continuing.');
    if (!requested.length || requested.length > 25) throw new HttpError(400, 'Your bag is empty or too large.');
    const catalogue = await products(); const lines = [];
    for (const requestedItem of requested) {
      const product = catalogue.find(item => item.id === requestedItem.id && item.active !== false); const quantity = Math.floor(Number(requestedItem.quantity));
      if (!product || quantity < 1 || quantity > 10) throw new HttpError(400, 'One of the items in your bag is unavailable.');
      const shippingCountries = Array.isArray(product.shippingCountries) ? product.shippingCountries : [];
      if (shippingCountries.length && !shippingCountries.some(country => String(country).trim().toLocaleLowerCase() === shipping.country.toLocaleLowerCase())) throw new HttpError(400, `${product.name} can’t be shipped to ${shipping.country}. Choose a country allowed for every item in your bag.`);
      const variant = requestedItem.variantId ? (product.variants || []).find(item => item.id === requestedItem.variantId) : null;
      if ((product.variants || []).length && !variant) throw new HttpError(400, `Choose an available variant of ${product.name}.`);
      const stock = variant ? (variant.stock ?? product.stock) : product.stock;
      if (Number(stock) < quantity) throw new HttpError(409, `${product.name}${variant ? ` (${variant.name})` : ''} does not have enough stock available.`);
      const unitPriceUsd = Number(variant?.price ?? product.price);
      const unitPrice = currency === 'KES' ? Math.round(unitPriceUsd * KES_PER_USD * 100) / 100 : unitPriceUsd;
      const lineKey = `${product.id}:${variant?.id || 'base'}`;
      const found = lines.find(line => `${line.productId}:${line.variantId || 'base'}` === lineKey);
      if (found) found.quantity += quantity; else lines.push({ productId: product.id, ...(variant ? { variantId: variant.id, variantName: variant.name, variantOption: variant.option } : {}), name: product.name, shippingTime: product.shippingTime || '', unitPrice, unitPriceUsd, quantity });
      if (lines.find(line => `${line.productId}:${line.variantId || 'base'}` === lineKey).quantity > 10) throw new HttpError(400, 'You can order up to 10 of each item at a time.');
    }
    const subtotalUsd = lines.reduce((sum, line) => sum + line.unitPriceUsd * line.quantity, 0);
    const subtotalSubunit = Math.round(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0) * 100);
    const shippingUsd = subtotalUsd >= 100 ? 0 : 8;
    const shippingSubunit = Math.round((currency === 'KES' ? shippingUsd * KES_PER_USD : shippingUsd) * 100);
    const amountSubunit = subtotalSubunit + shippingSubunit;
    const orderId = randomUUID(); const orderNumber = `RC-${Date.now().toString(36).toUpperCase()}`; const reference = `rc_${randomBytes(16).toString('hex')}`;
    const order = { id: orderId, orderNumber, userId: user?.id || null, guestCheckout: !user, email, name: shipping.name, phone: shipping.phone, shippingAddress: shipping, items: lines, subtotalSubunit, shippingSubunit, amountSubunit, currency, conversionRate: currency === 'KES' ? KES_PER_USD : null, status: 'pending', paymentReference: reference, receiptEmailStatus: 'pending', createdAt: isoNow(), updatedAt: isoNow() };
    await saveDoc('orders', order);
    return json(res, 200, { publicKey: config.paystackPublicKey, email, phone: shipping.phone, firstName: shipping.name.split(/\s+/)[0], amount: amountSubunit, currency, reference, orderNumber, metadata: { order_id: orderId, order_number: orderNumber } });
  }
  if (method === 'GET' && url.pathname === '/api/payments/callback') {
    const reference = url.searchParams.get('reference') || ''; if (!reference) throw new HttpError(400, 'Payment reference is missing.');
    const payment = await verifyPaystack(reference); const order = await markPaymentPaid(reference, payment);
    res.writeHead(302, { Location: `${config.baseUrl}/#payment?reference=${encodeURIComponent(reference)}&order=${encodeURIComponent(order.orderNumber)}`, 'Cache-Control': 'no-store' }); return res.end();
  }
  if (method === 'POST' && url.pathname === '/api/payments/webhook') {
    const { raw, data } = await readBody(req); const signature = req.headers['x-paystack-signature'];
    if (!config.paystackKey || typeof signature !== 'string') throw new HttpError(401, 'Webhook signature is missing.');
    const expected = createHmac('sha512', config.paystackKey).update(raw).digest('hex');
    const actual = Buffer.from(signature, 'hex'); const digest = Buffer.from(expected, 'hex');
    if (actual.length !== digest.length || !timingSafeEqual(actual, digest)) throw new HttpError(401, 'Webhook signature is invalid.');
    if (data.event === 'charge.success' && data.data?.reference) await markPaymentPaid(data.data.reference, data.data);
    return json(res, 200, { received: true });
  }
  if (method === 'POST' && url.pathname === '/api/payments/verify') {
    const { data } = await readBody(req); const reference = String(data.reference || '').trim();
    if (!/^rc_[a-f0-9]{32}$/.test(reference)) throw new HttpError(400, 'Payment reference is invalid.');
    const payment = await verifyPaystack(reference); const order = await markPaymentPaid(reference, payment);
    return json(res, 200, { order: { id: order.id, orderNumber: order.orderNumber, status: order.status, items: order.items.map(({ name, quantity }) => ({ name, quantity })), amountSubunit: order.amountSubunit, currency: order.currency, email: order.email, receiptEmailStatus: order.receiptEmailStatus } });
  }

  if (url.pathname.startsWith('/api/admin/')) {
    await requireAdmin(req);
    if (method === 'GET' && url.pathname === '/api/admin/summary') {
      const [users, orders, catalog] = await Promise.all([listDocs('users'), listDocs('orders'), listDocs('products')]);
      const paid = orders.filter(order => order.status === 'paid');
      const revenueByCurrency = paid.reduce((totals, order) => { const currency = order.currency === 'KES' ? 'KES' : 'USD'; totals[currency] += Number(order.amountSubunit || 0); return totals; }, { USD: 0, KES: 0 });
      return json(res, 200, { users: users.filter(user => user.role !== 'admin').length, orders: orders.length, pending: orders.filter(order => order.status === 'pending').length, revenueByCurrency, products: catalog.length });
    }
    if (method === 'GET' && url.pathname === '/api/admin/orders') return json(res, 200, { orders: (await listDocs('orders')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    if (method === 'GET' && url.pathname === '/api/admin/users') return json(res, 200, { users: (await listDocs('users')).map(safeUser).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    if (method === 'GET' && url.pathname === '/api/admin/products') return json(res, 200, { products: await listDocs('products') });
    const orderMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (method === 'PATCH' && orderMatch) {
      const { data } = await readBody(req); const allowed = ['processing', 'shipped', 'delivered', 'cancelled']; if (!allowed.includes(data.status)) throw new HttpError(400, 'Choose a valid order status.');
      const order = await patchDoc('orders', decodeURIComponent(orderMatch[1]), current => ({ ...current, status: data.status, updatedAt: isoNow() })); return json(res, 200, { order });
    }
    if (method === 'POST' && url.pathname === '/api/admin/products') {
      const { data } = await readBody(req); const fields = validateProduct(data); const product = { ...fields, id: String(data.id || randomUUID()), active: data.active !== false, createdAt: isoNow(), updatedAt: isoNow() };
      if ((await listDocs('products')).some(item => item.id === product.id)) throw new HttpError(409, 'A product with that ID already exists.');
      await saveDoc('products', product); return json(res, 201, { product });
    }
    const productMatch = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (method === 'PATCH' && productMatch) {
      const id = decodeURIComponent(productMatch[1]); const { data } = await readBody(req);
      const product = await patchDoc('products', id, current => ({ ...current, ...validateProduct({ ...current, ...data }), active: data.active === undefined ? current.active : Boolean(data.active), updatedAt: isoNow() })); return json(res, 200, { product });
    }
    if (method === 'DELETE' && productMatch) {
      const id = decodeURIComponent(productMatch[1]);
      const products = await listDocs('products');
      const product = products.find(item => recordId(item) === id || item.id === id);
      if (!product) throw new HttpError(404, 'Product not found.');
      await db(`/documents/products/${encodeURIComponent(recordId(product))}`, { method: 'DELETE' });
      return json(res, 200, { deleted: true, id: product.id });
    }
    throw new HttpError(404, 'Admin endpoint not found.');
  }
  throw new HttpError(404, 'API endpoint not found.');
}
function validateProduct(data) {
  const name = String(data.name || '').trim(); const price = Number(data.price); const stock = Math.floor(Number(data.stock)); const image = String(data.image || '').trim();
  const validMedia = value => typeof value === 'string' && (value.length <= 7 * 1024 * 1024 && (/^https:\/\//i.test(value) || /^data:(image\/(?:jpeg|png|webp|gif|avif)|video\/(?:mp4|webm|ogg));base64,/i.test(value)));
  const media = Array.isArray(data.media) ? data.media.map(item => {
    if (!item || !['image', 'video'].includes(item.type) || !validMedia(item.src)) throw new HttpError(400, 'Each media item must be an HTTPS URL or a supported image/video file under 7 MB.');
    if (item.type === 'image' && /^data:video\//i.test(item.src) || item.type === 'video' && /^data:image\//i.test(item.src)) throw new HttpError(400, 'Media type must match its uploaded file.');
    return { type: item.type, src: item.src, name: String(item.name || '').slice(0, 180) };
  }) : [];
  const primaryImage = image || media.find(item => item.type === 'image')?.src || '';
  if (name.length < 2 || !Number.isFinite(price) || price < 1 || price > 100000 || !Number.isFinite(stock) || stock < 0 || stock > 100000 || !validMedia(primaryImage) || /^data:video\//i.test(primaryImage)) throw new HttpError(400, 'Add a product name, valid price, stock quantity, and HTTPS image or uploaded image file.');
  if (media.reduce((sum, item) => sum + item.src.length, 0) > 7 * 1024 * 1024) throw new HttpError(413, 'Combined product media must be under 7 MB.');
  const features = Array.isArray(data.features) ? data.features.map(item => String(item || '').trim()).filter(Boolean) : [];
  if (features.some(feature => feature.length > 120)) throw new HttpError(400, 'Keep each product feature to 120 characters or fewer.');
  const shippingCountries = (Array.isArray(data.shippingCountries) ? data.shippingCountries : String(data.shippingCountries || '').split(/[\n,]/)).map(country => String(country || '').trim().slice(0, 80)).filter(Boolean);
  if (shippingCountries.length > 80) throw new HttpError(400, 'Limit shipping destinations to 80 countries per product.');
  const uniqueShippingCountries = [...new Map(shippingCountries.map(country => [country.toLocaleLowerCase(), country])).values()];
  const variants = Array.isArray(data.variants) ? data.variants.slice(0, 40).map((item, index) => {
    const variantPrice = item.price === '' || item.price === null || item.price === undefined ? null : Number(item.price);
    const variantStock = item.stock === '' || item.stock === null || item.stock === undefined ? null : Math.floor(Number(item.stock));
    const requestedMediaIndex = item.mediaIndex === '' || item.mediaIndex === null || item.mediaIndex === undefined ? null : Number(item.mediaIndex);
    const mediaIndex = requestedMediaIndex === -1 ? null : requestedMediaIndex;
    if (!String(item.name || '').trim() || variantPrice !== null && (!Number.isFinite(variantPrice) || variantPrice < 1 || variantPrice > 100000) || variantStock !== null && (!Number.isFinite(variantStock) || variantStock < 0 || variantStock > 100000) || mediaIndex !== null && (!Number.isInteger(mediaIndex) || mediaIndex < 0 || mediaIndex >= media.length || media[mediaIndex]?.type !== 'image')) throw new HttpError(400, `Variant ${index + 1} has invalid name, price, stock, or image selection.`);
    const variantName = String(item.name).trim().slice(0, 100);
    return { id: String(item.id || randomUUID()).slice(0, 80), name: variantName, option: variantName, price: variantPrice, stock: variantStock, mediaIndex };
  }) : [];
  return { name, price, stock, image: primaryImage, media, variants, features, shippingCountries: uniqueShippingCountries, shippingTime: String(data.shippingTime || '').trim().slice(0, 100), description: String(data.description || '').trim(), details: String(data.details || data.description || '').trim(), category: String(data.category || 'SKATEBOARD').trim().slice(0, 80), badge: String(data.badge || 'NEW ARRIVAL').trim().slice(0, 80), rating: String(data.rating || 'NEW').slice(0, 40) };
}

async function bootstrapAdmin() {
  if (!config.dbKey || !config.adminBootstrapEnabled || !env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return;
  if (env.ADMIN_PASSWORD.length < 14) throw new Error('ADMIN_PASSWORD must contain at least 14 characters.');
  const email = env.ADMIN_EMAIL.trim().toLowerCase(); const users = await listDocs('users'); const existing = users.find(item => item.email === email);
  if (existing) {
    const credentials = await passwordHash(env.ADMIN_PASSWORD);
    await patchDoc('users', recordId(existing), user => ({ ...user, role: 'admin', emailVerified: true, passwordSalt: credentials.salt, passwordHash: credentials.hash, updatedAt: isoNow() }));
    return;
  }
  const credentials = await passwordHash(env.ADMIN_PASSWORD);
  await saveDoc('users', { id: randomUUID(), name: 'Roll Call Admin', email, role: 'admin', active: true, emailVerified: true, passwordSalt: credentials.salt, passwordHash: credentials.hash, createdAt: isoNow(), updatedAt: isoNow() });
}

const server = http.createServer(async (req, res) => {
  try {
    if ((req.url || '').startsWith('/api/')) return await route(req, res);
    throw new HttpError(404, 'This service provides the Roll Call API only. Serve index.html and its assets from your static site host.');
  } catch (error) {
    const failure = safeError(error); if (!(error instanceof HttpError)) console.error('Request failed:', error.message);
    if (!res.headersSent) json(res, failure.status, { error: failure.message }); else res.end();
  }
});

try { await bootstrapAdmin(); } catch (error) { console.error('IyonicDB startup setup is pending:', error.message); }
server.listen(config.port, config.host, () => console.log(`Roll Call is running at ${config.baseUrl}`));
