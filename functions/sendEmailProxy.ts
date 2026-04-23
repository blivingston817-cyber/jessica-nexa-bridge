// Email proxy — called by the bridge server to send emails via Base44 Gmail connector
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const { to, subject, html } = body;

    if (!to || !subject || !html) {
      return Response.json({ ok: false, error: 'Missing to, subject, or html' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const { accessToken } = await base44.asServiceRole.connectors.getConnection("gmail");

    if (!accessToken) {
      return Response.json({ ok: false, error: 'No Gmail access token' }, { status: 500 });
    }

    const emailContent = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${html}`;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(emailContent);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    const raw = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');

    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error(`Gmail send error to ${to}:`, err.slice(0, 300));
      return Response.json({ ok: false, error: err.slice(0, 300) }, { status: 500 });
    }

    const result = await r.json();
    console.log(`✅ Email sent to ${to} — id: ${result.id}`);
    return Response.json({ ok: true, messageId: result.id });

  } catch (err) {
    console.error('sendEmailProxy error:', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
