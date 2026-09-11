// Sending invitations. Resend's REST API over fetch — no SDK, since this is one request.
const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const MAIL_FROM = (process.env.MAIL_FROM || '').trim();

export const mailReady = () => !!RESEND_KEY && !!MAIL_FROM;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function body(code, link, fromName) {
  const who = fromName ? esc(fromName) + ' has' : 'You have been';
  const text = [
    `${fromName ? fromName + ' has' : 'You have been'} invited you to a shared checklist.`,
    '',
    `Your invite code: ${code}`,
    '',
    `Open ${link} and the code is filled in for you. Pick an email and a password and you'll have a list of your own.`,
    '',
    'The code works once.',
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#17170f;max-width:460px">
      <p>${who} invited you to a checklist of your own.</p>
      <p style="margin:22px 0">
        <a href="${esc(link)}" style="display:inline-block;background:#67a5cf;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">open the checklist</a>
      </p>
      <p style="color:#75899a;font-size:13px">
        The code is filled in for you at that link. If you'd rather type it:
        <strong style="color:#17170f;letter-spacing:0.08em">${esc(code)}</strong>
      </p>
      <p style="color:#75899a;font-size:13px">It works once.</p>
    </div>`;
  return { text, html };
}

export async function sendInvite(to, code, link, fromName) {
  if (!mailReady()) {
    return { sent: false, reason: 'email sending is not set up on this server yet' };
  }
  const { text, html } = body(code, link, fromName);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [to],
        subject: 'a checklist of your own',
        text,
        html,
      }),
    });
    if (res.ok) return { sent: true };
    // Worth surfacing rather than swallowing: the usual cause is an unverified sending
    // domain, which nobody can guess from "it didn't work".
    let detail = '';
    try { detail = ((await res.json()).message || '').slice(0, 200); } catch (e) {}
    return { sent: false, reason: detail || ('the mail service said ' + res.status) };
  } catch (e) {
    console.error('sendInvite', e);
    return { sent: false, reason: "couldn't reach the mail service" };
  }
}
