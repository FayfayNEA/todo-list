import crypto from 'node:crypto';

// Time-based one-time codes (RFC 6238): the six digits an authenticator app shows,
// derived from a shared secret and the current 30-second window. Nothing to call out to;
// the server and the phone each work the number out and compare.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '', out = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Bytes(s) {
  let bits = '';
  for (const ch of String(s).replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

function codeAt(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Bytes(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

// One window either side, so a phone clock a little off, or a code typed as it rolls
// over, still works. Returns the window it matched, so a used code can't be replayed.
export function checkCode(secret, code, lastUsed = -1, now = Date.now()) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const t = Math.floor(now / 30000);
  for (const w of [t, t - 1, t + 1]) {
    if (w <= lastUsed) continue;
    const a = Buffer.from(codeAt(secret, w)), b = Buffer.from(clean);
    if (crypto.timingSafeEqual(a, b)) return w;
  }
  return null;
}

// Ten single-use codes for a lost phone, shown once and kept only as hashes.
export function newBackupCodes() {
  return Array.from({ length: 10 }, () => {
    const raw = crypto.randomBytes(5).toString('hex');
    return raw.slice(0, 5) + '-' + raw.slice(5);
  });
}
export const hashBackup = (code) =>
  crypto.createHash('sha256').update(String(code).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

export function otpauthUrl(secret, email) {
  const label = encodeURIComponent('the manifesto:' + email);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('the manifesto')}&algorithm=SHA1&digits=6&period=30`;
}
