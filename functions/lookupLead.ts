import base44 from "../.base44/sdk.ts";

export default async function handler(req: Request): Promise<Response> {
  const body = await req.json();
  const phone: string = body.phone ?? "";

  if (!phone) {
    return Response.json({ found: false, error: "No phone provided" });
  }

  const digits = phone.replace(/\D/g, "");
  const tenDigit = digits.slice(-10);
  const formats = [
    phone,
    `+1${tenDigit}`,
    `1${tenDigit}`,
    tenDigit,
    `(${tenDigit.slice(0, 3)}) ${tenDigit.slice(3, 6)}-${tenDigit.slice(6)}`,
  ];

  const LEADFLOW_APP_ID = "69cfe4f5a8d6d5273ce84a33";

  for (const fmt of formats) {
    try {
      const leads = await base44.asServiceRole.entities.Lead.filter(
        { phone: fmt },
        { app_id: LEADFLOW_APP_ID }
      );
      if (leads && leads.length > 0) {
        const lead = leads[0];
        return Response.json({
          found: true,
          name: lead.consumer ?? null,
          email: lead.email ?? null,
          address: [lead.consumer_address, lead.consumer_city, lead.consumer_state, lead.consumer_zip]
            .filter(Boolean)
            .join(", ") || null,
          loan_type: lead.loan_type ?? null,
          loan_amount: lead.loan_amount ?? null,
        });
      }
    } catch (_e) {
      // try next format
    }
  }

  return Response.json({ found: false });
}
