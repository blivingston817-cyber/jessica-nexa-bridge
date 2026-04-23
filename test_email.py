import urllib.request
import urllib.error
import json
import os

EMAIL_PROXY_URL = 'https://jessica-7ee56685.base44.app/functions/sendEmailProxy'
BASE44_API_KEY = os.environ.get('BASE44_API_KEY', '')

transcript = """
Jessica: Hi there, this is Jessica with NEXA Lending! Quick question to get you to the right place — are you looking to purchase a home, or are you a current homeowner looking to refinance or tap into your equity?
Caller: I want to purchase a home.
Jessica: Wonderful! Let me grab a few things first. What's your full name?
Caller: John Martinez.
Jessica: And your current address?
Caller: 4521 West Camelback Road, Phoenix, Arizona 85031.
Jessica: And the best email to reach you?
Caller: jmartinez@gmail.com
Jessica: Are you familiar with down payment assistance programs? We can run a quick check to see if you qualify.
Caller: No, just skip that for now.
Jessica: No problem! Where do you currently work?
Caller: Amazon. I've been there about 3 years. I'm a warehouse supervisor.
Jessica: And your annual salary?
Caller: About 68,000 a year.
Jessica: Any monthly debts — car, student loans, credit cards?
Caller: Just a car payment, about $450 a month.
Jessica: How much do you have in total savings right now?
Caller: About $22,000.
Jessica: Will anyone else be on the loan with you?
Caller: No, just me.
Jessica: Are you married, single, or partnered?
Caller: Single.
Jessica: How soon are you looking to purchase — actively shopping or still planning?
Caller: Actively shopping. I already have a real estate agent.
Jessica: Perfect. Let me confirm — Full name: John Martinez. Address: 4521 West Camelback Road, Phoenix, AZ 85031. Email: jmartinez@gmail.com. All correct?
Caller: Yes, that's right.
Jessica: Great — what day and time works best for a callback with our loan officer?
Caller: Thursday around 10 AM works great.
Jessica: Got it — I'll have a loan officer reach out Thursday at 10 AM. You'll also get a text confirmation shortly. Anything else I can help with?
Caller: No, that's it. Thank you!
Jessica: You're welcome, John. Talk soon!
"""

email_html = f"""
<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
  <div style="background:#002B5C;padding:20px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:22px;">✅ Completed Mortgage Application</h1>
    <p style="color:#90C0FF;margin:4px 0 0;">NEXA Lending AI — Jessica</p>
  </div>

  <div style="background:#fff3cd;padding:12px 20px;border-left:4px solid #ffc107;">
    <strong>⚠️ TEST EMAIL</strong> — This confirms the AI intake system is capturing and sending application data correctly.
  </div>

  <div style="padding:20px;background:#f9f9f9;">

    <h2 style="color:#002B5C;border-bottom:2px solid #eee;padding-bottom:8px;">👤 Contact Information</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px;font-weight:bold;width:180px;color:#555;">Full Name</td><td style="padding:8px;">John Martinez</td></tr>
      <tr style="background:#fff;"><td style="padding:8px;font-weight:bold;color:#555;">Phone</td><td style="padding:8px;">+1 (214) 555-0192</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Email</td><td style="padding:8px;">jmartinez@gmail.com</td></tr>
      <tr style="background:#fff;"><td style="padding:8px;font-weight:bold;color:#555;">Address</td><td style="padding:8px;">4521 West Camelback Rd, Phoenix, AZ 85031</td></tr>
    </table>

    <h2 style="color:#002B5C;border-bottom:2px solid #eee;padding-bottom:8px;margin-top:24px;">🏠 Purchase Details</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px;font-weight:bold;width:180px;color:#555;">Goal</td><td style="padding:8px;">Purchase a Home</td></tr>
      <tr style="background:#fff;"><td style="padding:8px;font-weight:bold;color:#555;">DPA Interest</td><td style="padding:8px;">Not interested</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Real Estate Agent</td><td style="padding:8px;">Yes — already working with one</td></tr>
      <tr style="background:#fff;"><td style="padding:8px;font-weight:bold;color:#555;">Timeline</td><td style="padding:8px;">Actively shopping</td></tr>
    </table>

    <h2 style="color:#002B5C;border-bottom:2px solid #eee;padding-bottom:8px;margin-top:24px;">💼 Employment &amp; Income</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px;font-weight:bold;width:180px;color:#555;">Employer</td><td style="padding:8px;">Amazon</td></tr>
      <tr style="background:#fff;"><td style="padding:8px;font-weight:bold;color:#555;">Position</td><td style="padding:8px;">Warehouse Supervisor</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Time at Job</td><td style="padding:8px;">3 years</td></tr>
      <tr style="background:#fff;"><td style="padding:8px;font-weight:bold;color:#555;">Annual Salary</td><td style="padding:8px;">$68,000</td></tr>
    </table>

    <h2 style="color:#002B5C;border-bottom:2px solid #eee;padding-bottom:8px;margin-top:24px;">💰 Assets &amp; Debts</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px;font-weight:bold;width:180px;color:#555;">Total Savings</td><td style="padding:8px;">$22,000</td></tr>
      <tr style="background:#fff;"><td style="padding:8px;font-weight:bold;color:#555;">Monthly Debts</td><td style="padding:8px;">Car payment — $450/month</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Co-Borrower</td><td style="padding:8px;">None</td></tr>
      <tr style="background:#fff;"><td style="padding:8px;font-weight:bold;color:#555;">Marital Status</td><td style="padding:8px;">Single</td></tr>
    </table>

    <h2 style="color:#002B5C;border-bottom:2px solid #eee;padding-bottom:8px;margin-top:24px;">📅 Callback Scheduled</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px;font-weight:bold;width:180px;color:#555;">Day</td><td style="padding:8px;">Thursday, April 17th</td></tr>
      <tr style="background:#fff;"><td style="padding:8px;font-weight:bold;color:#555;">Time</td><td style="padding:8px;">10:00 AM</td></tr>
    </table>

    <h2 style="color:#002B5C;border-bottom:2px solid #eee;padding-bottom:8px;margin-top:24px;">📝 Full Call Transcript</h2>
    <pre style="background:#f0f0f0;padding:16px;border-radius:6px;font-family:Arial,sans-serif;font-size:13px;white-space:pre-wrap;">{transcript}</pre>

  </div>

  <div style="background:#002B5C;padding:12px 20px;border-radius:0 0 8px 8px;text-align:center;">
    <p style="color:#90C0FF;margin:0;font-size:12px;">Jessica AI — NEXA Lending | Powered by Base44</p>
  </div>
</div>
"""

payload = {
    "to": "blivingston@nexalending.com",
    "subject": "✅ TEST — Completed Mortgage App | John Martinez | Callback: Thu April 17 @ 10 AM",
    "html": email_html
}

data = json.dumps(payload).encode('utf-8')
req = urllib.request.Request(
    EMAIL_PROXY_URL,
    data=data,
    headers={
        'Content-Type': 'application/json',
        'x-api-key': BASE44_API_KEY
    },
    method='POST'
)

try:
    with urllib.request.urlopen(req, timeout=20) as response:
        result = json.loads(response.read().decode())
        print("Result:", json.dumps(result, indent=2))
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"HTTP Error {e.code}: {body}")
except Exception as e:
    print(f"Error: {e}")
