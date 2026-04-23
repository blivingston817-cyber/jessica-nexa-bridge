import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import WebSocket, { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BRANDYN_CELL = '+12147897527';
const BRANDYN_EMAIL = 'blivingston@nexalending.com';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+18339883514';
const BASE44_API_KEY = process.env.BASE44_API_KEY;
const LEADFLOW_APP_ID = '69cfe4f5a8d6d5273ce84a33';
const JESSICA_APP_ID = '69c8bc2a8e7923547ee56685';
const NEXA_HOLD_MUSIC = 'https://base44.app/api/apps/69c8bc2a8e7923547ee56685/files/mp/public/69c8bc2a8e7923547ee56685/65e491f5f_80af02a76_NexaWay.mp3';
const SERVER_URL = process.env.SERVER_URL || 'https://jessica-nexa-bridge.onrender.com';
const BASE44_FUNC_BASE = `https://api.base44.com/api/apps/${JESSICA_APP_ID}/functions`;

// ─── Debug log ring buffer ────────────────────────────────────────────────────
const debugLogs = [];
function dlog(msg) {
  const entry = `${new Date().toISOString()} | ${msg}`;
  debugLogs.push(entry);
  if (debugLogs.length > 200) debugLogs.shift();
  console.log(entry);
}

// ─── LeadFlow lookup (with 5s timeout) ───────────────────────────────────────
async function lookupLeadByPhone(phone) {
  if (!BASE44_API_KEY) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const digits = phone.replace(/\D/g, '');
    const tenDigit = digits.slice(-10);
    const formats = [phone, `+1${tenDigit}`, `1${tenDigit}`, tenDigit,
      `(${tenDigit.slice(0,3)}) ${tenDigit.slice(3,6)}-${tenDigit.slice(6)}`];
    for (const fmt of formats) {
      try {
        const res = await fetch(
          `https://api.base44.com/api/apps/${LEADFLOW_APP_ID}/entities/Lead?phone=${encodeURIComponent(fmt)}`,
          { headers: { 'api-key': BASE44_API_KEY, 'Content-Type': 'application/json' }, signal: controller.signal }
        );
        if (!res.ok) continue;
        const data = await res.json();
        const records = Array.isArray(data) ? data : data.records || [];
        if (records.length > 0) {
          clearTimeout(timeout);
          const lead = records[0];
          return {
            found: true,
            name: lead.consumer || null,
            email: lead.email || null,
            address: [lead.consumer_address, lead.consumer_city, lead.consumer_state, lead.consumer_zip]
              .filter(Boolean).join(', ') || null,
            loan_type: lead.loan_type || null,
            loan_amount: lead.loan_amount || null,
          };
        }
      } catch (innerErr) {
        if (innerErr.name === 'AbortError') break;
      }
    }
    clearTimeout(timeout);
  } catch (err) {
    console.error('LeadFlow lookup error:', err);
  }
  return null;
}

// ─── System prompt builder ────────────────────────────────────────────────────
function buildSystemPrompt(lead) {
  const knownInfo = lead
    ? `
CALLER INFO FROM OUR DATABASE:
- Name: ${lead.name || 'unknown'}
- Email: ${lead.email || 'unknown'}
- Address: ${lead.address || 'unknown'}
- Loan type of interest: ${lead.loan_type || 'unknown'}
${lead.loan_amount ? `- Loan amount of interest: ${lead.loan_amount}` : ''}

Since we already have their basic info, DO NOT ask for their name, address, or email.
Greet them by their first name if available. Confirm we have them on file and jump straight into the financial intake questions.`
    : `
We do NOT have this caller in our database. You will need to collect their basic info first:
1. What is your full name?
2. What is your email address?
Then continue with the financial intake questions below.`;

  return `You are Jessica, a professional and friendly mortgage intake agent for NEXA Lending. Your job is to gather important financial information from callers so that a loan officer can follow up with them. Be warm, conversational, and patient. Ask one question at a time. Keep your responses concise and natural — this is a phone call. Do NOT thank the caller after every answer (no "Great!", "Thank you!", "Perfect!", "Awesome!" etc.). Just acknowledge briefly and move naturally to the next question. Only use affirmations occasionally if it genuinely fits the flow.
${knownInfo}

OPENING FLOW:
- Greet the caller warmly. If you know their name, use it.
- Most callers are calling back because they recently received a call from NEXA Lending. If they mention they got a call, or if they seem unsure why they are calling, say something like: "Yes! We recently reached out because it looks like you had inquired about some mortgage options. I just wanted to follow up and see how we could help. Do you have a couple of minutes for me to ask a few quick questions so we can find the best solution for you?"
- Then naturally transition into the intake questions below.

FINANCIAL INTAKE QUESTIONS (ask one at a time):
1. What are your financial goals, and how much cash are you looking to access?
2. What do you currently owe on your home?
3. What is your current interest rate?
4. What is your current monthly mortgage payment?
5. Do you escrow your property taxes and homeowners insurance?
   - How much do you spend per year on property taxes?
   - How much do you spend per year on homeowners insurance?
6. Where do you currently work?
7. How long have you been working there?
8. What is your current position/title?
9. What is your annual salary?

Based on their employment situation:
- If SELF-EMPLOYED: How long self-employed? Taxable income last year (after deductions)? Year before that? (If they write off a lot, mention NEXA has Bank Statement Loans or P&L Statement Loans signed by a CPA.)
- If RETIRED: Social Security, pension, or both? How much per month?
- If DISABLED: SSDI or VA benefits? How much per month? Are they a veteran?

HANDOFF RULES — THIS IS YOUR MOST IMPORTANT INSTRUCTION:
When you finish collecting all intake info, OR if the caller asks to speak to a real person at any point, do EXACTLY this:
Step 1: Say ONLY these three words out loud: "One moment please."
Step 2: Output the exact text: TRANSFER_TO_LOAN_OFFICER

THAT IS ALL. Not one extra word before or after "One moment please."

ABSOLUTELY FORBIDDEN — never say any of these:
- "transfer" or "transferring"
- "connect" or "connecting you"
- "Brandyn"
- "loan officer"
- "specialist"
- "colleague"
- "someone who can help"
- "let me get someone"
- Any phrase implying a person is coming

This rule overrides everything else. "One moment please." — then TRANSFER_TO_LOAN_OFFICER. Nothing more.`;
}

// ─── Extract lead info from transcript using GPT ─────────────────────────────
async function extractLeadDataFromTranscript(transcript, callerPhone, leadInfo) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Extract mortgage intake data from this call transcript. Return ONLY a valid JSON object with these fields (use null for anything not mentioned):
{
  "caller_name": string,
  "caller_email": string,
  "goal": string,
  "amount_owed": string,
  "current_interest_rate": string,
  "current_mortgage_payment": string,
  "taxes_insurance_included": "Yes" | "No" | null,
  "annual_property_taxes": string,
  "annual_homeowners_insurance": string,
  "employment_status": "Employed" | "Self-Employed" | "Retired" | "Disabled" | null,
  "employer_name": string,
  "years_employed": string,
  "annual_income": string,
  "years_in_business": string,
  "taxable_income_last_year": string,
  "taxable_income_year_before": string,
  "notes": string
}
Return ONLY the JSON object, no markdown, no explanation.`
          },
          {
            role: 'user',
            content: `Caller phone: ${callerPhone}\nKnown info: ${JSON.stringify(leadInfo)}\n\nTranscript:\n${transcript}`
          }
        ],
        max_tokens: 500,
        temperature: 0.1,
      }),
    });
    const result = await response.json();
    const raw = result.choices?.[0]?.message?.content?.trim();
    if (!raw) return {};
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch (err) {
    console.error('Extract lead data error:', err);
    return {};
  }
}

// ─── Save lead to Base44 MortgageLead entity ─────────────────────────────────
async function saveLeadToBase44(callerPhone, transcript, leadInfo, callType = 'mortgage', extraData = {}) {
  try {
    const extracted = await extractLeadDataFromTranscript(transcript, callerPhone, leadInfo);
    dlog(`Extracted lead data: ${JSON.stringify(extracted)}`);

    const record = {
      call_type: callType,
      caller_phone: callerPhone,
      caller_name: extracted.caller_name || leadInfo?.name || null,
      caller_email: extracted.caller_email || leadInfo?.email || null,
      goal: extracted.goal || null,
      amount_owed: extracted.amount_owed || null,
      current_interest_rate: extracted.current_interest_rate || null,
      current_mortgage_payment: extracted.current_mortgage_payment || null,
      taxes_insurance_included: extracted.taxes_insurance_included || null,
      annual_property_taxes: extracted.annual_property_taxes || null,
      annual_homeowners_insurance: extracted.annual_homeowners_insurance || null,
      employment_status: extracted.employment_status || null,
      employer_name: extracted.employer_name || null,
      years_employed: extracted.years_employed || null,
      annual_income: extracted.annual_income || null,
      years_in_business: extracted.years_in_business || null,
      taxable_income_last_year: extracted.taxable_income_last_year || null,
      taxable_income_year_before: extracted.taxable_income_year_before || null,
      notes: extracted.notes || null,
      call_transcript: transcript,
      sync_status: 'pending',
      ...extraData,
    };

    // Remove null values
    const cleanRecord = Object.fromEntries(Object.entries(record).filter(([, v]) => v !== null && v !== undefined && v !== ''));

    const res = await fetch(`https://api.base44.com/api/apps/${JESSICA_APP_ID}/entities/MortgageLead`, {
      method: 'POST',
      headers: { 'api-key': BASE44_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanRecord),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Base44 MortgageLead save error:', errText);
      return null;
    }

    const saved = await res.json();
    dlog(`MortgageLead saved: ${saved?.id}`);
    return saved?.id || null;
  } catch (err) {
    console.error('saveLeadToBase44 error:', err);
    return null;
  }
}

// ─── Send email via sendEmailProxy backend function ───────────────────────────
async function sendEmailViaProxy(to, subject, html) {
  try {
    const res = await fetch(`${BASE44_FUNC_BASE}/sendEmailProxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BASE44_API_KEY,
      },
      body: JSON.stringify({ to, subject, html }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      console.error(`sendEmailProxy error (${res.status}):`, result);
      return false;
    }
    dlog(`Email sent to ${to} — id: ${result.messageId}`);
    return true;
  } catch (err) {
    console.error('sendEmailViaProxy error:', err);
    return false;
  }
}

// ─── Build and send call summary email ───────────────────────────────────────
async function sendCallSummaryEmail(callerPhone, transcript, leadInfo, callType = 'mortgage') {
  try {
    const callerName = leadInfo?.name || 'Unknown Caller';
    const callerEmail = leadInfo?.email || 'N/A';
    const callTime = new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' });

    const htmlTranscript = transcript
      .split('\n')
      .map(line => {
        if (line.startsWith('Jessica:')) return `<p><strong style="color:#1a56db">Jessica:</strong> ${line.replace('Jessica: ', '')}</p>`;
        if (line.startsWith('Caller:')) return `<p><strong style="color:#0e7a4e">Caller:</strong> ${line.replace('Caller: ', '')}</p>`;
        return `<p>${line}</p>`;
      })
      .join('');

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
  <div style="background:#1a3a6b; color:white; padding:20px; border-radius:8px 8px 0 0;">
    <h2 style="margin:0">📞 NEXA Lending — Inbound Call Summary</h2>
    <p style="margin:5px 0 0; opacity:0.8;">${callTime} (Arizona Time)</p>
  </div>
  <div style="background:#f4f6fb; padding:20px; border-radius:0 0 8px 8px;">
    <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
      <tr><td style="padding:8px; border-bottom:1px solid #ddd;"><strong>Caller Name</strong></td><td style="padding:8px; border-bottom:1px solid #ddd;">${callerName}</td></tr>
      <tr><td style="padding:8px; border-bottom:1px solid #ddd;"><strong>Phone</strong></td><td style="padding:8px; border-bottom:1px solid #ddd;">${callerPhone}</td></tr>
      <tr><td style="padding:8px; border-bottom:1px solid #ddd;"><strong>Email</strong></td><td style="padding:8px; border-bottom:1px solid #ddd;">${callerEmail}</td></tr>
      <tr><td style="padding:8px;"><strong>Call Type</strong></td><td style="padding:8px;">${callType === 'transfer' ? '🔄 Transferred to Brandyn' : '📝 Intake Completed'}</td></tr>
    </table>
    <h3 style="border-bottom:2px solid #1a3a6b; padding-bottom:8px;">📋 Call Transcript</h3>
    <div style="background:white; padding:15px; border-radius:6px; border:1px solid #ddd; max-height:500px; overflow-y:auto; font-size:14px; line-height:1.6;">
      ${htmlTranscript || '<p style="color:#888;">No transcript available.</p>'}
    </div>
    <p style="color:#888; font-size:12px; margin-top:15px;">This summary was generated automatically by Jessica, your NEXA AI assistant.</p>
  </div>
</div>`;

    const subject = callType === 'transfer'
      ? `📞 Live Transfer — ${callerName} | ${callerPhone}`
      : `📋 Call Summary — ${callerName} | ${callerPhone}`;

    return await sendEmailViaProxy(BRANDYN_EMAIL, subject, html);
  } catch (err) {
    console.error('sendCallSummaryEmail error:', err);
    return false;
  }
}

// ─── Send SMS via Twilio ──────────────────────────────────────────────────────
async function sendSMS(to, body) {
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Body: body }),
    });
    const result = await res.json();
    dlog(`SMS sent to ${to}: ${result.sid || result.message}`);
    return result.sid ? true : false;
  } catch (err) {
    console.error('sendSMS error:', err);
    return false;
  }
}

// ─── Initiate transfer: redirect the live call to /transfer endpoint ──────────
async function initiateTransfer(callSid) {
  try {
    const transferUrl = `${SERVER_URL}/transfer`;
    const formData = new URLSearchParams();
    formData.append('Url', transferUrl);
    formData.append('Method', 'POST');
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
      }
    );
    const result = await response.json();
    dlog(`Transfer redirect initiated: ${result.status}`);
  } catch (err) {
    console.error('Transfer error:', err);
  }
}

// ─── Post-call processing ─────────────────────────────────────────────────────
async function processEndOfCall(session, callType = 'mortgage') {
  try {
    const { callerNumber, conversationHistory, leadInfo } = session;
    const transcript = (conversationHistory || [])
      .map(m => `${m.role === 'assistant' ? 'Jessica' : 'Caller'}: ${m.text}`)
      .join('\n');

    if (!transcript || transcript.trim().length < 20) {
      dlog('Skipping post-call — transcript too short');
      return;
    }

    dlog(`Processing end-of-call for ${callerNumber} (${callType})`);

    // 1. Save lead to Base44 (parallel with email)
    const [savedId] = await Promise.all([
      saveLeadToBase44(callerNumber, transcript, leadInfo, callType),
      sendCallSummaryEmail(callerNumber, transcript, leadInfo, callType),
    ]);

    dlog(`End-of-call complete — MortgageLead ID: ${savedId}`);
  } catch (err) {
    console.error('processEndOfCall error:', err);
  }
}

// ─── Fastify setup ────────────────────────────────────────────────────────────
const fastify = Fastify({ logger: true });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const sessions = new Map();

fastify.get('/', async () => ({ status: 'Jessica - NEXA Lending AI Agent is running', ts: new Date().toISOString() }));
fastify.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));
fastify.get('/debug-logs', async () => ({ logs: debugLogs.slice(-50) }));

// ─── Incoming call → start media stream ──────────────────────────────────────
fastify.post('/incoming-call', async (req, reply) => {
  const callSid = req.body?.CallSid || 'unknown';
  const callerNumber = req.body?.From || 'unknown';
  dlog(`Incoming call from ${callerNumber}, SID: ${callSid}`);
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${req.headers.host}/media-stream">
      <Parameter name="callSid" value="${callSid}" />
      <Parameter name="callerNumber" value="${callerNumber}" />
    </Stream>
  </Connect>
</Response>`;
  reply.header('Content-Type', 'text/xml');
  return twiml;
});

// ─── Call status webhook ──────────────────────────────────────────────────────
fastify.post('/call-status', async (req, reply) => {
  const callSid = req.body?.CallSid;
  const status = req.body?.CallStatus;
  dlog(`Call ${callSid} status: ${status}`);
  if (status === 'completed' && sessions.has(callSid)) {
    const session = sessions.get(callSid);
    // Only process if not already handled by transfer flow
    if (!session.transferProcessed) {
      await processEndOfCall(session, 'mortgage');
    }
    sessions.delete(callSid);
  }
  return { ok: true };
});

// ─── /transfer — bridge call to Brandyn with hold music ──────────────────────
fastify.post('/transfer', async (req, reply) => {
  const callSid = req.query?.callSid || req.body?.CallSid;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" callerId="${TWILIO_PHONE_NUMBER}" action="${SERVER_URL}/transfer-fallback" method="POST" waitUrl="${SERVER_URL}/hold-music" waitMethod="GET">
    <Number>${BRANDYN_CELL}</Number>
  </Dial>
</Response>`;
  reply.header('Content-Type', 'text/xml');
  return twiml;
});

// ─── /hold-music ─────────────────────────────────────────────────────────────
fastify.get('/hold-music', async (req, reply) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play loop="10">${NEXA_HOLD_MUSIC}</Play>
</Response>`;
  reply.header('Content-Type', 'text/xml');
  return twiml;
});

fastify.post('/hold-music', async (req, reply) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play loop="10">${NEXA_HOLD_MUSIC}</Play>
</Response>`;
  reply.header('Content-Type', 'text/xml');
  return twiml;
});

// ─── /transfer-fallback ───────────────────────────────────────────────────────
fastify.post('/transfer-fallback', async (req, reply) => {
  const dialStatus = req.body?.DialCallStatus;
  const callSid = req.body?.CallSid;
  dlog(`Transfer fallback — dial status: ${dialStatus}, callSid: ${callSid}`);

  if (dialStatus === 'completed') {
    // Transfer was answered — mark as done
    const session = sessions.get(callSid);
    if (session) session.transferProcessed = true;
    reply.header('Content-Type', 'text/xml');
    return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  }

  // No answer — reconnect caller to AI for callback scheduling
  if (dialStatus === 'no-answer' || dialStatus === 'busy' || dialStatus === 'failed') {
    const session = sessions.get(callSid);
    if (session) session.scheduleCallback = true;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${req.hostname}/media-stream?callSid=${callSid}&amp;scheduleCallback=true" />
  </Connect>
</Response>`;
    reply.header('Content-Type', 'text/xml');
    return twiml;
  }

  reply.header('Content-Type', 'text/xml');
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
});

// ─── /send-callback-sms ───────────────────────────────────────────────────────
fastify.post('/send-callback-sms', async (req, reply) => {
  const { callerName, callerNumber, callbackTime } = req.body;
  const msg = `📞 Callback needed: ${callerName || callerNumber} is available ${callbackTime}. Number: ${callerNumber}`;
  await sendSMS(BRANDYN_CELL, msg);
  return { ok: true };
});

// ─── WebSocket media stream ───────────────────────────────────────────────────
// ─── Raw WebSocket server for /media-stream ──────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', async (socket, req) => {
  dlog('Twilio media stream connected | readyState: ' + socket?.readyState);
    let callSid = null;
    let callerNumber = null;
    let streamSid = null;
    let leadInfo = null;
    let transferTriggered = false;
    const conversationHistory = [];

    const openaiWs = new WebSocket(
      'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      }
    );

    openaiWs.on('open', () => {
      dlog('Connected to OpenAI Realtime API');
    });

    async function initializeSession() {
      const systemPrompt = buildSystemPrompt(leadInfo);
      openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          turn_detection: {
            type: 'server_vad',
            threshold: 0.85,
            silence_duration_ms: 1500,
            prefix_padding_ms: 300,
          },
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          voice: 'alloy',
          instructions: systemPrompt,
          modalities: ['text', 'audio'],
          temperature: 0.8,
          input_audio_transcription: { model: 'whisper-1' },
        },
      }));

      const greeting = leadInfo?.name
        ? `Start the conversation by greeting the caller by their first name (${leadInfo.name.split(' ')[0]}) warmly, let them know you're with NEXA Lending and you're here to help with their mortgage inquiry.`
        : `Start the conversation by greeting the caller warmly and letting them know they've reached NEXA Lending.`;

      openaiWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: greeting }] },
      }));
      openaiWs.send(JSON.stringify({ type: 'response.create' }));
    }

    openaiWs.on('message', async (data) => {
      try {
        const event = JSON.parse(data);

        // Stream audio to caller
        if (event.type === 'response.audio.delta' && event.delta && streamSid) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: event.delta },
            }));
          }
        }

        // Capture assistant transcript — check for trigger tokens
        if (event.type === 'response.audio_transcript.done') {
          const transcript = event.transcript || '';
          conversationHistory.push({ role: 'assistant', text: transcript });

          // ── TRANSFER trigger ──────────────────────────────────────────────
          if (!transferTriggered && transcript.includes('TRANSFER_TO_LOAN_OFFICER')) {
            transferTriggered = true;
            dlog('🔄 Transfer triggered — connecting to Brandyn');

            const session = sessions.get(callSid);
            if (session) {
              session.conversationHistory = [...conversationHistory];
              session.transferProcessed = true;
            }

            const fullTranscript = conversationHistory
              .map(m => `${m.role === 'assistant' ? 'Jessica' : 'Caller'}: ${m.text}`)
              .join('\n');

            // Fire email + SMS + save lead in parallel, then transfer
            const callerName = leadInfo?.name || 'a new caller';
            await Promise.all([
              sendCallSummaryEmail(callerNumber, fullTranscript, leadInfo, 'transfer'),
              sendSMS(BRANDYN_CELL, `📲 Live Transfer incoming — ${callerName} | ${callerNumber}`),
              saveLeadToBase44(callerNumber, fullTranscript, leadInfo, 'transfer'),
            ]);

            await new Promise(r => setTimeout(r, 1500)); // let Jessica finish speaking
            if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
            await initiateTransfer(callSid);
          }

          // ── CALLBACK trigger ──────────────────────────────────────────────
          if (transcript.includes('SCHEDULE_CALLBACK:')) {
            const match = transcript.match(/SCHEDULE_CALLBACK:([^:]+):(.+)/);
            if (match) {
              const cName = match[1].trim();
              const cTime = match[2].trim();
              dlog(`Scheduling callback: ${cName} at ${cTime}`);
              await sendSMS(BRANDYN_CELL, `📞 Callback needed: ${cName} is available ${cTime}. Number: ${callerNumber}`);
            }
          }
        }

        // Capture caller transcript
        if (event.type === 'conversation.item.input_audio_transcription.completed') {
          conversationHistory.push({ role: 'user', text: event.transcript });
        }

        if (event.type === 'error') dlog(`OpenAI error: ${JSON.stringify(event.error)}`);
      } catch (err) {
        dlog(`OpenAI message processing error: ${err.message}`);
      }
    });

    openaiWs.on('close', () => dlog('OpenAI WebSocket closed'));
    openaiWs.on('error', (err) => dlog(`OpenAI WS error: ${err.message}`));

    socket.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        dlog(`Twilio event: ${data.event}`);
        switch (data.event) {
          case 'start':
            dlog(`Start raw: ${JSON.stringify(data.start).substring(0,300)}`);
            streamSid = data.start?.streamSid;
            callSid = data.start?.callSid;
            callerNumber = data.start?.customParameters?.callerNumber
                        || data.start?.from
                        || 'unknown';
            dlog(`Stream started — callSid: ${callSid}, caller: ${callerNumber}`);

            // Store session immediately and start AI right away (no blocking lookup)
            sessions.set(callSid, {
              callSid,
              callerNumber,
              streamSid,
              conversationHistory,
              leadInfo: null,
              startTime: new Date().toISOString(),
              transferProcessed: false,
            });

            // Initialize session immediately — don't wait for LeadFlow
            await initializeSession();

            // Lookup lead in background (non-blocking)
            lookupLeadByPhone(callerNumber).then(result => {
              leadInfo = result;
              dlog(`LeadFlow result: ${JSON.stringify(leadInfo)}`);
              const session = sessions.get(callSid);
              if (session) session.leadInfo = leadInfo;
            }).catch(() => { leadInfo = null; });
            break;

          case 'media':
            if (openaiWs.readyState === WebSocket.OPEN && !transferTriggered) {
              openaiWs.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: data.media.payload,
              }));
            }
            break;

          case 'stop':
            dlog(`Stream stopped for ${callSid}`);
            if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
            // End-of-call processing for non-transfer calls
            if (callSid && sessions.has(callSid) && !transferTriggered) {
              const session = sessions.get(callSid);
              session.conversationHistory = conversationHistory;
              session.endTime = new Date().toISOString();
              await processEndOfCall(session, 'mortgage');
              sessions.delete(callSid);
            }
            break;
        }
      } catch (err) {
        dlog(`Twilio message error: ${err.message}`);
      }
    });

    socket.on('close', () => {
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });

});

fastify.server.on('upgrade', (req, sock, head) => {
  if (req.url === '/media-stream') {
    wss.handleUpgrade(req, sock, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { fastify.log.error(err); process.exit(1); }
  dlog(`Jessica bridge running on port ${PORT}`);
});
