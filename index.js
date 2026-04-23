import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const WebSocket = _require('ws');
const WebSocketServer = WebSocket.Server;
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BRANDYN_EMAIL = 'blivingston@nexalending.com';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+18339883514';
const BASE44_API_KEY = process.env.BASE44_API_KEY;
const LEADFLOW_APP_ID = '69cfe4f5a8d6d5273ce84a33';
const JESSICA_APP_ID = '69c8bc2a8e7923547ee56685';
const BASE44_FUNC_BASE = `https://api.base44.com/api/apps/${JESSICA_APP_ID}/functions`;

// ─── Debug logs ───────────────────────────────────────────────────────────────
const debugLogs = [];
function dlog(msg) {
  const entry = `${new Date().toISOString()} | ${msg}`;
  debugLogs.push(entry);
  if (debugLogs.length > 300) debugLogs.shift();
  console.log(entry);
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
// keyed by callSid
const sessions = new Map();

// ─── LeadFlow lookup ──────────────────────────────────────────────────────────
async function lookupLeadByPhone(phone) {
  if (!BASE44_API_KEY) return null;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const digits = phone.replace(/\D/g, '');
    const ten = digits.slice(-10);
    const formats = [phone, `+1${ten}`, ten];
    for (const fmt of formats) {
      const res = await fetch(
        `https://api.base44.com/api/apps/${LEADFLOW_APP_ID}/entities/Lead?phone=${encodeURIComponent(fmt)}`,
        { headers: { 'api-key': BASE44_API_KEY }, signal: controller.signal }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const records = Array.isArray(data) ? data : data.records || [];
      if (records.length > 0) {
        const l = records[0];
        return { name: l.consumer || null, email: l.email || null };
      }
    }
  } catch (_) {}
  return null;
}

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(lead) {
  const known = lead
    ? `This caller is already in our system — Name: ${lead.name}, Email: ${lead.email}. Use their first name in your greeting. Do NOT ask for their name or email again.`
    : `This caller is not in our system. After you find out why they called, ask for their name and email before going further.`;

  return `You are Jessica, a phone intake specialist for NEXA Lending. You work for Brandyn Livingston, a senior loan officer in Arizona. You speak naturally on the phone — warm, conversational, brief. Ask only one question at a time. No filler phrases like "Great!" or "Absolutely!".

${known}

════════════════════════════════════════
GREETING — say this exactly on your very first turn:
"Thank you for calling NEXA Lending, this is Jessica. What can I help you with today?"
(If you know their name: "Hi [FirstName], thanks for calling NEXA Lending — this is Jessica. What can I help you with today?")
Then STOP. Do not say anything else. Wait for them to respond.

CRITICAL RULE: Do NOT mention mortgages, loans, rates, refinancing, down payment assistance, or any financial product until the caller tells you why they called.

════════════════════════════════════════
STEP 1 — LISTEN AND ROUTE

After they speak, decide which path applies:

A) MORTGAGE / REFI — they mention: mortgage, refinance, refi, cash-out, home equity, interest rate, lower my payment, loan, HELOC
   → Go to MORTGAGE INTAKE

B) PURCHASE / HOME BUYING — they mention: buying a home, purchasing, first-time buyer, looking for a home, pre-approval, down payment
   → Ask: "Are you interested in seeing if you qualify for any Down Payment Assistance programs?"
     • YES → Go to DPA INTAKE
     • NO  → Go to PURCHASE INTAKE (standard)

C) REALTOR / PARTNER — they mention: realtor, agent, broker, referral, partner program, BDM, business development
   → Go to BDM INTAKE

D) VAGUE / CONFUSED / SHORT / "I don't know" / "someone called me" / silence:
   → Ask ONLY: "Are you a homeowner right now?"
     • YES → Go straight to MORTGAGE INTAKE — start with: "Got it. What are you hoping to accomplish financially — are you looking to lower your payment, pull out some cash, or something else?"
     • NO  → "Are you thinking about buying a home?"
         - YES → "Would you like to see if you qualify for any Down Payment Assistance programs?" → DPA INTAKE or PURCHASE INTAKE
         - NO  → "Are you a real estate agent or in the real estate industry?" → If yes: BDM INTAKE
         - If none of the above → "No problem — can I take a message for Brandyn?" → PERSONAL / MESSAGE

E) PERSONAL — they know Brandyn personally, or it's a personal matter, or they just want to leave a message:
   → "Of course — I can take a message for him. What would you like me to pass along?"
   → Take their name and message. Tell them Brandyn will get back to them.
   → Output the token [CALL_TYPE: Personal] silently.

F) ASKS FOR BRANDYN OR A LIVE PERSON:
   → "Brandyn is with clients right now, but I'll make sure he gets your information right away. What's the best time for him to call you back?"
   → Take their name, number if different, and preferred callback time.
   → Tell them Brandyn will reach out at that time.
   → Output the token [CALL_TYPE: Callback Request] silently.

════════════════════════════════════════
MORTGAGE INTAKE — one question at a time, skip if already known:

1. Full name + email (if not already collected)
2. "What are you hoping to accomplish — and roughly how much cash are you looking to get out?"
3. "What do you currently owe on the home?"
4. "What's your current interest rate?"
5. "What's your current monthly mortgage payment?"
6. "Do you escrow your property taxes and homeowners insurance in that payment?"
   → YES or NO: "How much do you pay per year on property taxes?" and "How much per year on homeowners insurance?"
7. Employment:
   → "Where do you work, how long have you been there, and what's your position?"
   → "What's your annual income?"
   → If self-employed: "How long have you been self-employed?" / "What was your taxable income last year after deductions?" / "And the year before?" 
      (Note: If they write off a lot → mention: "We actually have loan programs specifically for that — Bank Statement Loans where we use your last 12 months of deposits as income, or a P&L Statement Loan signed by your CPA.")
   → If retired: "Are you on Social Security, a pension, or both? How much per month?"
   → If disabled: "Are you receiving SSDI or VA benefits? How much per month? Are you a veteran?"

Wrap up: "Perfect — I've got everything I need. Brandyn will review this and reach out to you shortly."
Output [CALL_TYPE: Mortgage] silently.

════════════════════════════════════════
PURCHASE INTAKE — one question at a time, skip if already known:

1. Full name + email (if not already collected)
2. "What state and city are you looking to buy in?"
3. "What price range are you thinking?"
4. "Have you been pre-approved anywhere yet?"
5. "Do you already have a realtor?"
6. "What's your credit score range — are you roughly 740 or above, 680 to 739, 620 to 679, or below 620?"
7. "How much do you have saved for a down payment?"
8. Employment (same as mortgage intake above)

Wrap up: "Great — Brandyn will be in touch with you soon."
Output [CALL_TYPE: Purchase] silently.

════════════════════════════════════════
DPA INTAKE — Down Payment Assistance eligibility screening:

Explain briefly: "I'm going to ask you a few quick questions to see which Down Payment Assistance programs you may qualify for."

Ask one at a time:
1. Full name + email (if not already collected)
2. "What state are you buying in?" (focus: AZ, AL, GA, LA, CA, MI — but collect for any state)
3. "What county or city?"
4. "Will this be your primary residence?"
5. "Have you owned a home in the last 3 years?"
6. "Are you a veteran or active military?"
7. "Is this your first time buying a home?" (If no: "Are you a first-generation homebuyer — meaning neither of your parents ever owned a home?")
8. "How many people are in your household, including yourself?"
9. "What is your total annual household income from all sources?"
10. "What's your estimated credit score?"
11. "What purchase price range are you looking at?"
12. Employment (same as mortgage intake)

Wrap up: "Thank you — I have everything I need to check your eligibility. Brandyn will go over the available programs with you and reach out shortly."
Output [CALL_TYPE: DPA] silently.

════════════════════════════════════════
BDM INTAKE — one question at a time:

1. Full name + email
2. "What's your brokerage or company?"
3. "How long have you been in the business?"
4. "Which states are you licensed in?"
5. "About how many transactions do you close per year?"
6. "What's your average loan amount?"
7. "Are you currently referring loans to a lender?"
8. "What got you interested in NEXA's partner program?"
9. "What's the best time for Brandyn to call you back?"

If they are ONLY licensed in Arizona or New York:
→ Still collect everything. Say "I'll pass your info along — someone will reach out to discuss what options are available for your market."
→ Output [CALL_TYPE: BDM - Out of State] silently.

Otherwise: "I've got everything — someone from our team will be in touch with you soon!"
Output [CALL_TYPE: BDM] silently.

════════════════════════════════════════
RULES:
- Never read the [CALL_TYPE: ...] tokens out loud. They are silent system signals only.
- Never promise specific rates, numbers, or program approvals.
- Never say you are transferring anyone.
- If a caller hangs up mid-conversation, that is okay — the system will still log the call.
- Keep responses short and conversational. This is a phone call, not an email.
- PACING — After the caller answers a question, always give a brief natural acknowledgment before asking the next one. Use short phrases like: "Got it.", "Okay.", "Perfect.", "Sure.", "Alright.", "Mm-hmm." — then pause ONE beat, THEN ask the next question. This keeps the conversation flowing naturally without feeling robotic or rushed.
- Do NOT skip the acknowledgment and jump straight to the next question. It sounds cold.
- Do NOT over-acknowledge with long sentences like "That's great to hear!" — just one or two words max.`;
}

// ─── GPT-4o ───────────────────────────────────────────────────────────────────
async function chatWithGPT(messages, systemPrompt, attempt = 0) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'system', content: systemPrompt }, ...messages.slice(-12)],
        temperature: 0.2,
        max_tokens: 80,
      }),
    });
    if (response.status === 429 && attempt === 0) {
      dlog('OpenAI 429 rate limit — retrying in 2s');
      await new Promise(r => setTimeout(r, 2000));
      return chatWithGPT(messages, systemPrompt, 1);
    }
    const data = await response.json();
    if (data.error) {
      dlog(`OpenAI API error: ${data.error.message}`);
      return null;
    }
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('GPT error:', err);
    return null;
  }
}

// ─── Email ────────────────────────────────────────────────────────────────────
async function sendEmailViaProxy(to, subject, html) {
  try {
    const res = await fetch(`${BASE44_FUNC_BASE}/sendEmailProxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BASE44_API_KEY },
      body: JSON.stringify({ to, subject, html }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) { console.error('sendEmailProxy error:', result); return false; }
    dlog(`Email sent to ${to}`);
    return true;
  } catch (err) {
    console.error('sendEmailViaProxy error:', err);
    return false;
  }
}

async function sendCallSummaryEmail(session) {
  const { callerPhone, leadInfo, messages, callType, callStartTime } = session;
  const callerName = leadInfo?.name || 'Unknown';
  const callerEmail = leadInfo?.email || 'N/A';
  const callTime = (callStartTime || new Date()).toLocaleString('en-US', { timeZone: 'America/Phoenix' });

  const transcript = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'assistant' ? 'Jessica' : 'Caller'}: ${m.content}`)
    .join('\n');

  const htmlTranscript = transcript.split('\n').map(line => {
    if (line.startsWith('Jessica:')) return `<p><strong style="color:#1a56db">Jessica:</strong> ${line.slice(9)}</p>`;
    if (line.startsWith('Caller:')) return `<p><strong style="color:#0e7a4e">Caller:</strong> ${line.slice(8)}</p>`;
    return `<p>${line}</p>`;
  }).join('') || '<p style="color:#888;">No conversation recorded — caller may have hung up immediately.</p>';

  const callTypeLabel = callType || 'Unknown';
  const badgeColor = {
    'Mortgage': '#1a56db',
    'Purchase': '#0e7a4e',
    'DPA': '#7e3af2',
    'BDM': '#c27803',
    'BDM - Out of State': '#9b1c1c',
    'Personal': '#374151',
    'Callback Request': '#1c64f2',
  }[callTypeLabel] || '#6b7280';

  const html = `
<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
  <div style="background:#1a3a6b;color:white;padding:20px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0">📞 NEXA Lending — Inbound Call</h2>
    <p style="margin:5px 0 0;opacity:0.8;">${callTime} (Arizona Time)</p>
  </div>
  <div style="background:#f4f6fb;padding:20px;border-radius:0 0 8px 8px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:8px;border-bottom:1px solid #ddd;width:40%;"><strong>Caller Phone</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${callerPhone}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Caller Name</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${callerName}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Email</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${callerEmail}</td></tr>
      <tr><td style="padding:8px;"><strong>Call Type</strong></td><td style="padding:8px;"><span style="background:${badgeColor};color:white;padding:3px 10px;border-radius:12px;font-size:13px;">${callTypeLabel}</span></td></tr>
    </table>
    <h3 style="border-bottom:2px solid #1a3a6b;padding-bottom:8px;">📋 Conversation</h3>
    <div style="background:white;padding:15px;border-radius:6px;border:1px solid #ddd;font-size:14px;line-height:1.7;">
      ${htmlTranscript}
    </div>
    <p style="color:#888;font-size:12px;margin-top:15px;">Generated automatically by Jessica — NEXA Lending AI</p>
  </div>
</div>`;

  const subject = `📞 ${callTypeLabel} Call — ${callerName} | ${callerPhone} | ${callTime}`;
  return sendEmailViaProxy(BRANDYN_EMAIL, subject, html);
}

// ─── Save lead to Base44 ──────────────────────────────────────────────────────
async function saveLeadToBase44(session) {
  try {
    const { callerPhone, leadInfo, messages, callType } = session;
    const transcript = messages.filter(m => m.role !== 'system').map(m => `${m.role === 'assistant' ? 'Jessica' : 'Caller'}: ${m.content}`).join('\n');

    const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.1,
        max_tokens: 600,
        messages: [
          { role: 'system', content: `Extract data from this call transcript. Return ONLY valid JSON with these fields (use null if not mentioned): caller_name, caller_email, goal, amount_owed, current_interest_rate, current_mortgage_payment, taxes_insurance_included, annual_property_taxes, annual_homeowners_insurance, employment_status, employer_name, years_employed, annual_income, credit_score_range, down_payment, property_state, property_city, purchase_timeline, notes` },
          { role: 'user', content: `Phone: ${callerPhone}\nCall type: ${callType}\nKnown: ${JSON.stringify(leadInfo)}\n\nTranscript:\n${transcript}` }
        ],
      }),
    });
    const extractData = await extractRes.json();
    const raw = extractData.choices?.[0]?.message?.content?.trim();
    const match = raw?.match(/\{[\s\S]*\}/);
    const e = match ? JSON.parse(match[0]) : {};

    const record = {
      call_type: callType || 'Unknown',
      caller_phone: callerPhone,
      caller_name: e.caller_name || leadInfo?.name || null,
      caller_email: e.caller_email || leadInfo?.email || null,
      goal: e.goal || null,
      amount_owed: e.amount_owed || null,
      current_interest_rate: e.current_interest_rate || null,
      current_mortgage_payment: e.current_mortgage_payment || null,
      taxes_insurance_included: e.taxes_insurance_included || null,
      annual_property_taxes: e.annual_property_taxes || null,
      annual_homeowners_insurance: e.annual_homeowners_insurance || null,
      employment_status: e.employment_status || null,
      employer_name: e.employer_name || null,
      years_employed: e.years_employed || null,
      annual_income: e.annual_income || null,
      credit_score_range: e.credit_score_range || null,
      down_payment: e.down_payment || null,
      property_state: e.property_state || null,
      property_city: e.property_city || null,
      purchase_timeline: e.purchase_timeline || null,
      call_transcript: transcript,
      notes: e.notes || null,
    };

    const saveRes = await fetch(`https://api.base44.com/api/apps/${JESSICA_APP_ID}/entities/MortgageLead`, {
      method: 'POST',
      headers: { 'api-key': BASE44_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (saveRes.ok) dlog(`Lead saved for ${callerPhone}`);
    else dlog(`Lead save error: ${await saveRes.text()}`);
  } catch (err) {
    console.error('saveLeadToBase44 error:', err);
  }
}

// ─── End of call ──────────────────────────────────────────────────────────────
async function processEndOfCall(session) {
  try {
    dlog(`End-of-call processing for ${session.callerPhone}`);
    await Promise.all([
      sendCallSummaryEmail(session),
      saveLeadToBase44(session),
    ]);
    dlog(`End-of-call complete for ${session.callerPhone}`);
  } catch (err) {
    console.error('processEndOfCall error:', err);
  }
}

// ─── Strip silent tokens from AI response ─────────────────────────────────────
function stripTokens(text) {
  return text
    .replace(/\[CALL_TYPE:[^\]]*\]/g, '')
    .replace(/\[INTAKE_COMPLETE\]/g, '')
    .replace(/\[BDM_INTAKE_COMPLETE\]/g, '')
    .replace(/\[BDM_OUT_OF_STATE\]/g, '')
    .replace(/\[MESSAGE_FOR_BRANDYN\]/g, '')
    .trim();
}

// ─── Detect call type from AI response tokens ──────────────────────────────────
function detectCallType(text) {
  const match = text.match(/\[CALL_TYPE:\s*([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

// ─── Fastify ──────────────────────────────────────────────────────────────────
const fastify = Fastify({ logger: false });
fastify.register(fastifyFormBody);

fastify.get('/', async () => ({ status: 'Jessica — NEXA Lending AI (ConversationRelay)', ts: new Date().toISOString() }));
fastify.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));
fastify.get('/debug-logs', async () => ({ logs: debugLogs.slice(-100) }));

// ─── Incoming call → ConversationRelay TwiML ──────────────────────────────────
fastify.post('/incoming-call', async (req, reply) => {
  const callSid = req.body?.CallSid || `unknown-${Date.now()}`;
  const callerPhone = req.body?.From || 'unknown';
  dlog(`Incoming call from ${callerPhone}, SID: ${callSid}`);

  sessions.set(callSid, {
    callerPhone,
    leadInfo: null,
    messages: [],
    callType: null,
    callStartTime: new Date(),
    endOfCallProcessed: false,
  });

  // Kick off lead lookup in background
  lookupLeadByPhone(callerPhone).then(lead => {
    if (sessions.has(callSid)) {
      sessions.get(callSid).leadInfo = lead;
      dlog(`Lead lookup for ${callerPhone}: ${lead ? lead.name : 'not found'}`);
    }
  });

  const host = req.headers.host;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="https://${host}/call-status" method="POST">
    <ConversationRelay url="wss://${host}/conversation-relay"
      welcomeGreeting=" "
      ttsProvider="google"
      voice="en-US-Neural2-F"
      transcriptionProvider="google"
      speechModel="telephony"
      dtmfDetection="true" />
  </Connect>
</Response>`;

  reply.header('Content-Type', 'text/xml');
  return twiml;
});

// ─── Call status webhook ───────────────────────────────────────────────────────
fastify.post('/call-status', async (req, reply) => {
  const callSid = req.body?.CallSid;
  const status = req.body?.CallStatus;
  dlog(`Call status: ${callSid} → ${status}`);
  if (['completed', 'no-answer', 'busy', 'failed'].includes(status) && sessions.has(callSid)) {
    const session = sessions.get(callSid);
    if (!session.endOfCallProcessed) {
      session.endOfCallProcessed = true;
      await processEndOfCall(session);
    }
    sessions.delete(callSid);
  }
  return { ok: true };
});

// ─── ConversationRelay WebSocket ───────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  let callSid = null;
  let session = null;
  dlog('ConversationRelay WS connected');

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      dlog(`CR msg type: ${msg.type}`);

      // ── Setup ──────────────────────────────────────────────────────────────
      if (msg.type === 'setup') {
        callSid = msg.callSid;
        session = sessions.get(callSid);
        if (!session) {
          session = {
            callerPhone: msg.from || 'unknown',
            leadInfo: null,
            messages: [],
            callType: null,
            callStartTime: new Date(),
            endOfCallProcessed: false,
          };
          sessions.set(callSid, session);
        }
        dlog(`CR setup — callSid: ${callSid}, from: ${session.callerPhone}`);

        // Wait for lead lookup (max 1 second)
        await new Promise(r => setTimeout(r, 1000));

        // Build system prompt now that we (may) have lead info
        session.systemPrompt = buildSystemPrompt(session.leadInfo);

        // Send greeting
        const firstName = session.leadInfo?.name?.split(' ')[0];
        const greeting = firstName
          ? `Hi ${firstName}, thanks for calling NEXA Lending — this is Jessica. What can I help you with today?`
          : `Thank you for calling NEXA Lending, this is Jessica. What can I help you with today?`;

        session.messages.push({ role: 'assistant', content: greeting });
        ws.send(JSON.stringify({ type: 'text', token: greeting, last: true }));
        return;
      }

      // ── Caller spoke ───────────────────────────────────────────────────────
      if (msg.type === 'prompt') {
        const userText = (msg.voicePrompt || '').trim();
        if (!userText || !session) return;

        dlog(`Caller said: "${userText}"`);
        session.messages.push({ role: 'user', content: userText });

        // Get GPT-4o response
        const aiRaw = await chatWithGPT(session.messages, session.systemPrompt);
        dlog(`Jessica raw: "${aiRaw}"`);

        // If GPT returned null (rate limit / error), pick a smart bridge phrase
        if (!aiRaw) {
          dlog('GPT returned null — using fallback bridge');
          // Figure out where we are in the conversation and ask the next logical question
          const msgCount = session.messages.length;
          const lastAssistant = session.messages.slice().reverse().find(m => m.role === 'assistant')?.content || '';
          let fallback;
          if (msgCount <= 4) {
            fallback = "Got it — are you a homeowner right now?";
          } else if (lastAssistant.includes('homeowner')) {
            fallback = "Do you have any outstanding debt — like credit cards or car loans?";
          } else if (lastAssistant.includes('owe') || lastAssistant.includes('balance')) {
            fallback = "And what's your current interest rate?";
          } else if (lastAssistant.includes('interest rate') || lastAssistant.includes('rate')) {
            fallback = "What's your current monthly mortgage payment?";
          } else if (lastAssistant.includes('payment')) {
            fallback = "Do you escrow your property taxes and insurance in that payment?";
          } else if (lastAssistant.includes('tax') || lastAssistant.includes('escrow')) {
            fallback = "And where do you work?";
          } else if (lastAssistant.includes('work') || lastAssistant.includes('employ')) {
            fallback = "What's your annual income?";
          } else {
            fallback = "Got it — and can I get your full name and best email?";
          }
          dlog("Fallback reply: " + fallback);
          session.messages.push({ role: 'assistant', content: fallback });
          ws.send(JSON.stringify({ type: 'text', token: fallback, last: true }));
          return;
        }

        // Detect and store call type from token
        const detectedType = detectCallType(aiRaw);
        if (detectedType && !session.callType) {
          session.callType = detectedType;
          dlog(`Call type set: ${session.callType}`);
        }

        const visibleReply = stripTokens(aiRaw);
        session.messages.push({ role: 'assistant', content: visibleReply });

        ws.send(JSON.stringify({ type: 'text', token: visibleReply, last: true }));
        return;
      }

      // ── DTMF ──────────────────────────────────────────────────────────────
      if (msg.type === 'dtmf') {
        dlog(`DTMF digit: ${msg.digit}`);
      }

      // ── Call ended via WS ──────────────────────────────────────────────────
      if (msg.type === 'end') {
        dlog(`CR end event for ${callSid}`);
        if (session && !session.endOfCallProcessed) {
          session.endOfCallProcessed = true;
          await processEndOfCall(session);
        }
      }

    } catch (err) {
      dlog(`WS error: ${err.message}`);
    }
  });

  ws.on('close', () => dlog('CR WS closed'));
  ws.on('error', (err) => dlog(`CR WS error: ${err.message}`));
});

// ─── HTTP server + WS upgrade ─────────────────────────────────────────────────
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  dlog(`Jessica bridge running on port ${PORT} — ConversationRelay mode`);
});

fastify.server.on('upgrade', (req, sock, head) => {
  if (req.url === '/conversation-relay') {
    wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws, req));
  } else {
    sock.destroy();
  }
});
