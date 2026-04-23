import { createClient } from '@base44/sdk';

const base44 = createClient({
  appId: process.env.BASE44_APP_ID,
  token: process.env.BASE44_SERVICE_TOKEN,
  serverUrl: process.env.BASE44_API_URL,
});

interface DailyPostPayload {
  task_name: string;
  description: string;
}

export default async function generateFacebookPost(req: any) {
  try {
    console.log('Daily Facebook Post Generator started');

    // Topics to rotate through
    const topics = [
      {
        topic: 'DPA Programs',
        description: 'Down Payment Assistance programs available in AZ, AL, GA, LA, CA, MI',
        cta: 'Apply Now',
      },
      {
        topic: 'Refinancing Tips',
        description: 'How to save thousands by refinancing your mortgage at the right time',
        cta: 'Start Your Refi',
      },
      {
        topic: 'VA Loans',
        description: 'No down payment, no PMI — benefits for veterans and active military',
        cta: 'Explore VA Loans',
      },
      {
        topic: 'First-Time Buyer Myths',
        description: 'Debunking common misconceptions that hold first-time homebuyers back',
        cta: 'Apply Now',
      },
      {
        topic: 'Credit Score Tips',
        description: 'Simple strategies to improve your credit score before applying',
        cta: 'Get Pre-Approved',
      },
      {
        topic: 'Rate Locks',
        description: 'Lock in your rate now — how to protect yourself from rate increases',
        cta: 'Lock Your Rate',
      },
      {
        topic: 'FHA Loans',
        description: 'Lower down payment requirements and more flexible credit standards',
        cta: 'Apply Now',
      },
      {
        topic: 'Home Equity',
        description: 'Tap into your home equity with a HELOC or cash-out refinance',
        cta: 'Learn More',
      },
    ];

    // Pick today's topic based on day of month (deterministic rotation)
    const dayOfMonth = new Date().getDate();
    const topicIndex = dayOfMonth % topics.length;
    const selectedTopic = topics[topicIndex];

    console.log(`Selected topic: ${selectedTopic.topic}`);

    // Generate AI image
    const imagePrompt = `Professional, warm, aspirational real estate and mortgage imagery. Theme: "${selectedTopic.description}". 
    Style: modern, clean, professional photography or illustration. No text overlay, no watermarks. 
    Color tones: blues, golds, whites. Convey trust, growth, and homeownership dreams. 
    Show homes, families, success, financial growth. High quality, 16:9 aspect ratio.`;

    console.log('Generating AI image...');
    const imageResponse = await fetch('https://api.base44.com/image-generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.BASE44_SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: imagePrompt }),
    });

    if (!imageResponse.ok) {
      throw new Error(`Image generation failed: ${imageResponse.statusText}`);
    }

    const imageData = await imageResponse.json();
    const imageUrl = imageData.url;

    console.log(`Image generated: ${imageUrl}`);

    // Generate Facebook caption
    const captions: { [key: string]: string } = {
      'DPA Programs': `🏡 Did you know? You might qualify for DOWN PAYMENT ASSISTANCE! We help borrowers in AZ, AL, GA, LA, CA, and MI get into their dream homes with little to no money down. DPA programs can cover closing costs AND down payments. Don't let lack of funds hold you back! Ready to explore your options? Apply Now → https://nexamortgageadvisors.com/applications/new #DPA #HomownershipDreams #MortgageHelp`,
      'Refinancing Tips': `💰 Rates dropping? Your current rate too high? A strategic refinance could save you THOUSANDS over the life of your loan. We break down the numbers so you know exactly how much you'll save. It takes just 15 minutes to get started. Apply Now → https://nexamortgageadvisors.com/applications/new #Refinance #MoneySavingTips #MortgageLoans`,
      'VA Loans': `🇺🇸 Veterans & Active Military: Your service has its rewards! VA loans offer ZERO down payment, no PMI, and often the lowest rates available. If you've served, you've earned this benefit. Let's get you into your home TODAY. Apply Now → https://nexamortgageadvisors.com/applications/new #VALoans #VeteranBenefits #ThankYouForYourService`,
      'First-Time Buyer Myths': `🏠 MYTH: "You need 20% down to buy a home." ❌ REALITY: First-time buyers often qualify with 3-5% down, plus DPA programs that cover even THAT! We've helped hundreds of first-time buyers with limited savings. Your dream home is closer than you think. Apply Now → https://nexamortgageadvisors.com/applications/new #FirstTimeHomeBuyer #HomeownershipMadeEasy`,
      'Credit Score Tips': `📈 Your credit score holding you back? Even with a lower score, we have loan programs that work! But here's the good news: small improvements can unlock MAJOR savings. 10-point boost = potential $50K+ savings over 30 years. Ready to get qualified? Apply Now → https://nexamortgageadvisors.com/applications/new #CreditScore #MortgageQualification`,
      'Rate Locks': `🔒 In this market, a rate lock is your best friend. Once we lock your rate, it's GUARANTEED—even if rates jump tomorrow. Don't gamble with your rate. Get locked in TODAY and sleep easy. Apply Now → https://nexamortgageadvisors.com/applications/new #RateLock #MortgageTips #HomeLoans`,
      'FHA Loans': `🔑 FHA loans are a game-changer for buyers with lower down payments & flexible credit needs. 3.5% down, lower credit score requirements, and competitive rates. If traditional loans aren't your fit, FHA might be perfect. Apply Now → https://nexamortgageadvisors.com/applications/new #FHALoans #AffordableHousingOptions`,
      'Home Equity': `💎 Your home equity is your financial superpower! Tap into it with a HELOC or cash-out refinance to fund home improvements, education, or debt consolidation. Let's unlock your equity. Apply Now → https://nexamortgageadvisors.com/applications/new #HomeEquity #RefinanceOptions #SmartBorrowing`,
    };

    const fbCaption = captions[selectedTopic.topic] || captions['DPA Programs'];

    // Generate PDF flyer
    console.log('Generating PDF flyer...');
    const pdfScript = `
import sys
sys.path.insert(0, '/app')
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, PageTemplate, Frame
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import io
from datetime import datetime
from PIL import Image as PILImage
import requests

# NEXA Brand Colors
NEXA_BLUE = colors.HexColor('#1A3A5C')
NEXA_GOLD = colors.HexColor('#C9A84C')
WHITE = colors.whitespace

# Topic data
topic = "${selectedTopic.topic}"
description = "${selectedTopic.description}"
image_url = "${imageUrl}"

# Create PDF filename
pdf_filename = f"/app/facebook_post_{topic.replace(' ', '_').lower()}_{datetime.now().strftime('%Y%m%d')}.pdf"

# Download the AI-generated image
print(f"Downloading image from {image_url}...")
try:
    img_response = requests.get(image_url, timeout=30)
    img_response.raise_for_status()
    image_data = io.BytesIO(img_response.content)
    pil_img = PILImage.open(image_data)
    pil_img.save('/app/temp_image.png')
    image_path = '/app/temp_image.png'
except Exception as e:
    print(f"Error downloading image: {e}")
    image_path = None

# Define custom styles
styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    'CustomTitle',
    parent=styles['Heading1'],
    fontSize=32,
    textColor=NEXA_BLUE,
    spaceAfter=12,
    alignment=TA_CENTER,
    fontName='Helvetica-Bold'
)

subtitle_style = ParagraphStyle(
    'CustomSubtitle',
    parent=styles['Normal'],
    fontSize=14,
    textColor=NEXA_GOLD,
    spaceAfter=10,
    alignment=TA_CENTER,
    fontName='Helvetica-Bold'
)

body_style = ParagraphStyle(
    'CustomBody',
    parent=styles['Normal'],
    fontSize=11,
    textColor=NEXA_BLUE,
    leading=16,
    spaceAfter=10,
    alignment=TA_LEFT
)

cta_style = ParagraphStyle(
    'CustomCTA',
    parent=styles['Normal'],
    fontSize=16,
    textColor=WHITE,
    alignment=TA_CENTER,
    fontName='Helvetica-Bold'
)

signature_style = ParagraphStyle(
    'Signature',
    parent=styles['Normal'],
    fontSize=8,
    textColor=NEXA_BLUE,
    leading=10,
    alignment=TA_LEFT
)

# Build PDF
class HeaderFooterTemplate(PageTemplate):
    def __init__(self, *args, **kwargs):
        PageTemplate.__init__(self, *args, **kwargs)
    
    def beforeDrawPage(self, canvas, doc):
        canvas.saveState()
        # Background color strip at top
        canvas.setFillColor(NEXA_BLUE)
        canvas.rect(0, letter[1] - 0.5*inch, letter[0], 0.5*inch, fill=1)
        # NEXA Logo/Header text
        canvas.setFont('Helvetica-Bold', 16)
        canvas.setFillColor(NEXA_GOLD)
        canvas.drawString(0.5*inch, letter[1] - 0.35*inch, 'NEXA MORTGAGE ADVISORS')
        canvas.restoreState()

doc = SimpleDocTemplate(pdf_filename, pagesize=letter, topMargin=0.7*inch, bottomMargin=0.5*inch, leftMargin=0.5*inch, rightMargin=0.5*inch)

# Story elements
story = []

# Add title
story.append(Spacer(1, 0.3*inch))
story.append(Paragraph(topic, title_style))
story.append(Spacer(1, 0.1*inch))

# Add image if available
if image_path:
    try:
        img = Image(image_path, width=5.5*inch, height=3.09*inch)
        story.append(img)
        story.append(Spacer(1, 0.2*inch))
    except Exception as e:
        print(f"Error adding image: {e}")

# Add description/body copy
story.append(Paragraph(description, body_style))
story.append(Spacer(1, 0.15*inch))

# Add key benefits (bulleted)
benefits = [
    "Competitive rates and loan programs tailored to your situation",
    "Expert guidance through the entire mortgage process",
    "Fast pre-qualification and approval timelines",
    "Available across AZ, AL, GA, LA, CA, and MI"
]

for benefit in benefits:
    story.append(Paragraph(f"✓ {benefit}", body_style))

story.append(Spacer(1, 0.2*inch))

# CTA Button (styled table)
cta_data = [['APPLY NOW → https://nexamortgageadvisors.com/applications/new']]
cta_table = Table(cta_data, colWidths=[5.5*inch])
cta_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, -1), NEXA_GOLD),
    ('TEXTCOLOR', (0, 0), (-1, -1), NEXA_BLUE),
    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 12),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
    ('TOPPADDING', (0, 0), (-1, -1), 12),
    ('ROWBACKGROUNDS', (0, 0), (-1, -1), [NEXA_GOLD]),
]))
story.append(cta_table)
story.append(Spacer(1, 0.2*inch))

# Signature
signature_text = """Brandyn Livingston | Mortgage Loan Originator<br/>
5559 S. Sossaman Rd #101, Mesa, AZ 85212<br/>
📱 (214) 789-7527 | 📧 Blivingston@nexalending.com<br/>
🌐 www.nexamortgageadvisors.com<br/>
NMLS: 1196378 | Company NMLS: 1660690 | AZ License: AZMB-0944059"""

story.append(Paragraph(signature_text, signature_style))

# Build PDF
doc.build(story)
print(f"PDF created: {pdf_filename}")
`;

    // Write and execute Python script
    await new Promise<void>((resolve, reject) => {
      const fs = require('fs');
      fs.writeFileSync('/app/gen_pdf.py', pdfScript);
      
      const { execSync } = require('child_process');
      try {
        execSync('cd /app && python gen_pdf.py', { stdio: 'pipe' });
        resolve();
      } catch (e) {
        console.error('PDF generation error:', e);
        reject(e);
      }
    });

    // Upload PDF
    const fs = require('fs');
    const pdfPath = `/app/facebook_post_${selectedTopic.topic.replace(' ', '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.pdf`;
    
    let pdfUrl = '';
    if (fs.existsSync(pdfPath)) {
      const uploadResponse = await fetch('https://api.base44.com/upload-public', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.BASE44_SERVICE_TOKEN}`,
        },
        body: fs.createReadStream(pdfPath),
      });

      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        pdfUrl = uploadData.file_url;
        console.log(`PDF uploaded: ${pdfUrl}`);
      }
    }

    // Send email with PDF link and caption
    console.log('Sending email to Brandyn...');
    const emailResponse = await fetch('https://api.base44.com/send-email', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.BASE44_SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: 'blivingston@nexalending.com',
        subject: `Daily Facebook Post Ready: ${selectedTopic.topic}`,
        html: `
          <h2>Today's Facebook Post is Ready!</h2>
          <p><strong>Topic:</strong> ${selectedTopic.topic}</p>
          <hr />
          <h3>Suggested Caption:</h3>
          <p>${fbCaption}</p>
          <hr />
          <h3>Assets:</h3>
          <p><strong>Image:</strong> <a href="${imageUrl}">View Here</a></p>
          <p><strong>PDF Flyer:</strong> <a href="${pdfUrl}">Download</a></p>
          <hr />
          <p><em>Copy the caption above and post to Facebook with the image and PDF link!</em></p>
        `,
      }),
    });

    if (!emailResponse.ok) {
      console.error(`Email send failed: ${emailResponse.statusText}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        topic: selectedTopic.topic,
        imageUrl,
        pdfUrl,
        caption: fbCaption,
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(error) }),
    };
  }
}
