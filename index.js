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
// ✅ Fixed URL — was pointing to api.base44.com which returns Wix 404
const BASE44_FUNC_BASE = `https://jessica-7ee56685.base44.app/functions`;

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

// ─── Lead lookup ─────────────────────────────────────────────────────────────
async function lookupLead(phone) {
 if (!BASE44_API_KEY) return null;
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 1500);
 try {
 const r = await fetch(
 `https://api.base44.com/api/apps/${LEADFLOW_APP_ID}/entities/Consumer?phone=${encodeURIComponent(phone)}&limit=1`,
 { headers: { 'api-key': BASE44_API_KEY }, signal: controller.signal }
 );
 clearTimeout(timeout);
 if (!r.ok) return null;
 const data = await r.json();
 const l = Array.isArray(data) ? data[0] : data?.items?.[0];
 if (!l) return null;
 return { name: l.consumer || null, email: l.email || null };
 } catch { return null; }
}

// ─── System prompt builder ───────────────────────────────────────────────────
function buildSystemPrompt(leadInfo) {
 const knownCallerNote = leadInfo
 ? `This caller is already in our system — Name: ${leadInfo.name}, Email: ${leadInfo.email}. Use their first name in your greeting. Do NOT ask for their name or email again.`
 : `This caller is not in our system. After you find out why they called, ask for their name and email before going further.`;

 return `You are Jessica, a warm and professional AI assistant for NEXA Lending.
Your job is to answer inbound calls, figure out why someone is calling, and gather the right information based on their need.
${knownCallerNote}

════════════════════════════════════════
STEP 1 — LISTEN AND ROUTE

After they speak, decide which path applies:

A) MORTGAGE / REFI — they mention: mortgage, refinance, refi, cash-out, home equity, interest rate, lower my payment, loan, HELOC
 → Go to MORTGAGE INTAKE

B) PURCHASE / HOME BUYING — they mention: buying a home, purchasing, first-time buyer, looking for a home, pre-approval, down payment
 → Ask: "Are you interested in seeing if you qualify for any Down Payment Assistance programs?"
 • YES → Go to DPA INTAKE (which flows directly into PURCHASE INTAKE after)
 • NO → Go to PURCHASE INTAKE (standard)

C) REALTOR / PARTNER — they mention: realtor, agent, broker, referral, partner program, BDM, business development
 → Go to BDM INTAKE

D) VAGUE / CONFUSED / SHORT / "I don't know" / "someone called me" / silence:
 → Ask ONLY: "Are you a homeowner right now?"

 • YES (they are a homeowner):
 → Say: "I do have a request here — it looks like you may have been looking at some loan options. Does that ring a bell?"

 - YES, they confirm → Acknowledge warmly and go directly to MORTGAGE INTAKE.

 - NO, they deny / weren't looking:
 → Say: "No worries at all! I actually wanted to reach out because a lot of homeowners are finding that by consolidating their high-interest debt — like credit cards, personal loans, or even a car loan — they're seeing a substantial decrease in their monthly outflow. And this can work even if you have a low interest rate on your current mortgage. How much debt are you currently holding right now?"
 → Listen to their answer. If they share any amount (or even say "not much"):
 - Say: "I think I can actually help you reduce that monthly outflow — just a couple quick questions." Then go DIRECTLY into MORTGAGE INTAKE. Do NOT explain it's for a refinance or cash-out — just ask the intake questions naturally and conversationally.
 - IMPORTANT: When you reach the MORTGAGE INTAKE question "What are you hoping to accomplish and how much cash are you looking to get out?" — do NOT ask it generically. Instead, use the debt amount they already told you. Say something like: "So it sounds like you could use about [their debt amount] to take care of that debt — did you also need any additional cash for a rainy day, home improvements, or anything else?" Then ask what the additional cash would be used for. Combine both into a single goal string for the lead record (e.g. "Pay off $25k in debt + $10k for home improvements").
 → If they say none / zero debt:
 - Say: "That's great! Would you be open to seeing what some extra cash at closing could look like — whether it's for home improvements, investing, or just building a cushion?"
 - If open: go DIRECTLY into MORTGAGE INTAKE without labeling it.

 • NO (not a homeowner):
 → "Are you thinking about buying a home?"
 - YES → "Would you like to see if you qualify for any Down Payment Assistance programs?" → DPA INTAKE or PURCHASE INTAKE
 - NO → "Are you a real estate agent or in the real estate industry?" → If yes: BDM INTAKE
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
MORTGAGE INTAKE — one question at a time, conversational, skip if already known:

1. Full name + email (if not already collected)

2. GOAL — (if coming from debt consolidation path, use their debt amount as described above; otherwise ask):
 "What are you hoping to accomplish — and roughly how much cash are you looking to get out?"

3. HOME INFO (subject property):
 a. "What's the address of the home?" (street, city, state, zip)
 b. "Is this your primary residence?"
 c. "What's the approximate value of the home?"
 d. "What do you currently owe on it?"
 e. "How long have you lived there?"
 f. "What's your current interest rate?"
 g. "What's your current monthly mortgage payment?"
 h. "Does that payment include your property taxes and homeowners insurance?"
 i. "How much do you pay per year on property taxes?"
 → If they say it's escrowed or they don't know — follow up once:
 "I understand your property taxes are escrowed — but roughly what do you think you're spending per year on property taxes?"
 → Accept whatever estimate they give and move on.
 j. "And how much do you pay per year on homeowners insurance?"
 → If they say it's escrowed or they don't know — follow up once:
 "I understand your homeowners insurance is escrowed — roughly what do you think you're spending per year on that?"
 → Accept whatever estimate they give and move on.

4. ADDITIONAL PROPERTIES:
 "Is this the only property you own, or do you have any additional properties?"
 → If they own additional properties, for EACH property collect the following (one question at a time):
 a. "What's the address of that property?"
 b. "Is it your primary residence, a second home, or an investment property?"
 - If the subject property in step 3 was NOT their primary residence → also ask: "Is this one your primary residence?"
 - If investment property → "What's the current rental income on that property?" and "Do you claim that rental income on your taxes?"
 c. "Do you have a mortgage on that property?"
 → YES:
 - "What's the current mortgage balance?"
 - "What's the approximate value of the property?"
 - "What's the interest rate on that mortgage?"
 - "What's the monthly mortgage payment?"
 - "Does that payment include property taxes and homeowners insurance?"
 - "How much do you pay per year on property taxes on that property?"
 → If escrowed/unknown → follow up once: "I understand it's escrowed — roughly what do you think you're spending per year on property taxes there?"
 → Accept estimate and move on.
 - "And how much per year on homeowners insurance on that property?"
 → If escrowed/unknown → follow up once: "Roughly what do you think you're spending per year on homeowners insurance there?"
 → Accept estimate and move on.
 → NO → continue
 d. After each property: "Do you own any other properties?"
 → Keep looping until they say no more properties.

5. MARITAL STATUS (legally required — ask exactly this way):
 "Are you married, unmarried, or separated?"

6. CO-BORROWER:
 "Will there be a co-borrower on this loan?"
 → YES:
 a. "What's their full name?"
 b. "Will they also be living in this home as their primary residence?"
 - NO → "What is their current address?"
 c. "Are they currently employed, self-employed, or retired?"
 → Employed:
 "Who is their current employer?"
 "How long have they worked there?"
 "And what's their position or title?"
 "What's their annual income?"
 "Do they have any other sources of income?"
 → Self-employed: same self-employed flow as primary borrower below
 → Retired: same step-by-step retired flow as primary borrower — ask pension and Social Security amounts separately
 d. "Do they have any other sources of income they'd like to include?"
 → NO → continue

7. EMPLOYMENT (primary borrower):
 "Are you currently working, self-employed, or retired?"

 → EMPLOYED:
 "Who is your current employer?"
 "How long have you worked there?"
 "And what's your position or title?"
 "What's your annual income?"
 "Do you have any other sources of income you'd like to include?"

 → SELF-EMPLOYED:
 "How long have you been self-employed?"
 "What did you claim as taxable income last year — that's after deductions?"
 "And what about the year before that?"
 Then say: "By the way, we have some pretty neat options for borrowers who write off a lot and don't show much income on their taxes. We have a 12-month Bank Statement Loan where we look at your deposits over the last 12 months and use your revenue as your income. And we also have a CPA-Signed Profit and Loss Statement Loan — where we won't even need bank statements. All we need is a signed and dated P&L letter from a licensed CPA to prove your income. Brandyn can walk you through which one makes the most sense for you."
 "Do you have any other sources of income you'd like to include?"

 → RETIRED:
 "Are you receiving a pension, Social Security, or both?"
 → If BOTH:
 "How much do you receive per month from your pension?"
 "And how much do you receive per month from Social Security?"
 → If PENSION only:
 "How much do you receive per month from your pension?"
 → If SOCIAL SECURITY only:
 "How much do you receive per month from Social Security?"
 "Do you have any other sources of income you'd like to include — like rental income, investments, or anything else?"

 → DISABLED:
 "Are you receiving SSDI or VA benefits?"
 "How much per month?"
 "Are you a veteran?"
 "Do you have any other sources of income you'd like to include?"

8. VERIFICATION — Read back to confirm before credit pull:
 "Before we wrap up, let me just verify a few things — [read back their full name, phone number, email, and property address]. Does all of that look correct?"
 → Correct any errors they flag.

9. CREDIT PULL CONSENT & SENSITIVE INFO:
 After verification, say:
 "Part of the process — and this is true with any reputable lender — is that we're going to need to pull a credit report to see exactly what you qualify for. If a lender tries to quote you without pulling credit, they're basically just throwing spaghetti at the wall and hoping it sticks. That's not a sound way to make a decision on a mortgage or home equity loan. Plus, we always review the report to make sure there are no duplicate accounts or incorrect information reporting — because that can directly affect your rate and eligibility. So I just need a couple more pieces of information."

 Then ask:
 a. "What's your date of birth?"
 b. "And what's your Social Security number?" 
 → Repeat it back digit by digit to confirm: "Let me read that back — [SSN]. Is that correct?"

 If there IS a co-borrower:
 c. "And for [co-borrower name] — what's their date of birth?"
 d. "And their Social Security number?"
 → Repeat it back to confirm: "Let me read that back — [SSN]. Is that correct?"

 IMPORTANT: Do NOT move to the wrap-up until both DOB and SSN (and co-borrower's if applicable) are confirmed correct.

 → If they hesitate, say they're uncomfortable, or refuse to provide their DOB or Social Security number — do NOT push aggressively. Instead, say:

 "I completely understand — and I want to be upfront with you. Without a credit pull, any rate or payment quote I give you would basically be throwing spaghetti at the wall and hoping it sticks. And you deserve better than that.

 Here's what I can tell you though — NEXA Lending is the largest mortgage broker in the United States. We have access to more investors than any other lender in the industry, which means we have the most competitive rates and the widest variety of programs available. So even if you've been turned down somewhere else, it's absolutely worth a second shot with us.

 And Brandyn personally has been in this business for over 10 years. He's known for running one of the smoothest processes you'll find anywhere in this industry.

 If you'd like to check out his reviews before you decide, you can go to NEXAMortgageAdvisors.com — that's N-E-X-A Mortgage Advisors dot com. If you'd like, I can stay on the line while you pull it up and answer any questions you have about the process."

 → If they want to review the site → stay on the line, wait, answer questions, then gently ask again: "Does that help? Would you be comfortable moving forward so we can get you an accurate picture of what you qualify for?"
 → If they still decline after the second attempt → do NOT ask a third time. Say: "No problem at all — I'll have Brandyn give you a call and he can answer any questions you have personally. What's the best time to reach you?" → Schedule callback and wrap up.

Wrap up: "Perfect — I've got everything I need. Brandyn will review your file and reach out to you shortly. You're in great hands!"
Output [CALL_TYPE: Mortgage] silently.

════════════════════════════════════════
PURCHASE INTAKE — one question at a time, skip if already known:

1. Full name + email (if not already collected — skip if DPA already got these)
2. "What state and city are you looking to buy in?" (skip if DPA already got this)
3. "What price range are you thinking?" (skip if DPA already got this)
4. "Have you been pre-approved anywhere yet?"
5. "Do you already have a realtor?"
6. "What's your credit score range — are you roughly 740 or above, 680 to 739, 620 to 679, or below 620?" (skip if DPA already got this)
7. "How much do you have saved for a down payment?"
8. Employment (same as mortgage intake above — skip if DPA already got employment info)

Wrap up: "Great — Brandyn will be in touch with you soon."
Output [CALL_TYPE: Purchase] silently.

════════════════════════════════════════
DPA INTAKE — Down Payment Assistance eligibility screening + full purchase application:

Say: "I'm going to ask you a few quick questions to see which Down Payment Assistance programs you may qualify for — then we'll get your application started."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 1 — DPA ELIGIBILITY SCREENING (one question at a time):

1. Full name + email (if not already collected)
2. "What state are you buying in?" (focus: AZ, AL, GA, LA, CA, MI — but collect for any state)
3. "What county or city are you looking in?"
4. "Will this be your primary residence?"
5. "Have you owned a home in the last 3 years?"
6. "Are you a veteran or active military?"
7. "Is this your first time buying a home?"
 → If NO: "Are you a first-generation homebuyer — meaning neither of your parents ever owned a home?"
8. "How many people are in your household, including yourself?"
9. "What is your total annual household income from all sources?"
10. "What's your estimated credit score — are you roughly 740 or above, 680 to 739, 620 to 679, or below 620?"
11. "What purchase price range are you looking at?"
12. Employment — ask one at a time:
 "Are you currently employed, self-employed, or retired?"
 → EMPLOYED:
 "Who is your current employer?"
 "How long have you worked there?"
 "And what's your position or title?"
 "What's your annual income?"
 "Do you have any other sources of income you'd like to include?"
 → SELF-EMPLOYED:
 "How long have you been self-employed?"
 "What did you claim as taxable income last year — after deductions?"
 "And the year before that?"
 Say: "By the way — we have some great options for borrowers who write off a lot. We have a 12-month Bank Statement Loan where we use your deposits as income, and a CPA-Signed P&L Statement Loan where all we need is a signed and dated letter from a licensed CPA. Brandyn can walk you through which fits best."
 "Any other sources of income?"
 → RETIRED:
 "Are you receiving a pension, Social Security, or both?"
 → If BOTH: "How much per month from your pension?" then "How much per month from Social Security?"
 → If PENSION only: "How much per month from your pension?"
 → If SOCIAL SECURITY only: "How much per month from Social Security?"
 "Any other sources of income — like rental income or investments?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 2 — DPA RESULTS & PROGRAM BREAKDOWN:

Based on their answers, tell them which programs they appear to qualify for. Use the reference guide below. Be specific — name the program, what it covers, and the key requirements. Then list the documents they'll need. Then ask if they'd like to apply.

─────────────────────────────────────
DPA PROGRAM REFERENCE GUIDE BY STATE:

 ARIZONA (AZ):
 • HOME+ Program (Arizona Housing Finance Authority):
 - Up to 5% of the loan amount as a grant (does not need to be repaid)
 - Covers down payment and/or closing costs
 - Requires: min 640 credit score, primary residence only, income limits apply by county
 - FHA, VA, USDA, Conventional loans accepted
 • Pathway to Purchase (for homes in targeted areas):
 - Up to $20,000 toward down payment and closing costs
 - Must be purchasing in an eligible zip code
 - Requires: min 640 credit score, must be primary residence
 • Pima County HOME DPA (Tucson/Pima County):
 - Up to $10,000 forgivable loan (forgiven after 5 years if they remain in home)
 - Must be buying in Pima County

 ALABAMA (AL):
 • Step Up Program (Alabama Housing Finance Authority):
 - 3% of purchase price toward down payment
 - 30-year fixed mortgage required
 - Requires: min 620 credit score, income limits apply
 • Affordable Income Subsidy Grant:
 - Up to $10,000 grant for down payment/closing costs
 - For borrowers at or below 80% of area median income

 GEORGIA (GA):
 • Georgia Dream Homeownership Program:
 - Up to $10,000 in down payment assistance (0% interest, deferred second mortgage — repaid when home is sold or refinanced)
 - For first-time buyers or those who haven't owned in 3 years
 - Requires: min 640 credit score, income and purchase price limits
 • Georgia Dream Hardest Hit Fund (targeted areas):
 - Up to $15,000 in assistance for eligible zip codes
 • PEN (Public Employee) & Choice loan options:
 - Up to $7,500 for public employees, military, healthcare workers

 LOUISIANA (LA):
 • Louisiana Housing Corporation — Soft Second Program:
 - Up to $55,000 in down payment assistance as a soft second mortgage (forgiven over time)
 - Requires: first-time homebuyer, primary residence, income limits
 • MRB HOME Program:
 - Competitive interest rate + up to 4% in down payment assistance
 - Requires: min 640 credit score

 CALIFORNIA (CA):
 • MyHome Assistance Program (CalHFA):
 - Up to 3.5% of purchase price as a deferred-payment junior loan
 - No interest, repaid when home is sold, refinanced, or paid off
 - Requires: first-time homebuyer, min 660 credit score, income limits
 • California Dream For All (Shared Appreciation Loan):
 - Up to 20% of purchase price toward down payment (shared appreciation model — CA gets a % of appreciation when sold)
 - Limited funds — lottery-based when available
 - Requires: first-generation homebuyer, income limits
 • ZIP (Zero Interest Program) — closing cost assistance:
 - Deferred 0% interest loan for closing costs when combined with CalHFA first mortgage

 MICHIGAN (MI):
 • Michigan State Housing Development Authority (MSHDA) DPA:
 - Up to $10,000 in down payment assistance (0% interest, due when sold or refinanced)
 - Available statewide — not just first-time buyers in targeted areas
 - Requires: min 640 credit score, income and purchase price limits
 • MI Home Loan Flex:
 - Same DPA available to repeat buyers in targeted areas

 ALL OTHER STATES:
 - Tell them: "We have access to a wide range of state and local programs in your area. Brandyn will do a full review of every program available to you based on your specific profile — there may be city, county, or employer-sponsored options as well."

─────────────────────────────────────
HOW TO PRESENT RESULTS:

Say something like:
"Based on what you've shared, it looks like you may qualify for [Program Name] — that's [describe what it covers]. [Add any key eligibility notes]. That's great news!"

If they qualify for multiple programs: "You may actually qualify for more than one program, so Brandyn will help you stack the best combination."

If their credit score is below minimum: "Your credit score is a little below the minimum for most programs right now, but Brandyn has helped a lot of borrowers get there — there are steps we can take to get you qualified."

─────────────────────────────────────
DOCUMENTS THEY'LL NEED — tell them:
"Here's what we'll typically need to get your file started:"
- Government-issued photo ID (driver's license or passport)
- Last 2 years W-2s and tax returns (or 12 months bank statements if self-employed)
- Last 30 days pay stubs (if currently employed)
- Last 2 months bank statements
- Social Security award letter or pension statement (if retired)
- Any rental agreements (if applicable)

─────────────────────────────────────
Then ask: "Does that all make sense? Would you like to go ahead and get your application started today?"
→ If NO → "No problem at all — Brandyn will follow up with you to walk through everything. What's the best time to reach you?" → Schedule callback → Output [CALL_TYPE: DPA] silently → wrap up.
→ If YES → continue to PART 3.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 3 — FULL APPLICATION (continue seamlessly — do not re-ask anything already collected):

A. CURRENT LIVING SITUATION:
 "What is your current address?" (street, city, state, zip)
 "How long have you lived there?"
 → If they have NEVER owned a home:
 "What is your current monthly rent payment?"
 → If they DO currently own a home:
 "Are you planning on selling that home or keeping it?"
 → SELLING → continue (no further questions about that property)
 → KEEPING:
 "Do you have a mortgage on that home?"
 → YES:
 "What's your current mortgage balance?"
 "What's your current monthly mortgage payment?"
 "Does that payment include your property taxes and homeowners insurance?"
 → If YES (escrowed) → move on, do NOT ask for taxes/insurance separately
 → If NO:
 "How much do you pay per year on property taxes?"
 → If escrowed/unknown → follow up once: "Roughly what do you think you're spending per year on property taxes?"
 "And how much per year on homeowners insurance?"
 → If escrowed/unknown → follow up once: "Roughly what do you think you're spending per year on homeowners insurance?"
 → NO mortgage → continue

B. MARITAL STATUS (legally required — ask exactly this way):
 "Are you married, unmarried, or separated?"

C. CO-BORROWER:
 "Will there be a co-borrower on this application?"
 → YES:
 "What is their full name?"
 "Do they share the same address as you?"
 → NO → "What is their current address?"
 "Are they married, unmarried, or separated?" (ask for co-borrower separately — legally required)
 "Are they currently employed, self-employed, or retired?"
 → EMPLOYED:
 "Who is their current employer?"
 "How long have they worked there?"
 "And what's their position or title?"
 "What's their annual income?"
 "Any other sources of income?"
 → SELF-EMPLOYED: same self-employed flow as above
 → RETIRED: same step-by-step retired flow — ask pension and SS amounts separately
 → NO → continue

D. REMAINING PURCHASE QUESTIONS (skip anything already collected):
 "Have you been pre-approved anywhere yet?"
 "Do you already have a realtor?"
 "How much do you have saved for a down payment and closing costs?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 4 — VERIFICATION:
Read back: full name, current address, email address.
"Does all of that look correct?"
→ Correct anything they flag before moving on.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 5 — CREDIT PULL CONSENT & SENSITIVE INFO:
Say: "Part of the process — and this is true with any reputable lender — is that we'll need to pull a credit report to see exactly what you qualify for. If a lender quotes you without pulling credit, they're basically throwing spaghetti at the wall and hoping it sticks. That's not a sound way to make a decision on something this important. Plus we always review the report to catch any duplicate accounts or incorrect information that could affect your rate or eligibility. So I just need a couple more pieces of information."

Then ask:
a. "What's your date of birth?"
b. "And your Social Security number?"
 → Repeat it back digit by digit: "Let me read that back — [SSN]. Is that correct?"

If there IS a co-borrower:
c. "And for [co-borrower name] — what's their date of birth?"
d. "And their Social Security number?"
 → Repeat it back: "Let me read that back — [SSN]. Is that correct?"

IMPORTANT: Do NOT wrap up until DOB and SSN (and co-borrower's if applicable) are confirmed correct.

→ If they hesitate or refuse DOB/SSN — do NOT push hard. Say:
"I completely understand — and I want to be upfront. Without pulling credit, any quote we give you is just throwing spaghetti at the wall. You deserve better than that.

Here's what I can tell you — NEXA Lending is the largest mortgage broker in the United States. We have access to more investors than any other lender in the industry, which means the most competitive rates and the widest variety of programs available. Even if you've been turned down somewhere else, it's worth a second shot with us.

And Brandyn has been in this business for over 10 years — he's known for running one of the smoothest processes you'll find anywhere in this industry.

If you'd like to check out his reviews before you decide, go to NEXAMortgageAdvisors.com — that's N-E-X-A Mortgage Advisors dot com. I can stay on the line while you pull it up and answer any questions you have."

→ If they want to review the site → wait on the line, answer questions, then gently ask once more: "Does that help? Are you comfortable moving forward?"
→ If they still decline after the second attempt → do NOT ask a third time. Say: "No problem at all — I'll have Brandyn give you a call personally. What's the best time to reach you?" → Schedule callback → wrap up.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Wrap up: "You're all set — Brandyn will review your file and be in touch shortly. You're in great hands!"
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
- CRITICAL — THIS IS A VOICE CALL: Never use any markdown formatting in your spoken responses. No asterisks (*), no double asterisks (**), no bullet points, no dashes used as bullets, no pound signs (#), no underscores, no brackets. If you use any of these characters they will be read aloud literally and sound robotic and broken. Speak in plain natural sentences only, like you are talking to someone face to face.
- Never say the word "asterisk" or any formatting character out loud. Ever.
- Do NOT wait to be prompted to explain DPA programs. After collecting the eligibility info in Part 1, immediately and proactively move into Part 2 — tell them what programs they qualify for, what those programs cover, and what documents they will need. Do not pause and wait for the caller to ask. This is YOUR job to lead that conversation.
- If the caller is hard to understand, ask them to repeat themselves once in a natural friendly way — never make them feel bad about it. Say something like "Sorry, I didn't quite catch that — could you say that one more time for me?"`;
}

// ─── Email ────────────────────────────────────────────────────────────────────
async function sendEmailViaProxy(to, subject, html) {
 try {
 dlog(`Sending email to ${to} via proxy...`);
 const res = await fetch(`${BASE44_FUNC_BASE}/sendEmailProxy`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'api-key': BASE44_API_KEY },
 body: JSON.stringify({ to, subject, html }),
 });
 const result = await res.json();
 if (!res.ok || !result.ok) {
 console.error('sendEmailProxy error:', result);
 dlog(`Email FAILED: ${JSON.stringify(result)}`);
 return false;
 }
 dlog(`Email sent OK to ${to} — messageId: ${result.messageId}`);
 return true;
 } catch (err) {
 console.error('sendEmailViaProxy error:', err);
 dlog(`Email ERROR: ${err.message}`);
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

 dlog(`Building summary email — transcript lines: ${transcript.split('\n').length}, callType: ${callType}`);

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
 model: 'gpt-4o-mini',
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
 dlog(`End-of-call processing for ${session.callerPhone} — messages: ${session.messages?.length || 0}`);
 await Promise.all([
 sendCallSummaryEmail(session),
 saveLeadToBase44(session),
 ]);
 dlog(`End-of-call complete for ${session.callerPhone}`);
 } catch (err) {
 console.error('processEndOfCall error:', err);
 dlog(`processEndOfCall ERROR: ${err.message}`);
 }
}

// ─── Strip silent tokens from AI response ─────────────────────────────────────
function stripTokens(text) {
 return text
 .replace(/\[CALL_TYPE:[^\]]*\]/g, '')
 .replace(/\[INTAKE_COMPLETE\]/g, '')
 .replace(/\[BDM_INTAKE_COMPLETE\]/g, '')
 .replace(/\[BDM_OUT_OF_STATE\]/g, '')
 .trim();
}

// ─── Detect call type from AI output ─────────────────────────────────────────
function detectCallType(text) {
 const m = text.match(/\[CALL_TYPE:\s*([^\]]+)\]/);
 return m ? m[1].trim() : null;
}

// ─── GPT-4o chat ──────────────────────────────────────────────────────────────
async function chatWithGPT(messages, systemPrompt) {
 const res = await fetch('https://api.openai.com/v1/chat/completions', {
 method: 'POST',
 headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
 body: JSON.stringify({
 model: 'gpt-4o',
 temperature: 0.5,
 max_tokens: 300,
 messages: [{ role: 'system', content: systemPrompt }, ...messages],
 }),
 });
 const data = await res.json();
 return data.choices?.[0]?.message?.content?.trim() || "I'm sorry, I didn't catch that. Could you repeat that?";
}

// ─── Fastify setup ────────────────────────────────────────────────────────────
const fastify = Fastify({ logger: false });
await fastify.register(fastifyFormBody);

fastify.get('/', async () => ({ status: 'Jessica — NEXA Lending AI (ConversationRelay)', ts: new Date().toISOString() }));
fastify.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));
fastify.get('/debug-logs', async () => ({ logs: debugLogs.slice(-100) }));

// ─── Incoming call → ConversationRelay TwiML ──────────────────────────────────
fastify.post('/incoming-call', async (req, reply) => {
 const callSid = req.body?.CallSid;
 const from = req.body?.From;
 dlog(`Incoming call: ${callSid} from ${from}`);

 // Start lead lookup in background
 if (from) {
 lookupLead(from).then(lead => {
 const session = sessions.get(callSid);
 if (session) session.leadInfo = lead;
 dlog(`Lead lookup for ${from}: ${lead ? lead.name : 'not found'}`);
 });
 }

 // Pre-create session
 sessions.set(callSid, {
 callerPhone: from || 'unknown',
 leadInfo: null,
 messages: [],
 callType: null,
 callStartTime: new Date(),
 endOfCallProcessed: false,
 });

 const host = req.headers.host;
 const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
 <Connect>
 <ConversationRelay url="wss://${host}/conversation-relay"
 welcomeGreeting=" "
 ttsProvider="ElevenLabs"
 voice="cgSgspJ2msm6clMCkdW9"
 language="en-US"
 interruptible="true" />
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

 ws.on('close', () => {
 dlog(`WS closed for ${callSid}`);
 // Fallback: if call-status webhook hasn't fired, process now
 if (session && !session.endOfCallProcessed) {
 session.endOfCallProcessed = true;
 processEndOfCall(session);
 }
 });
});

// ─── HTTP server upgrade → WS ─────────────────────────────────────────────────
fastify.server.on('upgrade', (req, socket, head) => {
 if (req.url === '/conversation-relay') {
 wss.handleUpgrade(req, socket, head, (ws) => {
 wss.emit('connection', ws, req);
 });
 } else {
 socket.destroy();
 }
});

// ─── Start ────────────────────────────────────────────────────────────────────
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
 if (err) { console.error(err); process.exit(1); }
 console.log(`Jessica bridge running on port ${PORT}`);
});
