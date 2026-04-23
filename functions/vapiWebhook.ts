// v2
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const LEADFLOW_APP_ID = "69cfe4f5a8d6d5273ce84a33";
const MORTGAGEFLOW_APP_ID = "69bfd95d92a306f5b08f1db5";

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));

    // ── BDM Lead handler ──────────────────────────────────────────────────────
    if (body?.bdm === true) {
      const callerNumber = body.callerNumber || "";
      const transcript = body.transcript || "";
      const callTime = body?.call?.createdAt
        ? new Date(body.call.createdAt).toLocaleString("en-US", { timeZone: "America/Phoenix" })
        : new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" });

      // Extract BDM fields via GPT
      let bdm: Record<string, any> = {};
      try {
        const bdmRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              { role: "system", content: "Extract BDM lead info from this call transcript. Return valid JSON with: full_name, email, brokerage_or_company, years_in_business, licensed_states, avg_transactions_per_year, avg_loan_amount, currently_referring, motivation, callback_time. Use null for anything not found." },
              { role: "user", content: transcript }
            ],
            response_format: { type: "json_object" }
          })
        });
        if (bdmRes.ok) {
          const d = await bdmRes.json();
          bdm = JSON.parse(d.choices[0].message.content);
        }
      } catch (e) { console.error("BDM extraction error:", e); }

      const base44bdm = createClientFromRequest(req);
      const JESSICA_APP_ID = "69c8bc2a8e7923547ee56685";
      const isRestricted = body.restrictedState === true;
      const bdmStatus = isRestricted ? "Not Available - AZ/NY" : "Callback Scheduled";
      const bdmTag = isRestricted ? "BDM Restricted State" : "BDM Inquiry";

      // Save to BDMLead entity
      try {
        await base44bdm.asServiceRole.entities(JESSICA_APP_ID).BDMLead.create({
          full_name: bdm.full_name || callerNumber,
          phone: callerNumber,
          email: bdm.email || null,
          brokerage_or_company: bdm.brokerage_or_company || null,
          years_in_business: bdm.years_in_business || null,
          licensed_states: bdm.licensed_states || null,
          avg_transactions_per_year: bdm.avg_transactions_per_year || null,
          avg_loan_amount: bdm.avg_loan_amount || null,
          currently_referring: bdm.currently_referring || null,
          motivation: bdm.motivation || null,
          callback_time: bdm.callback_time || null,
          callback_requested: !isRestricted,
          status: bdmStatus,
          tag: bdmTag,
          notes: (isRestricted ? "⚠️ RESTRICTED STATE (AZ/NY) — Follow up when available\n\n" : "") + transcript.substring(0, 2000)
        });
        console.log("BDM lead saved to Jessica app");
      } catch (e) { console.error("BDM save error:", e); }

      // Save to LeadFlow Realtor entity
      try {
        await base44bdm.asServiceRole.entities(LEADFLOW_APP_ID).Realtor.create({
          name: bdm.full_name || callerNumber,
          phone: callerNumber,
          email: bdm.email || null,
          brokerage: bdm.brokerage_or_company || null,
          notes: isRestricted
            ? `BDM Restricted State (AZ/NY) — follow up when available`
            : `BDM Inquiry — callback requested: ${bdm.callback_time || 'not specified'}`,
          status: "Active"
        });
        console.log("BDM lead saved to LeadFlow Realtor entity");
      } catch (e) { console.error("LeadFlow Realtor save error:", e); }

      // Send emails via Gmail
      const BDM_PDF_URL = "https://base44.app/api/apps/69c8bc2a8e7923547ee56685/files/mp/public/69c8bc2a8e7923547ee56685/1cb0bdc0c_331782837_BDM.pdf";
      try {
        const { accessToken } = await base44bdm.asServiceRole.connectors.getConnection("gmail");

        const sendEmail = async (to: string, subject: string, html: string) => {
          const emailContent = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${html}`;
          const encoder = new TextEncoder();
          const encoded = encoder.encode(emailContent);
          const raw = btoa(String.fromCharCode(...encoded)).replace(/\+/g, "-").replace(/\//g, "_");
          const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
            method: "POST",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ raw })
          });
          if (!r.ok) console.error(`Gmail error (${to}):`, await r.text());
          else console.log(`BDM email sent to ${to}`);
        };

        // Email Brandyn — different subject/body for restricted state
        const brandynSubject = isRestricted
          ? `⚠️ BDM Restricted State (AZ/NY) — ${bdm.full_name || callerNumber} — Save for Later`
          : `🤝 BDM Inquiry — ${bdm.full_name || callerNumber} — Callback: ${bdm.callback_time || "TBD"}`;

        const restrictedBanner = isRestricted ? `
            <div style="margin-bottom:16px;padding:14px 16px;background:#fff3cd;border:1px solid #ffc107;border-radius:6px;">
              <strong style="color:#856404;">⚠️ Restricted State — AZ/NY</strong>
              <p style="margin:6px 0 0;color:#856404;font-size:13px;">This lead is licensed in Arizona or New York. The BDM program is not currently available in those states. They have been logged for future follow-up when availability opens.</p>
            </div>` : '';

        await sendEmail(
          "blivingston@nexalending.com",
          brandynSubject,
          `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#003366;color:white;padding:20px;border-radius:6px 6px 0 0;">
              <h2 style="margin:0;">🤝 ${isRestricted ? '⚠️ BDM Restricted State (AZ/NY)' : 'New BDM Inquiry'} — NEXA Lending</h2>
              <p style="margin:6px 0 0;opacity:0.8;font-size:13px;">Jessica AI Agent · ${callTime}</p>
            </div>
            <div style="padding:20px;background:#f5f7fa;">
              ${restrictedBanner}
              <table style="width:100%;border-collapse:collapse;background:white;border-radius:6px;overflow:hidden;">
                <tr style="background:#eef2f7"><td style="padding:8px 12px;font-weight:bold;width:200px;">Name</td><td style="padding:8px 12px;">${bdm.full_name || "N/A"}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;">Phone</td><td style="padding:8px 12px;">${callerNumber}</td></tr>
                <tr style="background:#eef2f7"><td style="padding:8px 12px;font-weight:bold;">Email</td><td style="padding:8px 12px;">${bdm.email || "N/A"}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;">Brokerage/Company</td><td style="padding:8px 12px;">${bdm.brokerage_or_company || "N/A"}</td></tr>
                <tr style="background:#eef2f7"><td style="padding:8px 12px;font-weight:bold;">Years in Business</td><td style="padding:8px 12px;">${bdm.years_in_business || "N/A"}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;">Licensed States</td><td style="padding:8px 12px;">${bdm.licensed_states || "N/A"}</td></tr>
                <tr style="background:#eef2f7"><td style="padding:8px 12px;font-weight:bold;">Avg Transactions/yr</td><td style="padding:8px 12px;">${bdm.avg_transactions_per_year || "N/A"}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;">Avg Loan Amount</td><td style="padding:8px 12px;">${bdm.avg_loan_amount || "N/A"}</td></tr>
                <tr style="background:#eef2f7"><td style="padding:8px 12px;font-weight:bold;">Currently Referring To</td><td style="padding:8px 12px;">${bdm.currently_referring || "N/A"}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;">Why Interested</td><td style="padding:8px 12px;">${bdm.motivation || "N/A"}</td></tr>
                <tr style="background:#eef2f7"><td style="padding:8px 12px;font-weight:bold;">Requested Callback</td><td style="padding:8px 12px;"><strong style="color:#cc6600;">${bdm.callback_time || "N/A"}</strong></td></tr>
              </table>
              <div style="margin-top:16px;padding:16px;background:white;border-radius:6px;border:1px solid #ddd;">
                <strong>📄 Full Transcript</strong>
                <pre style="white-space:pre-wrap;font-size:12px;margin:10px 0 0;">${transcript}</pre>
              </div>
            </div>
          </div>`
        );

        // Email the prospect — only if NOT a restricted state
        if (bdm.email && !isRestricted) {
          await sendEmail(
            bdm.email,
            "Your First-Class Career Starts Here — NEXA Lending BDM Program",
            `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#003366;color:white;padding:20px;border-radius:6px 6px 0 0;">
                <h2 style="margin:0;">✈️ Your First-Class Career Starts Here</h2>
                <p style="margin:6px 0 0;opacity:0.8;">NEXA Lending — Business Development Manager Program</p>
              </div>
              <div style="padding:24px;background:#f5f7fa;">
                <p>Hi ${bdm.full_name || "there"},</p>
                <p>Thank you for your interest in the <strong>NEXA Lending BDM Program</strong>. Here's what makes it so powerful:</p>
                <table style="width:100%;border-collapse:collapse;background:white;border-radius:6px;margin:16px 0;">
                  <tr style="background:#eef2f7"><td style="padding:10px 14px;">✅ <strong>W-2 Employee Role</strong></td><td style="padding:10px 14px;">Fully RESPA-compliant — not a referral fee</td></tr>
                  <tr><td style="padding:10px 14px;">💰 <strong>Earn 25–75 bps per closed loan</strong></td><td style="padding:10px 14px;">Performance-based, per-funded loan</td></tr>
                  <tr style="background:#eef2f7"><td style="padding:10px 14px;">⏰ <strong>Part-Time Friendly</strong></td><td style="padding:10px 14px;">Focus on relationships, not processing</td></tr>
                  <tr><td style="padding:10px 14px;">🏢 <strong>Built For You</strong></td><td style="padding:10px 14px;">Realtors, CPAs, Advisors, Builders, Marketers</td></tr>
                  <tr style="background:#eef2f7"><td style="padding:10px 14px;">🤝 <strong>NEXA Handles Everything</strong></td><td style="padding:10px 14px;">HR, back-office, compliance — all covered</td></tr>
                </table>
                <p>Brandyn will be calling you at your requested time to walk you through everything personally.</p>
                <p>In the meantime, download your <strong>BDM Onboarding Flight Plan</strong>:</p>
                <p style="text-align:center;margin:24px 0;">
                  <a href="${BDM_PDF_URL}" style="background:#003366;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;">📄 Download BDM Onboarding Guide</a>
                </p>
                <p style="color:#666;font-size:13px;">Together, we rise higher. 🚀</p>
                <p style="color:#666;font-size:13px;">— Jessica, on behalf of Brandyn Livingston | NEXA Lending<br>📞 833-988-3514 | ✉️ blivingston@nexalending.com</p>
              </div>
            </div>`
          );
        }
      } catch (e) { console.error("BDM Gmail error:", e); }

      return Response.json({ ok: true, bdm: true, caller: callerNumber, name: bdm.full_name });
    }

    const isVapi = !!body?.message?.type;
    if (isVapi && body.message.type !== "end-of-call-report") {
      return Response.json({ ok: true, skipped: true });
    }

    const call = isVapi ? body.message : body;
    const transcript = call?.transcript || "";
    const summary = call?.summary || "";
    const callerRaw = isVapi
      ? (call?.call?.customer?.number || "")
      : (call?.callerNumber || call?.phone || "");
    const durationSeconds = call?.durationSeconds || call?.duration || 0;
    const duration = durationSeconds
      ? `${Math.floor(durationSeconds / 60)}m ${Math.round(durationSeconds % 60)}s`
      : "Unknown";
    const callTime = call?.call?.createdAt
      ? new Date(call.call.createdAt).toLocaleString("en-US", { timeZone: "America/Phoenix" })
      : new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" });
    const callTimeISO = call?.call?.createdAt || new Date().toISOString();

    const base44 = createClientFromRequest(req);

    // ── 1. GPT extracts structured intake from transcript ──────────────────────
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are extracting mortgage intake data from a phone call transcript between an AI agent (Jessica) and a caller. Focus ONLY on what the CALLER said. Return valid JSON with ALL of the following fields:

PERSONAL INFO:
- full_name: caller's full legal name
- email: email address
- address: full home address
- consumer_city: city only
- consumer_state: 2-letter state abbreviation
- consumer_zip: zip code
- marital_status: "married", "unmarried", or "separated" (null if not mentioned)
- is_current_resident: true/false (null if not mentioned)
- dob_collected: true if date of birth was provided, false if refused, null if not reached
- ssn_collected: true if SSN was provided, false if refused, null if not reached
- dob: date of birth if provided (string, any format mentioned)
- ssn_last4: last 4 digits of SSN if mentioned (string)

APPLICATION TYPE:
- application_type: "full" if DOB and SSN were collected and all major sections completed, "short" if call ended before DOB/SSN or major sections were missing
- loan_type: "Refinance" or "Purchase"
- call_outcome: one sentence — e.g. "Full application completed", "Short application — client refused SSN", "Short application — call ended early"

REFINANCE DETAILS:
- goal: financial goal in a short phrase
- loan_amount: requested cash out or loan amount (number only)
- cash_out: cash out amount (number only)
- amount_owed: current balance owed (number only)
- property_value: estimated home value (number only)
- current_interest_rate: current rate (number only)
- current_mortgage_payment: current monthly payment (number only)
- taxes_insurance_included: true if escrowed, false if not (null if unknown)
- annual_property_taxes: yearly property taxes (number only)
- annual_homeowners_insurance: yearly homeowners insurance (number only)
- property_type: "Single Family", "Condo", "Townhouse", "Multi-Family", etc.

PURCHASE DETAILS:
- purchase_price_range: target purchase price range
- down_payment: planned down payment (number only)
- property_found: true if they found a property, false if not
- occupancy_type: "primary", "second home", or "investment"
- purchase_location: city and state they want to buy in
- purchase_timeline: target timeline to buy

EMPLOYMENT — PRIMARY:
- employment_status: "employed", "self_employed", "retired", "disabled"
- employer_name: company name
- job_title: position/title
- years_employed: years at current job (number)
- is_full_time: true if full-time, false if part-time (null if not asked)
- annual_income: annual income (number only)
- years_self_employed: years self-employed (number)
- taxable_income_last_year: last year taxable income if self-employed (number only)
- taxable_income_year_before: year before taxable income (number only)
- avg_monthly_deposits: avg monthly deposits if self-employed (number only)
- retirement_income_monthly: monthly retirement/SS/pension income (number only)
- disability_income_monthly: monthly SSDI/VA income (number only)
- prior_employers: array of objects with {employer_name, job_title, start_date, end_date, duration} for 2-year history if current job under 2 years

VETERAN:
- is_veteran: true/false (null if not asked)
- used_va_loan_before: true/false (null if not asked)
- military_branch: branch of service if mentioned
- va_benefits: true if receiving VA benefits, false if not (null if not asked)

CO-BORROWER:
- has_co_borrower: true/false (null if not asked)
- co_borrower_name: full legal name
- co_borrower_email: email
- co_borrower_address: address
- co_borrower_employer: employer name
- co_borrower_job_title: position
- co_borrower_years_employed: years at job (number)
- co_borrower_employment_status: "employed", "self_employed", "retired", "disabled"
- co_borrower_annual_income: annual income (number only)
- co_borrower_taxable_income_last_year: if self-employed (number only)
- co_borrower_taxable_income_year_before: year before (number only)
- co_borrower_avg_monthly_deposits: avg deposits if self-employed (number only)
- co_borrower_is_veteran: true/false (null if not asked)
- co_borrower_dob_collected: true if DOB provided, false if refused, null if not reached
- co_borrower_ssn_collected: true if SSN provided, false if refused, null if not reached

MISSING ITEMS:
- missing_items: array of strings listing any required fields that were NOT collected (e.g. ["SSN", "Annual property taxes", "Co-borrower employment info"])

NOTES:
- call_notes: 4-6 sentence summary — who called, what they want, financial situation, what was collected, what was missing, how the call ended

RULES:
- Use null for any field not mentioned — never use "N/A"
- Strip $ signs and commas from all numbers
- application_type is "full" only if DOB AND SSN were both collected AND all major loan/employment sections were answered
- call_notes must always be filled in`
          },
          {
            role: "user",
            content: `TRANSCRIPT:\n${transcript}\n\nSUMMARY:\n${summary}`
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    let intake: Record<string, any> = {};
    if (openaiRes.ok) {
      const d = await openaiRes.json();
      try { intake = JSON.parse(d.choices[0].message.content); } catch (_) {}
    }
    console.log("Extracted intake:", JSON.stringify(intake));
    const callNotes = intake.call_notes || summary || "Call completed.";
    const appType = intake.application_type === "full" ? "Full Application" : "Short Application";
    const missingItems: string[] = Array.isArray(intake.missing_items) ? intake.missing_items : [];

    // ── 2. Look up lead in LeadFlow by phone ───────────────────────────────────
    let matchedLead: any = null;
    const digits = callerRaw.replace(/\D/g, '');
    const tenDigit = digits.slice(-10);
    const phoneFormats = [callerRaw, `+1${tenDigit}`, `1${tenDigit}`, tenDigit];

    for (const pfmt of phoneFormats) {
      try {
        const results = await base44.asServiceRole.entities(LEADFLOW_APP_ID).Lead.filter({ phone: pfmt });
        if (results && results.length > 0) { matchedLead = results[0]; break; }
      } catch (e) { console.error("LeadFlow lookup error:", e); }
    }

    // ── 3. Build LeadFlow fields ───────────────────────────────────────────────
    const callLogEntry = { timestamp: callTimeISO, note: `Jessica AI call | ${duration} | ${appType} | ${intake.call_outcome || callNotes}` };
    const noteLogEntry = { timestamp: callTimeISO, text: `[${appType} - ${callTime}]\n${callNotes}${missingItems.length ? '\n\nMissing: ' + missingItems.join(', ') : ''}` };

    const leadFields: Record<string, any> = {
      consumer: intake.full_name || matchedLead?.consumer || `Unknown (${callerRaw})`,
      phone: callerRaw,
      email: intake.email || matchedLead?.email || "",
      consumer_address: intake.address || matchedLead?.consumer_address || "",
      consumer_city: intake.consumer_city || matchedLead?.consumer_city || "",
      consumer_state: intake.consumer_state || matchedLead?.consumer_state || "",
      consumer_zip: intake.consumer_zip || matchedLead?.consumer_zip || "",
      loan_type: intake.loan_type || matchedLead?.loan_type || "Refinance",
      loan_amount: intake.loan_amount || matchedLead?.loan_amount || null,
      cash_out: intake.cash_out || null,
      property_value: intake.property_value || matchedLead?.property_value || null,
      property_type: intake.property_type || matchedLead?.property_type || "",
      sales_result: `AI Intake - ${appType}`,
      converted: true,
      va_indicator: intake.is_veteran === true,
      notes: `${matchedLead?.notes ? matchedLead.notes + "\n\n" : ""}[${appType} - ${callTime}]\n${callNotes}${missingItems.length ? '\n\nMissing: ' + missingItems.join(', ') : ''}`,
    };
    if (leadFields.loan_amount && leadFields.property_value) {
      leadFields.ltv = parseFloat(((leadFields.loan_amount / leadFields.property_value) * 100).toFixed(4));
    }
    // Remove nulls
    Object.keys(leadFields).forEach(k => leadFields[k] == null && delete leadFields[k]);

    if (matchedLead) {
      const existingCallLog = Array.isArray(matchedLead.call_log) ? matchedLead.call_log : [];
      const existingNoteLog = Array.isArray(matchedLead.note_log) ? matchedLead.note_log : [];
      try {
        await base44.asServiceRole.entities(LEADFLOW_APP_ID).Lead.update(matchedLead.id, {
          ...leadFields,
          call_log: [...existingCallLog, callLogEntry],
          note_log: [...existingNoteLog, noteLogEntry],
        });
        console.log("LeadFlow lead updated:", matchedLead.id);
      } catch (e) { console.error("LeadFlow update error:", e); }
    } else {
      try {
        matchedLead = await base44.asServiceRole.entities(LEADFLOW_APP_ID).Lead.create({
          ...leadFields,
          call_log: [callLogEntry],
          note_log: [noteLogEntry],
        });
        console.log("LeadFlow lead created:", matchedLead?.id);
      } catch (e) { console.error("LeadFlow create error:", e); }
    }

    // ── 4. Create MortgageApplication ─────────────────────────────────────────
    const nameParts = (intake.full_name || matchedLead?.consumer || "").trim().split(" ");
    const mortgageApp: Record<string, any> = {
      status: intake.application_type === "full" ? "submitted" : "incomplete",
      phone: callerRaw,
      first_name: nameParts[0] || "",
      last_name: nameParts.slice(1).join(" ") || "",
      email: intake.email || matchedLead?.email || "",
      mailing_address: intake.address || matchedLead?.consumer_address || "",
      property_address: intake.address || matchedLead?.consumer_address || "",
      property_type: intake.property_type || matchedLead?.property_type || null,
      loan_type: intake.loan_type || "Refinance",
      goal: intake.goal || null,
      marital_status: intake.marital_status || null,
      // Refinance fields
      amount_owed: intake.amount_owed || null,
      current_interest_rate: intake.current_interest_rate || null,
      current_mortgage_payment: intake.current_mortgage_payment || null,
      taxes_insurance_included: intake.taxes_insurance_included ?? null,
      annual_property_taxes: intake.annual_property_taxes || null,
      annual_homeowners_insurance: intake.annual_homeowners_insurance || null,
      home_value: intake.property_value || matchedLead?.property_value || null,
      loan_amount: intake.loan_amount || matchedLead?.loan_amount || null,
      // Employment
      employment_status: intake.employment_status || null,
      employer_name: intake.employer_name || null,
      employer_address: null,
      years_employed: intake.years_employed || null,
      annual_income: intake.annual_income || null,
      taxable_income_last_year: intake.taxable_income_last_year || null,
      taxable_income_year_before: intake.taxable_income_year_before || null,
      years_in_business: intake.years_self_employed || null,
      // Purchase fields
      purchase_location: intake.purchase_location || null,
      // Notes
      notes: [
        `=== ${appType.toUpperCase()} — ${callTime} ===`,
        `Duration: ${duration}`,
        `Outcome: ${intake.call_outcome || "Call completed"}`,
        ``,
        `CALL NOTES:`,
        callNotes,
        missingItems.length ? `\nMISSING ITEMS:\n- ${missingItems.join('\n- ')}` : '',
        ``,
        `VETERAN: ${intake.is_veteran === true ? 'Yes' : intake.is_veteran === false ? 'No' : 'Not asked'}`,
        intake.is_veteran ? `VA Loan Used Before: ${intake.used_va_loan_before ?? 'N/A'} | Branch: ${intake.military_branch ?? 'N/A'} | Benefits: ${intake.va_benefits ?? 'N/A'}` : '',
        ``,
        `DOB COLLECTED: ${intake.dob_collected === true ? 'Yes' : intake.dob_collected === false ? 'Refused' : 'Not reached'}`,
        `SSN COLLECTED: ${intake.ssn_collected === true ? 'Yes' : intake.ssn_collected === false ? 'Refused' : 'Not reached'}`,
        intake.dob ? `DOB: ${intake.dob}` : '',
        ``,
        `CO-BORROWER: ${intake.has_co_borrower === true ? 'Yes' : intake.has_co_borrower === false ? 'No' : 'Not asked'}`,
        intake.has_co_borrower ? `Co-Borrower: ${intake.co_borrower_name || 'N/A'} | ${intake.co_borrower_employer || 'N/A'} | Income: $${intake.co_borrower_annual_income || 'N/A'}` : '',
        ``,
        `--- FULL TRANSCRIPT ---`,
        transcript,
      ].filter(Boolean).join('\n'),
    };
    Object.keys(mortgageApp).forEach(k => (mortgageApp[k] == null || mortgageApp[k] === '') && delete mortgageApp[k]);

    try {
      const created = await base44.asServiceRole.entities(MORTGAGEFLOW_APP_ID).MortgageApplication.create(mortgageApp);
      console.log("MortgageApplication created:", created?.id);
    } catch (e) { console.error("MortgageApp create error:", e); }

    // ── 5. Send summary email ──────────────────────────────────────────────────
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
    const callerName = intake.full_name || matchedLead?.consumer || callerRaw;
    const subject = `New Mortgage Application Submitted – ${callerName} – ${appType}`;

    const f = (val: any, prefix = '', suffix = '') =>
      val != null && val !== '' ? `${prefix}${typeof val === 'number' ? val.toLocaleString() : val}${suffix}` : 'N/A';
    const b = (val: any) => val === true ? 'Yes' : val === false ? 'No' : 'N/A';
    const collected = (val: any) => val === true ? '✅ Collected' : val === false ? '❌ Refused' : '⏳ Not reached';

    const sec = (title: string) =>
      `<tr><td colspan="2" style="padding:10px 8px 5px;background:#003366;color:white;font-weight:bold;font-size:13px;letter-spacing:0.5px;">${title}</td></tr>`;
    const row = (label: string, val: string, i: number) =>
      `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#eef2f7'}"><td style="padding:8px 10px;font-weight:bold;color:#444;width:230px;font-size:13px;">${label}</td><td style="padding:8px 10px;font-size:13px;">${val}</td></tr>`;

    // Build prior employers rows
    const priorEmployerRows = Array.isArray(intake.prior_employers) && intake.prior_employers.length > 0
      ? intake.prior_employers.map((e: any, i: number) =>
          row(`Prior Employer ${i+1}`, `${e.employer_name || 'N/A'} — ${e.job_title || 'N/A'} (${e.start_date || '?'} to ${e.end_date || '?'})`, i)
        ).join('')
      : '';

    const tableRows = [
      sec("📋 Application Info"),
      row("Application Type", `<strong style="color:${intake.application_type === 'full' ? '#006600' : '#cc6600'}">${appType}</strong>`, 0),
      row("Call Outcome", f(intake.call_outcome), 1),
      row("Call Time", callTime, 2),
      row("Duration", duration, 3),

      sec("👤 Client Information"),
      row("Full Name", f(callerName), 0),
      row("Phone", callerRaw, 1),
      row("Email", f(intake.email || matchedLead?.email), 2),
      row("Address", f(intake.address || matchedLead?.consumer_address), 3),
      row("Marital Status", f(intake.marital_status), 4),
      row("Current Resident", b(intake.is_current_resident), 5),

      sec("🏠 Loan Details"),
      row("Loan Type", f(intake.loan_type), 0),
      row("Goal", f(intake.goal), 1),
      row("Property Type", f(intake.property_type), 2),

      ...(intake.loan_type !== 'Purchase' ? [
        row("Cash Out / Loan Amount", f(intake.loan_amount, '$'), 3),
        row("Amount Owed", f(intake.amount_owed, '$'), 4),
        row("Home Value", f(intake.property_value, '$'), 5),
        row("Current Rate", f(intake.current_interest_rate, '', '%'), 6),
        row("Monthly Payment", f(intake.current_mortgage_payment, '$'), 7),
        row("Escrows Tax & Insurance", b(intake.taxes_insurance_included), 8),
        row("Property Taxes/yr", f(intake.annual_property_taxes, '$'), 9),
        row("Homeowners Insurance/yr", f(intake.annual_homeowners_insurance, '$'), 10),
      ] : [
        row("Target Purchase Price", f(intake.purchase_price_range), 3),
        row("Down Payment", f(intake.down_payment, '$'), 4),
        row("Property Found", b(intake.property_found), 5),
        row("Occupancy Type", f(intake.occupancy_type), 6),
        row("Purchase Location", f(intake.purchase_location), 7),
        row("Timeline", f(intake.purchase_timeline), 8),
      ]),

      sec("💼 Employment — Primary Borrower"),
      row("Employment Status", f(intake.employment_status), 0),
      row("Employer", f(intake.employer_name), 1),
      row("Job Title", f(intake.job_title), 2),
      row("Years at Job", f(intake.years_employed), 3),
      row("Full-Time / Part-Time", intake.is_full_time === true ? 'Full-Time' : intake.is_full_time === false ? 'Part-Time' : 'N/A', 4),
      row("Annual Income", f(intake.annual_income, '$'), 5),
      row("Years Self-Employed", f(intake.years_self_employed), 6),
      row("Taxable Income (Last Yr)", f(intake.taxable_income_last_year, '$'), 7),
      row("Taxable Income (Yr Before)", f(intake.taxable_income_year_before, '$'), 8),
      row("Avg Monthly Deposits", f(intake.avg_monthly_deposits, '$'), 9),
      row("Retirement Income/mo", f(intake.retirement_income_monthly, '$'), 10),
      row("Disability Income/mo", f(intake.disability_income_monthly, '$'), 11),
      priorEmployerRows,

      sec("🎖️ Veteran Information"),
      row("Is Veteran", b(intake.is_veteran), 0),
      row("Used VA Loan Before", b(intake.used_va_loan_before), 1),
      row("Military Branch", f(intake.military_branch), 2),
      row("Receiving VA Benefits", b(intake.va_benefits), 3),

      sec("👥 Co-Borrower"),
      row("Has Co-Borrower", b(intake.has_co_borrower), 0),
      row("Co-Borrower Name", f(intake.co_borrower_name), 1),
      row("Co-Borrower Email", f(intake.co_borrower_email), 2),
      row("Co-Borrower Address", f(intake.co_borrower_address), 3),
      row("Co-Borrower Employer", f(intake.co_borrower_employer), 4),
      row("Co-Borrower Title", f(intake.co_borrower_job_title), 5),
      row("Co-Borrower Status", f(intake.co_borrower_employment_status), 6),
      row("Co-Borrower Income", f(intake.co_borrower_annual_income, '$'), 7),
      row("Co-Borrower Taxable (Last Yr)", f(intake.co_borrower_taxable_income_last_year, '$'), 8),
      row("Co-Borrower Taxable (Yr Before)", f(intake.co_borrower_taxable_income_year_before, '$'), 9),
      row("Co-Borrower Avg Deposits", f(intake.co_borrower_avg_monthly_deposits, '$'), 10),
      row("Co-Borrower Veteran", b(intake.co_borrower_is_veteran), 11),

      sec("🔐 Identity & Credit"),
      row("DOB", collected(intake.dob_collected) + (intake.dob ? ` — ${intake.dob}` : ''), 0),
      row("SSN", collected(intake.ssn_collected), 1),
      row("Co-Borrower DOB", collected(intake.co_borrower_dob_collected), 2),
      row("Co-Borrower SSN", collected(intake.co_borrower_ssn_collected), 3),

      ...(missingItems.length > 0 ? [
        sec("⚠️ Missing Items"),
        ...missingItems.map((item: string, i: number) => row(`Missing ${i+1}`, item, i))
      ] : []),
    ].join('');

    const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;border:1px solid #ccc;border-radius:8px;overflow:hidden;">
  <div style="background:#003366;color:white;padding:22px 24px;">
    <h2 style="margin:0;font-size:20px;">🏡 New Mortgage Application — NEXA Lending</h2>
    <p style="margin:6px 0 0;font-size:13px;opacity:0.8;">Jessica AI Agent · ${callTime}</p>
  </div>
  <div style="padding:20px;background:#f5f7fa;">
    <table style="width:100%;border-collapse:collapse;background:white;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
      ${tableRows}
    </table>
    <div style="margin-top:20px;padding:16px;background:white;border-radius:6px;border:1px solid #ddd;">
      <strong style="font-size:14px;">📝 Call Notes</strong>
      <p style="margin:10px 0 0;font-size:13px;line-height:1.6;">${callNotes}</p>
    </div>
    <div style="margin-top:16px;padding:16px;background:white;border-radius:6px;border:1px solid #ddd;">
      <strong style="font-size:14px;">📄 Full Transcript</strong>
      <pre style="white-space:pre-wrap;font-size:12px;margin:10px 0 0;color:#333;line-height:1.5;">${transcript}</pre>
    </div>
  </div>
</div>`;

    // Send to BOTH email addresses
    for (const toEmail of ['blivingston@nexalending.com', 'blivingston817@gmail.com']) {
      const emailContent = `To: ${toEmail}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${htmlBody}`;
      const encoder = new TextEncoder();
      const encoded = encoder.encode(emailContent);
      const raw = btoa(String.fromCharCode(...encoded)).replace(/\+/g, '-').replace(/\//g, '_');
      const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      if (!gmailRes.ok) console.error(`Gmail error (${toEmail}):`, await gmailRes.text());
      else console.log(`Email sent to ${toEmail}`);
    }

    return Response.json({ ok: true, caller: callerRaw, name: callerName, appType });
  } catch (err) {
    console.error("vapiWebhook error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
