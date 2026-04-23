import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// This function is called by the MortgageFlow client portal (nexamortgageadvisors.com/client-status)
// whenever a client signs in to check their loan status.
// It sends Brandyn a notification that a client accessed the portal.

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, name, applicationId } = body;

    if (!email) {
      return Response.json({ ok: true, skipped: 'no email provided' });
    }

    const BRANDYN_EMAIL = 'blivingston@nexalending.com';
    const BRANDYN_EMAIL2 = 'blivingston817@gmail.com';
    const EMAIL_PROXY_URL = 'https://jessica-7ee56685.base44.app/functions/sendEmailProxy';
    const BASE44_API_KEY = Deno.env.get('BASE44_SERVICE_TOKEN') || '';

    const callTime = new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' });
    const subject = `👤 Client Portal Access — ${name || email}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;">👤 Client Checked Loan Status</h2>
          <p style="margin:4px 0 0;opacity:0.8;font-size:13px;">NEXA Lending · ${callTime}</p>
        </div>
        <div style="padding:20px 24px;background:#f8fafc;">
          <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;">
            <tr style="background:#f0f4ff"><td colspan="2" style="padding:10px 14px;font-weight:700;color:#1e3a5f;">Client Details</td></tr>
            <tr><td style="padding:8px 12px;font-weight:600;width:160px;">Name</td><td style="padding:8px 12px;">${name || 'Unknown'}</td></tr>
            <tr style="background:#fafafa"><td style="padding:8px 12px;font-weight:600;">Email</td><td style="padding:8px 12px;">${email}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:600;">Application ID</td><td style="padding:8px 12px;">${applicationId || 'None found'}</td></tr>
            <tr style="background:#fafafa"><td style="padding:8px 12px;font-weight:600;">Accessed At</td><td style="padding:8px 12px;">${callTime} (AZ)</td></tr>
          </table>
          <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
            ${applicationId 
              ? `This client has an active application on file. You may want to follow up.` 
              : `⚠️ No matching application was found for this email. The client may have applied under a different email address.`}
          </p>
        </div>
        <div style="padding:10px 24px;background:#1e3a5f;border-radius:0 0 8px 8px;text-align:center;">
          <p style="color:#90c0ff;margin:0;font-size:11px;">Jessica AI · NEXA Lending · Automated Portal Alert</p>
        </div>
      </div>
    `;

    // Fire email notification (non-blocking errors)
    try {
      await fetch(EMAIL_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': BASE44_API_KEY },
        body: JSON.stringify({ to: BRANDYN_EMAIL, subject, html }),
      });
    } catch (_) {
      // silent fail — don't block portal access
    }

    return Response.json({ ok: true, notified: true });
  } catch (error) {
    // Always return 200 so the portal doesn't break
    return Response.json({ ok: true, error: error.message });
  }
});
