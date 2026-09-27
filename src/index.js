const USER_COOKIE = "__Host-lkb_user";
const ADMIN_COOKIE = "__Host-lkb_admin";
const ADMIN_NAME = "LKB Media Music";
const PLAN_MONTHS = { "1m": 1, "3m": 3, "6m": 6, lifetime: null };
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
let cachedCipherKeyText = "";
let cachedCipherKeyPromise = null;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/api/license/activate") return await activateLicense(request, env);
      if (path === "/api/license/logout") return await logoutLicense(request, env);
      if (path === "/api/session") return await getUserSession(request, env);
      if (path === "/api/admin/auth") return await adminAuth(request, env);
      if (path === "/api/admin/keys") return await adminKeys(request, env);
      if (path === "/app") return await protectedApp(request, env);
      if (path === "/lkb-media-console") return await adminPage(request, env);

      if (path === "/player-internal.html" || path === "/admin-internal.html") {
        return secure(new Response("Không tìm thấy trang.", { status: 404 }));
      }

      return secure(await env.ASSETS.fetch(request));
    } catch (error) {
      return json({ error: "Có lỗi máy chủ. Vui lòng thử lại sau." }, 500);
    }
  }
};

function secure(response, noStore = false) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (noStore) headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function json(data, status = 200, headers = {}) {
  return secure(new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  }), true);
}

function cookie(name, value, maxAge) {
  return name + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}

function clearCookie(name) {
  return name + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

function readCookie(request, name) {
  const source = request.headers.get("Cookie") || "";
  for (const item of source.split(";")) {
    const part = item.trim();
    const split = part.indexOf("=");
    if (split > 0 && part.slice(0, split) === name) return part.slice(split + 1);
  }
  return "";
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 100000) throw new Error("Dữ liệu gửi lên quá lớn.");
  return await request.json();
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(value) {
  const input = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeCode(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (!compact.startsWith("LKB") || compact.length !== 29) return "";
  return "LKB-" + compact.slice(3);
}

function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let buffer = 0;
  let bits = 0;
  let code = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      code += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) code += BASE32[(buffer << (5 - bits)) & 31];
  return "LKB-" + code;
}

async function getCipherKey(env) {
  const value = String(env.KEY_ENCRYPTION_KEY || "");
  if (!value) throw new Error("Thiếu KEY_ENCRYPTION_KEY.");
  if (value !== cachedCipherKeyText) {
    const raw = base64ToBytes(value);
    if (raw.length !== 32) throw new Error("KEY_ENCRYPTION_KEY phải giải mã thành 32 byte.");
    cachedCipherKeyText = value;
    cachedCipherKeyPromise = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  return await cachedCipherKeyPromise;
}

async function encryptCode(code, env) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await getCipherKey(env);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(code));
  return bytesToBase64(nonce) + "." + bytesToBase64(new Uint8Array(encrypted));
}

async function decryptCode(value, env) {
  const pieces = String(value || "").split(".");
  if (pieces.length !== 2) throw new Error("Mã khóa lưu trữ không hợp lệ.");
  const key = await getCipherKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(pieces[0]) },
    key,
    base64ToBytes(pieces[1])
  );
  return new TextDecoder().decode(plain);
}

function addCalendarMonths(timestamp, months) {
  const start = new Date(timestamp);
  const day = start.getUTCDate();
  const targetYear = start.getUTCFullYear();
  const targetMonth = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return Date.UTC(
    targetYear,
    targetMonth,
    Math.min(day, lastDay),
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds()
  );
}

async function userSession(request, env) {
  const token = readCookie(request, USER_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT s.license_id, s.expires_at AS session_expires_at, l.plan, l.expires_at AS license_expires_at, l.revoked_at " +
    "FROM user_sessions s JOIN licenses l ON l.id = s.license_id " +
    "WHERE s.token_hash = ? AND s.expires_at > ? AND l.revoked_at IS NULL"
  ).bind(tokenHash, now).first();
  if (!row || (row.license_expires_at !== null && row.license_expires_at <= now)) return null;
  return row;
}

async function adminSession(request, env) {
  const token = readCookie(request, ADMIN_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  return await env.DB.prepare(
    "SELECT token_hash, expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ?"
  ).bind(tokenHash, now).first();
}

async function activateLicense(request, env) {
  if (request.method !== "POST") return json({ error: "Phương thức không được hỗ trợ." }, 405);
  if (!sameOrigin(request)) return json({ error: "Yêu cầu không hợp lệ." }, 403);
  let body;
  try { body = await readJson(request); }
  catch { return json({ error: "Dữ liệu gửi lên không hợp lệ." }, 400); }
  const code = normalizeCode(body.code);
  if (!code) return json({ error: "Mã key không đúng định dạng." }, 400);

  const codeHash = await sha256Hex(code);
  const row = await env.DB.prepare(
    "SELECT id, plan, activated_at, expires_at, revoked_at FROM licenses WHERE code_hash = ?"
  ).bind(codeHash).first();
  if (!row) return json({ error: "Mã key không tồn tại hoặc đã bị khóa." }, 403);
  if (row.revoked_at !== null) return json({ error: "Mã key đã bị quản trị viên thu hồi." }, 403);

  const now = Date.now();
  if (row.activated_at === null) {
    const months = PLAN_MONTHS[row.plan];
    const expiresAt = months === null ? null : addCalendarMonths(now, months);
    await env.DB.prepare(
      "UPDATE licenses SET activated_at = ?, expires_at = ? WHERE id = ? AND activated_at IS NULL"
    ).bind(now, expiresAt, row.id).run();
    row.activated_at = now;
    row.expires_at = expiresAt;
  }
  if (row.expires_at !== null && row.expires_at <= now) {
    return json({ error: "Mã key đã hết hạn." }, 403);
  }

  await env.DB.prepare("DELETE FROM user_sessions WHERE license_id = ?").bind(row.id).run();
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const sessionAgeMs = Math.min(30 * 24 * 60 * 60 * 1000, row.expires_at === null ? Infinity : row.expires_at - now);
  const sessionExpires = now + sessionAgeMs;
  await env.DB.prepare(
    "INSERT INTO user_sessions(token_hash, license_id, created_at, expires_at) VALUES(?, ?, ?, ?)"
  ).bind(tokenHash, row.id, now, sessionExpires).run();

  const maxAge = Math.max(1, Math.floor(sessionAgeMs / 1000));
  return json(
    { ok: true, plan: row.plan, expiresAt: row.expires_at },
    200,
    { "Set-Cookie": cookie(USER_COOKIE, token, maxAge) }
  );
}

async function getUserSession(request, env) {
  const session = await userSession(request, env);
  if (!session) return json({ ok: false }, 401, { "Set-Cookie": clearCookie(USER_COOKIE) });
  return json({ ok: true, plan: session.plan, expiresAt: session.license_expires_at });
}

async function logoutLicense(request, env) {
  if (request.method !== "POST") return json({ error: "Phương thức không được hỗ trợ." }, 405);
  if (!sameOrigin(request)) return json({ error: "Yêu cầu không hợp lệ." }, 403);
  const token = readCookie(request, USER_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(USER_COOKIE) });
}

async function protectedApp(request, env) {
  if (!await userSession(request, env)) {
    return secure(new Response(null, { status: 302, headers: { Location: "/" } }), true);
  }
  const asset = await env.ASSETS.fetch(new URL("/player-internal.html", request.url));
  if (!asset.ok) return secure(new Response("Không tải được ứng dụng.", { status: 503 }));
  const html = await asset.text();
  const guard =
    "<script>(function(){document.documentElement.style.visibility='hidden';async function check(){try{" +
    "var r=await fetch('/api/session',{cache:'no-store',credentials:'same-origin'});if(!r.ok){location.replace('/');return;}" +
    "var d=await r.json();var slot=document.getElementById('lkbLicenseStatus');" +
    "if(slot){slot.textContent=d.expiresAt?'🔑 Hạn '+new Date(d.expiresAt).toLocaleDateString('vi-VN'):'🔑 Vĩnh viễn';}" +
    "document.documentElement.style.visibility='visible';}catch(e){location.replace('/');}}" +
    "function addAccountTools(){var bar=document.querySelector('.header-actions');if(!bar||document.getElementById('lkbLicenseStatus'))return;" +
    "var status=document.createElement('span');status.id='lkbLicenseStatus';status.className='mono';status.style.cssText='font-size:11px;color:var(--accent)';bar.appendChild(status);" +
    "var out=document.createElement('button');out.className='small ghost';out.textContent='🔒 Thoát key';" +
    "out.addEventListener('click',async function(){out.disabled=true;try{await fetch('/api/license/logout',{method:'POST',credentials:'same-origin'});}finally{location.replace('/');}});bar.appendChild(out);}" +
    "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addAccountTools,{once:true});else addAccountTools();" +
    "check();setInterval(check,180000);})();</script>";
  const protectedHtml = html.replace("</head>", guard + "</head>");
  return secure(new Response(protectedHtml, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  }), true);
}

async function adminPage(request, env) {
  const asset = await env.ASSETS.fetch(new URL("/admin-internal.html", request.url));
  if (!asset.ok) return secure(new Response("Không tải được trang quản trị.", { status: 503 }));
  return secure(new Response(asset.body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  }), true);
}

async function adminAuth(request, env) {
  if (request.method === "GET") {
    const session = await adminSession(request, env);
    return json({ ok: !!session, account: ADMIN_NAME }, session ? 200 : 401);
  }
  if (request.method !== "POST") return json({ error: "Phương thức không được hỗ trợ." }, 405);
  if (!sameOrigin(request)) return json({ error: "Yêu cầu không hợp lệ." }, 403);

  let body;
  try { body = await readJson(request); }
  catch { return json({ error: "Dữ liệu gửi lên không hợp lệ." }, 400); }

  if (body.action === "logout") {
    const token = readCookie(request, ADMIN_COOKIE);
    if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(ADMIN_COOKIE) });
  }

  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const ipHash = await sha256Hex(ip + "|" + String(env.ADMIN_PASSWORD || ""));
  const attempt = await env.DB.prepare("SELECT attempts, window_started_at FROM login_attempts WHERE ip_hash = ?")
    .bind(ipHash).first();
  const windowMs = 15 * 60 * 1000;
  if (attempt && now - attempt.window_started_at < windowMs && attempt.attempts >= 5) {
    return json({ error: "Đăng nhập tạm khóa 15 phút do thử sai nhiều lần." }, 429);
  }

  const validUser = String(body.username || "").trim().toLocaleLowerCase("vi") === ADMIN_NAME.toLocaleLowerCase("vi");
  const validPassword = constantTimeEqual(String(body.password || ""), String(env.ADMIN_PASSWORD || ""));
  if (!validUser || !validPassword || !env.ADMIN_PASSWORD) {
    if (attempt && now - attempt.window_started_at < windowMs) {
      await env.DB.prepare("UPDATE login_attempts SET attempts = attempts + 1 WHERE ip_hash = ?").bind(ipHash).run();
    } else {
      await env.DB.prepare(
        "INSERT INTO login_attempts(ip_hash, attempts, window_started_at) VALUES(?, 1, ?) " +
        "ON CONFLICT(ip_hash) DO UPDATE SET attempts = 1, window_started_at = excluded.window_started_at"
      ).bind(ipHash, now).run();
    }
    return json({ error: "Tên tài khoản hoặc mật khẩu không đúng." }, 401);
  }

  await env.DB.prepare("DELETE FROM login_attempts WHERE ip_hash = ?").bind(ipHash).run();
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + 12 * 60 * 60 * 1000;
  await env.DB.prepare(
    "INSERT INTO admin_sessions(token_hash, created_at, expires_at) VALUES(?, ?, ?)"
  ).bind(tokenHash, now, expiresAt).run();
  return json({ ok: true, account: ADMIN_NAME }, 200, {
    "Set-Cookie": cookie(ADMIN_COOKIE, token, 12 * 60 * 60)
  });
}

function constantTimeEqual(a, b) {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function validPlan(plan) {
  return Object.prototype.hasOwnProperty.call(PLAN_MONTHS, plan);
}

async function createLicense(env, plan, note, suppliedCode = "") {
  const code = suppliedCode ? normalizeCode(suppliedCode) : generateCode();
  if (!code || !validPlan(plan)) throw new Error("Mã key hoặc hạn dùng không hợp lệ.");
  const id = randomToken().slice(0, 18);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO licenses(id, code_hash, code_cipher, plan, note, created_at) VALUES(?, ?, ?, ?, ?, ?)"
  ).bind(id, await sha256Hex(code), await encryptCode(code, env), plan, String(note || "").slice(0, 240), now).run();
  return { id, code, plan, note: String(note || ""), createdAt: now, activatedAt: null, expiresAt: null, revokedAt: null };
}

async function adminKeys(request, env) {
  if (!await adminSession(request, env)) return json({ error: "Cần đăng nhập quản trị." }, 401);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get("offset")) || 0));
    const limit = 20;
    const rows = await env.DB.prepare(
      "SELECT id, code_cipher, plan, note, created_at, activated_at, expires_at, revoked_at " +
      "FROM licenses ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).bind(limit, offset).all();
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM licenses").first();
    const licenses = [];
    for (const row of rows.results || []) {
      licenses.push({
        id: row.id,
        code: await decryptCode(row.code_cipher, env),
        plan: row.plan,
        note: row.note,
        createdAt: row.created_at,
        activatedAt: row.activated_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at
      });
    }
    return json({ licenses, total: Number(count?.total || 0), offset, limit });
  }

  if (request.method !== "POST") return json({ error: "Phương thức không được hỗ trợ." }, 405);
  if (!sameOrigin(request)) return json({ error: "Yêu cầu không hợp lệ." }, 403);
  let body;
  try { body = await readJson(request); }
  catch { return json({ error: "Dữ liệu gửi lên không hợp lệ." }, 400); }

  if (body.action === "create") {
    if (!validPlan(body.plan)) return json({ error: "Hạn key không hợp lệ." }, 400);
    const created = await createLicense(env, body.plan, body.note);
    return json({ license: created }, 201);
  }

  if (body.action === "import") {
    if (!Array.isArray(body.licenses) || body.licenses.length < 1 || body.licenses.length > 10) {
      return json({ error: "Mỗi lượt nhập tối đa 10 mã." }, 400);
    }
    const statements = [];
    for (const item of body.licenses) {
      const code = normalizeCode(item.code);
      if (!code || !validPlan(item.plan)) return json({ error: "CSV có mã hoặc hạn dùng không hợp lệ." }, 400);
      statements.push(env.DB.prepare(
        "INSERT OR IGNORE INTO licenses(id, code_hash, code_cipher, plan, note, created_at) VALUES(?, ?, ?, ?, ?, ?)"
      ).bind(
        randomToken().slice(0, 18),
        await sha256Hex(code),
        await encryptCode(code, env),
        item.plan,
        String(item.note || "").slice(0, 240),
        Date.now()
      ));
    }
    const results = await env.DB.batch(statements);
    const added = results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
    return json({ added, duplicates: body.licenses.length - added });
  }

  if (body.action === "update") {
    const id = String(body.id || "");
    const note = String(body.note || "").slice(0, 240);
    const license = await env.DB.prepare("SELECT id FROM licenses WHERE id = ?").bind(id).first();
    if (!license) return json({ error: "Không tìm thấy mã key." }, 404);
    const revokedAt = body.revoked ? Date.now() : null;
    await env.DB.prepare("UPDATE licenses SET note = ?, revoked_at = ? WHERE id = ?")
      .bind(note, revokedAt, id).run();
    if (body.revoked) await env.DB.prepare("DELETE FROM user_sessions WHERE license_id = ?").bind(id).run();
    return json({ ok: true });
  }

  return json({ error: "Tác vụ không hợp lệ." }, 400);
}
