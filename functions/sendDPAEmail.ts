// v1
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const { submission, programs, overallStatus } = body;

    const base44 = createClientFromRequest(req);
    const { accessToken } = await base44.asServiceRole.connectors.getConnection("gmail");

    const sendEmail = async (to: string, subject: string, html: string) => {
      const emailContent = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${html}`;
      const encoder = new TextEncoder();
      const bytes = encoder.encode(emailContent);
      let binary = '';
      bytes.forEach(b => binary += String.fromCharCode(b));
      const raw = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw })
      });
      if (!r.ok) {
        const err = await r.text();
        console.error(`Gmail error to ${to}:`, err.slice(0, 300));
        return false;
      }
      console.log(`Email sent to ${to} ✅`);
      return true;
    };

    const programsText = Array.isArray(programs)
      ? programs.map((p: any) => `• ${p.name}: ${p.status}`).join('\n')
      : (programs || 'None matched');

    const programsHtml = Array.isArray(programs)
      ? programs.map((p: any) => {
          const color = p.status === 'Likely Eligible' ? '#16a34a' :
                        p.status === 'Currently Unavailable' ? '#6b7280' :
                        p.status === 'Not Eligible Based on Initial Answers' ? '#dc2626' : '#d97706';
          return `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:600;">${p.name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:${color};font-weight:600;">${p.status}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="2" style="padding:8px 12px;">None matched</td></tr>`;

    // Email to Brandyn
    const brandynHtml = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;padding:24px 28px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:20px;">🏠 New DPA Eligibility Submission</h2>
        <p style="margin:6px 0 0;opacity:0.85;font-size:13px;">NEXA Lending — DPA Eligibility Checker</p>
      </div>
      <div style="padding:24px 28px;background:#f8fafc;">
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:20px;">
          <tr style="background:#f0f4ff"><td colspan="2" style="padding:10px 14px;font-weight:700;color:#1e3a5f;font-size:13px;">CONTACT INFORMATION</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;width:200px;color:#374151;">Full Name</td><td style="padding:8px 12px;">${submission.full_name}</td></tr>
          <tr style="background:#fafafa"><td style="padding:8px 12px;font-weight:600;color:#374151;">Phone</td><td style="padding:8px 12px;">${submission.phone_number}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Email</td><td style="padding:8px 12px;"><a href="mailto:${submission.email_address}" style="color:#2563eb;">${submission.email_address}</a></td></tr>
          <tr style="background:#f0f4ff"><td colspan="2" style="padding:10px 14px;font-weight:700;color:#1e3a5f;font-size:13px;">LOCATION</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#374151;">State</td><td style="padding:8px 12px;">${submission.state}</td></tr>
          <tr style="background:#fafafa"><td style="padding:8px 12px;font-weight:600;color:#374151;">County/Parish</td><td style="padding:8px 12px;">${submission.county_or_parish}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#374151;">City</td><td style="padding:8px 12px;">${submission.city}</td></tr>
          <tr style="background:#f0f4ff"><td colspan="2" style="padding:10px 14px;font-weight:700;color:#1e3a5f;font-size:13px;">PROFILE</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Credit Score Range</td><td style="padding:8px 12px;">${submission.estimated_middle_credit_score}</td></tr>
          <tr style="background:#fafafa"><td style="padding:8px 12px;font-weight:600;color:#374151;">Est. DTI</td><td style="padding:8px 12px;">${submission.estimated_dti}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Annual HH Income</td><td style="padding:8px 12px;">$${Number(submission.annual_household_income || 0).toLocaleString()}</td></tr>
          <tr style="background:#fafafa"><td style="padding:8px 12px;font-weight:600;color:#374151;">Purchase Price</td><td style="padding:8px 12px;">$${Number(submission.purchase_price || 0).toLocaleString()}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Loan Type</td><td style="padding:8px 12px;">${submission.loan_type}</td></tr>
          <tr style="background:#fafafa"><td style="padding:8px 12px;font-weight:600;color:#374151;">First-Time Buyer?</td><td style="padding:8px 12px;">${submission.owned_home_last_3_years === 'No' ? 'Yes (not owned in 3 yrs)' : 'No'}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Veteran/Military</td><td style="padding:8px 12px;">${submission.veteran_or_active_military}</td></tr>
        </table>

        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:20px;">
          <tr style="background:#f0f4ff"><td colspan="2" style="padding:10px 14px;font-weight:700;color:#1e3a5f;font-size:13px;">PROGRAM MATCHES</td></tr>
          ${programsHtml}
        </table>

        <div style="background:#e8f4e8;border:1px solid #86efac;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
          <strong>Overall Result: ${overallStatus}</strong>
        </div>

        <div style="text-align:center;margin-top:20px;">
          <a href="https://app.base44.com/superagent/69c8bc2a8e7923547ee56685" style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">View in Dashboard</a>
        </div>
      </div>
      <div style="padding:16px 28px;background:#f1f5f9;text-align:center;font-size:11px;color:#6b7280;border-radius:0 0 8px 8px;">
        This is an automated notification from your DPA Eligibility Checker. Powered by NEXA Lending AI.
      </div>
    </div>`;

    // Confirmation email to borrower
    const borrowerHtml = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;padding:24px 28px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:20px;">🏠 Your DPA Eligibility Results</h2>
        <p style="margin:6px 0 0;opacity:0.85;font-size:13px;">Brandyn Livingston · NEXA Lending</p>
      </div>
      <div style="padding:24px 28px;background:#f8fafc;">
        <p style="margin:0 0 16px;font-size:15px;">Hi ${submission.full_name},</p>
        <p style="margin:0 0 16px;">Thank you for completing the DPA Eligibility Checker. Your results are based on initial published program guidelines and are <strong>not a loan approval</strong>.</p>
        <p style="margin:0 0 20px;">Brandyn Livingston will review your information and follow up with next steps.</p>

        <div style="background:white;border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:20px;">
          <strong style="color:#1e3a5f;">Programs Reviewed:</strong>
          <ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;">
            ${Array.isArray(programs) ? programs.map((p: any) => `<li><strong>${p.name}</strong> — ${p.status}</li>`).join('') : '<li>See your results online</li>'}
          </ul>
        </div>

        <div style="text-align:center;margin:24px 0;">
          <a href="https://calendly.com/brandyn-livingston" style="display:inline-block;background:#2563eb;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;">Schedule a Review with Brandyn</a>
        </div>

        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;font-size:12px;color:#92400e;">
          <strong>Important:</strong> This tool is for educational and preliminary screening purposes only. It is not a commitment to lend, not a loan approval, and not a guarantee of eligibility. All loan programs are subject to credit approval, underwriting, property review, and current program availability.
        </div>
      </div>
      <div style="padding:16px 28px;background:#f1f5f9;text-align:center;font-size:11px;color:#6b7280;border-radius:0 0 8px 8px;">
        Brandyn Livingston · NEXA Lending · blivingston@nexalending.com · (833) 988-3514
      </div>
    </div>`;

    const results = await Promise.allSettled([
      sendEmail("blivingston@nexalending.com", `New DPA Eligibility Submission - ${submission.full_name}`, brandynHtml),
      submission.email_address ? sendEmail(submission.email_address, "Your DPA Eligibility Results", borrowerHtml) : Promise.resolve(false),
    ]);

    return Response.json({ ok: true, results: results.map(r => r.status) });
  } catch (err) {
    console.error("sendDPAEmail error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
