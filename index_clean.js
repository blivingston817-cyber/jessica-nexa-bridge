import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import WebSocket from 'ws';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BRANDYN_CELL = '+12147897527';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+18339883514';
const BASE44_WEBHOOK_URL = process.env.BASE44_WEBHOOK_URL;
const BASE44_API_KEY = process.env.BASE44_API_KEY;
const LEADFLOW_APP_ID = '69cfe4f5a8d6d5273ce84a33';
const NEXA_HOLD_MUSIC = 'https://base44.app/api/apps/69c8bc2a8e7923547ee56685/files/mp/public/69c8bc2a8e7923547ee56685/65e491f5f_80af02a76_NexaWay.mp3';
const SERVER_URL = process.env.SERVER_URL || 'https://jessica-nexa-bridge.onrender.com';

// ─── LeadFlow lookup ──────────────────────────────────────────────────────────
async function lookupLeadByPhone(phone) {
  if (!BASE44_API_KEY) return null;
  try {
    const digits = phone.replace(/\D/g, '');
    const tenDigit = digits.slice(-10);
    const formats = [phone, `+1${tenDigit}`, `1${tenDigit}`, tenDigit,
      `(${tenDigit.slice(0,3)}) ${tenDigit.slice(3,6)}-${tenDigit.slice(6)}`];
    for (const fmt of formats) {
      const res = await fetch(
        `https://api.base44.com/api/apps/${LEADFLOW_APP_ID}/entities/Lead?phone=${encodeURIComponent(fmt)}`,
        { headers: { 'api-key': BASE44_API_KEY, 'Content-Type': 'application/json' } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const records = Array.isArray(data) ? data : data.records || [];
      if (records.length > 0) {
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
    }
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
2. What is your current address?
3. What is your email address?
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

WRAP UP: Once you have gathered all the information above, say ONLY the words: "One moment please." Do NOT mention transferring, do NOT say Brandyn's name, do NOT say loan officer. Just say "One moment please." and nothing else. Then immediately output the exact phrase: TRANSFER_TO_LOAN_OFFICER

TRANSFER RULE: If at any point the caller asks to speak to a loan officer or a person, say ONLY: "One moment please." Do NOT say anything about transferring or who you are connecting them to. Then immediately output the exact phrase: TRANSFER_TO_LOAN_OFFICER

CRITICAL: Never say the words "transfer", "Brandyn", "loan officer", or "connect" when handing off a call. Only say "One moment please." and then TRANSFER_TO_LOAN_OFFICER.`;
}

// ─── Build whisper message via GPT ───────────────────────────────────────────
async function buildWhisperMessage(callerNumber, conversationHistory, leadInfo) {
  try {
    const transcript = conversationHistory
      .map(m => `${m.role === 'assistant' ? 'Jessica' : 'Caller'}: ${m.text}`)
      .join('\n');
    const nameHint = leadInfo?.name ? `Caller's name: ${leadInfo.name}. ` : '';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are summarizing a mortgage intake call for a loan officer named Brandyn. ${nameHint}Write a whisper message (under 30 words) that tells Brandyn the caller's name and what they want. Start with "Brandyn," then give the caller's name if known and their goal. Example: "Brandyn, this is John Smith. He wants a cash-out refinance to access $40,000 for home improvements. Press 1 to accept." Always end with "Press 1 to accept the call."`,
          },
          { role: 'user', content: `Caller number: ${callerNumber}\n\nTranscript:\n${transcript}` },
        ],
        max_tokens: 80,
        temperature: 0.3,
      }),
    });
    const result = await response.json();
    const msg = result.choices?.[0]?.message?.content?.trim();
    return msg || `Brandyn, you have an incoming mortgage lead from ${callerNumber}. Press 1 to accept the call.`;
  } catch (err) {
    console.error('Error building whisper:', err);
    return `Brandyn, you have an incoming mortgage lead. Press 1 to accept the call.`;
  }
}

// ─── Send summary email via Base44 webhook ───────────────────────────────────
async function sendSummaryEmail(callerNumber, conversationHistory, leadInfo) {
  try {
    const transcript = conversationHistory
      .map(m => `${m.role === 'assistant' ? 'Jessica' : 'Caller'}: ${m.text}`)
      .join('\n');
    const knownInfo = leadInfo
      ? `Name: ${leadInfo.name || 'N/A'} | Email: ${leadInfo.email || 'N/A'} | Address: ${leadInfo.address || 'N/A'}`
      : 'Not found in LeadFlow — name/email/address collected during call if provided';
    if (BASE44_WEBHOOK_URL) {
      await fetch(BASE44_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            type: 'end-of-call-report',
            transcript,
            summary: knownInfo,
            durationSeconds: 0,
            call: { customer: { number: callerNumber }, createdAt: new Date().toISOString() },
          },
        }),
      });
    }
  } catch (err) {
    console.error('Error sending summary email:', err);
  }
}

// ─── Initiate transfer: redirect the live call to /transfer endpoint ──────────
async function initiateTransfer(callSid, whisperMsg) {
  try {
    const encodedWhisper = encodeURIComponent(whisperMsg);
    const transferUrl = `${SERVER_URL}/transfer?msg=${encodedWhisper}`;
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
    console.log('Transfer redirect initiated:', result.status);
  } catch (err) {
    console.error('Transfer error:', err);
  }
}

// ─── Fastify setup ────────────────────────────────────────────────────────────
const fastify = Fastify({ logger: true });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const sessions = new Map();

fastify.get('/', async () => ({ status: 'Jessica - NEXA Lending AI Agent is running' }));

// ─── Incoming call → start media stream ──────────────────────────────────────
fastify.post('/incoming-call', async (req, reply) => {
  const callSid = req.body?.CallSid || 'unknown';
  const callerNumber = req.body?.From || 'unknown';
  fastify.log.info(`Incoming call from ${callerNumber}, SID: ${callSid}`);
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
  fastify.log.info(`Call ${callSid} status: ${status}`);
  if (status === 'completed' && sessions.has(callSid)) {
    const session = sessions.get(callSid);
    await processEndOfCall(session);
    sessions.delete(callSid);
  }
  return { ok: true };
});

// ─── /transfer — what the CALLER hears after AI hands off ────────────────────
// Plays hold music to caller, dials Brandyn with whisper + press-1-to-accept
fastify.post('/transfer', async (req, reply) => {
  const whisperText = req.query?.msg
    ? decodeURIComponent(req.query.msg)
    : `Brandyn, you have an incoming mortgage lead. Press 1 to accept the call.`;

  const encodedWhisper = encodeURIComponent(whisperText);
  const whisperUrl = `${SERVER_URL}/whisper?msg=${encodedWhisper}`;

  // answerOnBridge="true" keeps caller on hold music until Brandyn presses 1 and bridges
  // The whisper URL plays ONLY to Brandyn when he picks up — caller never hears it
  // Caller hears hold music the entire time via the holdMusic attribute
  // Play hold music to caller FIRST, then dial Brandyn
  // This ensures caller hears music immediately with no ringing at all
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30" callerId="${TWILIO_PHONE_NUMBER}" action="${SERVER_URL}/transfer-fallback" method="POST" waitUrl="${SERVER_URL}/hold-music" waitMethod="GET">
    <Number url="${whisperUrl}" answerOnBridge="true">${BRANDYN_CELL}</Number>
  </Dial>
</Response>`;
  reply.header('Content-Type', 'text/xml');
  return twiml;
});

// ─── /hold-music — plays to CALLER while Brandyn hears whisper ──────────────
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

// ─── /whisper — what BRANDYN hears when he picks up (before caller bridges) ──
fastify.post('/whisper', async (req, reply) => {
  const whisperText = req.query?.msg
    ? decodeURIComponent(req.query.msg)
    : `Brandyn, you have an incoming mortgage lead. Press 1 to accept the call.`;

  // Brandyn hears the summary, then must press 1 to accept
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${SERVER_URL}/whisper-response" method="POST" timeout="10">
    <Say voice="alice">${whisperText}</Say>
    <Say voice="alice">Press 1 to accept and connect to the caller now.</Say>
  </Gather>
  <Say voice="alice">No input received. The call will be sent to voicemail. Goodbye.</Say>
  <Hangup/>
</Response>`;
  reply.header('Content-Type', 'text/xml');
  return twiml;
});

// ─── /whisper-response — handles Brandyn pressing 1 ─────────────────────────
fastify.post('/whisper-response', async (req, reply) => {
  const digit = req.body?.Digits;
  let twiml;
  if (digit === '1') {
    // Empty response = Twilio bridges caller to Brandyn immediately, no extra audio
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`;
  } else {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">The call will not be connected. Goodbye.</Say>
  <Hangup/>
</Response>`;
  }
  reply.header('Content-Type', 'text/xml');
  return twiml;
});

// ─── /transfer-fallback — if Brandyn doesn't answer ─────────────────────────
fastify.post('/transfer-fallback', async (req, reply) => {
  const dialStatus = req.body?.DialCallStatus;
  fastify.log.info(`Transfer fallback — dial status: ${dialStatus}`);
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">We're sorry, your loan officer is unavailable right now. Please call back at your convenience or visit nexamortgageadvisors.com. Goodbye!</Say>
</Response>`;
  reply.header('Content-Type', 'text/xml');
  return twiml;
});

// ─── WebSocket media stream ───────────────────────────────────────────────────
fastify.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, async (twilioWs, req) => {
    fastify.log.info('Twilio media stream connected');
    let callSid = null;
    let callerNumber = null;
    let streamSid = null;
    let leadInfo = null;
    let transferTriggered = false;
    const conversationHistory = [];

    const openaiWs = new WebSocket(
      'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01',
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      }
    );

    openaiWs.on('open', () => {
      fastify.log.info('Connected to OpenAI Realtime API');
    });

    async function initializeSession() {
      const systemPrompt = buildSystemPrompt(leadInfo);
      openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          turn_detection: { type: 'server_vad' },
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          voice: 'alloy',
          instructions: systemPrompt,
          modalities: ['text', 'audio'],
          temperature: 0.8,
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

        // Stream audio back to caller
        if (event.type === 'response.audio.delta' && event.delta && streamSid) {
          if (twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: event.delta },
            }));
          }
        }

        // Capture assistant transcript and check for transfer trigger
        if (event.type === 'response.audio_transcript.done') {
          conversationHistory.push({ role: 'assistant', text: event.transcript });

          if (!transferTriggered && event.transcript && event.transcript.includes('TRANSFER_TO_LOAN_OFFICER')) {
            transferTriggered = true;
            fastify.log.info('Transfer triggered — preparing whisper and redirecting call');

            // Save session
            const session = sessions.get(callSid);
            if (session) session.conversationHistory = [...conversationHistory];

            // Build whisper + send email concurrently
            const [whisperMsg] = await Promise.all([
              buildWhisperMessage(callerNumber, conversationHistory, leadInfo),
              sendSummaryEmail(callerNumber, conversationHistory, leadInfo),
            ]);

            // Give Jessica 1.5s to finish speaking, then redirect the call
            await new Promise(r => setTimeout(r, 1500));

            // Close OpenAI stream so Twilio stream ends cleanly
            if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();

            // Redirect call to /transfer which plays hold music + dials Brandyn
            await initiateTransfer(callSid, whisperMsg);
          }
        }

        // Capture caller transcript
        if (event.type === 'conversation.item.input_audio_transcription.completed') {
          conversationHistory.push({ role: 'user', text: event.transcript });
        }

        if (event.type === 'error') fastify.log.error('OpenAI error:', event.error);
      } catch (err) {
        fastify.log.error('Error processing OpenAI message:', err);
      }
    });

    openaiWs.on('close', () => fastify.log.info('OpenAI WebSocket closed'));
    openaiWs.on('error', (err) => fastify.log.error('OpenAI WS error:', err));

    twilioWs.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        switch (data.event) {
          case 'start':
            streamSid = data.start.streamSid;
            callSid = data.start.callSid;
            callerNumber = data.start.customParameters?.callerNumber || 'unknown';

            fastify.log.info(`Looking up ${callerNumber} in LeadFlow...`);
            leadInfo = await lookupLeadByPhone(callerNumber);
            fastify.log.info(`LeadFlow result: ${JSON.stringify(leadInfo)}`);

            sessions.set(callSid, { callSid, callerNumber, streamSid, conversationHistory, leadInfo, startTime: new Date().toISOString() });

            if (openaiWs.readyState === WebSocket.OPEN) {
              await initializeSession();
            } else {
              openaiWs.once('open', initializeSession);
            }
            break;

          case 'media':
            if (openaiWs.readyState === WebSocket.OPEN && !transferTriggered) {
              openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: data.media.payload }));
            }
            break;

          case 'stop':
            if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
            if (callSid && sessions.has(callSid) && !transferTriggered) {
              const session = sessions.get(callSid);
              session.conversationHistory = conversationHistory;
              session.endTime = new Date().toISOString();
              await processEndOfCall(session);
              sessions.delete(callSid);
            }
            break;
        }
      } catch (err) {
        fastify.log.error('Error processing Twilio message:', err);
      }
    });

    twilioWs.on('close', () => {
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });
  });
});

// ─── Post-call processing (non-transfer calls) ───────────────────────────────
async function processEndOfCall(session) {
  try {
    const { callerNumber, conversationHistory, startTime, endTime } = session;
    const transcript = conversationHistory.map(m => `${m.role === 'assistant' ? 'Jessica' : 'Caller'}: ${m.text}`).join('\n');
    const startDate = startTime ? new Date(startTime) : new Date();
    const endDate = endTime ? new Date(endTime) : new Date();
    const durationSecs = Math.round((endDate - startDate) / 1000);
    if (BASE44_WEBHOOK_URL) {
      await fetch(BASE44_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            type: 'end-of-call-report',
            transcript,
            summary: '',
            durationSeconds: durationSecs,
            call: { customer: { number: callerNumber }, createdAt: startTime },
          },
        }),
      });
    }
  } catch (err) {
    console.error('Post-call processing error:', err);
  }
}

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { fastify.log.error(err); process.exit(1); }
  fastify.log.info(`Jessica bridge server running on port ${PORT}`);
});
