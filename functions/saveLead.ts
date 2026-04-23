// saveLead v3 — saves call data to Jessica's MortgageLead entity (current app)
// An entity automation then syncs it to LeadFlow and MortgageFlow cross-app.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

export default async function handler(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const {
      type = "mortgage",
      phone,
      leadData = {},
      applicationData = {},
      recordingUrl,
      leadflowId,
      mortgageflowId,
    } = body;

    // ── Attach recording to existing MortgageLead record ─────────────────────
    if (recordingUrl && (leadflowId || mortgageflowId)) {
      // Find the MortgageLead record by leadflow_id or mortgageflow_id
      const query: Record<string, string> = {};
      if (leadflowId)     query.leadflow_id     = leadflowId;
      if (mortgageflowId) query.mortgageflow_id = mortgageflowId;
      
      try {
        const records = await base44.asServiceRole.entities.MortgageLead.filter(query);
        if (records && records.length > 0) {
          const record = records[0] as any;
          await base44.asServiceRole.entities.MortgageLead.update(record.id, {
            recording_url: recordingUrl,
          });
          console.log("Recording URL saved to MortgageLead:", record.id);
          return Response.json({ ok: true, results: { recording: { ok: true, id: record.id } } });
        }
      } catch (e) {
        console.error("Recording attach error:", String(e));
      }
      return Response.json({ ok: true, results: { recording: { ok: false, error: "record not found" } } });
    }

    // ── Merge lead and application data into one MortgageLead record ─────────
    const mergedName = applicationData.first_name && applicationData.last_name
      ? `${applicationData.first_name} ${applicationData.last_name}`.trim()
      : leadData.consumer || null;

    const record: Record<string, unknown> = {
      call_type: type,
      caller_phone: phone || leadData.phone || applicationData.phone || null,
      caller_name:  mergedName,
      caller_email: leadData.email || applicationData.email || null,
      loan_type:    leadData.loan_type   || applicationData.loan_type   || null,
      loan_amount:  leadData.loan_amount || applicationData.loan_amount || null,
      goal:         applicationData.goal || leadData.loan_type || null,
      property_type: applicationData.property_type || leadData.property_type || null,
      property_address: applicationData.property_address || leadData.consumer_address || null,
      property_city:    applicationData.property_address ? null : leadData.consumer_city || null,
      property_state:   leadData.consumer_state || null,
      property_zip:     leadData.consumer_zip   || null,
      amount_owed:                applicationData.amount_owed               || null,
      current_interest_rate:      leadData.current_interest_rate            || applicationData.current_interest_rate || null,
      current_mortgage_payment:   leadData.current_mortgage_payment         || applicationData.current_mortgage_payment || null,
      taxes_insurance_included:   applicationData.taxes_insurance_included  || null,
      annual_property_taxes:      applicationData.annual_property_taxes     || null,
      annual_homeowners_insurance:applicationData.annual_homeowners_insurance || null,
      employment_status:          applicationData.employment_status         || null,
      employer_name:              applicationData.employer_name             || null,
      years_employed:             applicationData.years_employed            || null,
      annual_income:              applicationData.annual_income             || null,
      years_in_business:          applicationData.years_in_business         || null,
      taxable_income_last_year:   applicationData.taxable_income_last_year  || null,
      taxable_income_year_before: applicationData.taxable_income_year_before|| null,
      self_employed_loan_type:    applicationData.self_employed_loan_type   || null,
      credit_score_range:         leadData.estimated_credit_score           || applicationData.credit_score_range || null,
      has_realtor:                applicationData.has_realtor               || null,
      down_payment:               applicationData.down_payment              || null,
      home_value:                 applicationData.home_value                || null,
      purchase_timeline:          applicationData.purchase_timeline         || null,
      notes:    leadData.notes || applicationData.notes || null,
      recording_url: recordingUrl || null,
      sync_status: "pending",
    };

    // Remove null values to keep the record clean
    const cleanRecord = Object.fromEntries(Object.entries(record).filter(([, v]) => v !== null));

    const saved = await base44.asServiceRole.entities.MortgageLead.create(cleanRecord);
    const savedId = (saved as any)?.id;
    console.log("MortgageLead saved:", savedId);

    return Response.json({ ok: true, results: { jessica: { ok: true, id: savedId } } });

  } catch (error) {
    console.error("saveLead error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
