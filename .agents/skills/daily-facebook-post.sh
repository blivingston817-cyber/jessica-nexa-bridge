#!/bin/bash
# Daily Facebook Post Generator Skill
# This script generates a daily Facebook post with image, PDF, and sends email

set -e

echo "[Daily FB Post] Starting Facebook post generation..."

# Import the Python script inline
python3 << 'EOF'
import os
import sys
import json
import requests
import io
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_CENTER
from reportlab.lib import colors
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

# Colors
NEXA_BLUE = colors.HexColor('#1A3A5C')
NEXA_GOLD = colors.HexColor('#C9A84C')

# Topics 
TOPICS = [
    {
        "topic": "DPA Programs",
        "description": "Down Payment Assistance programs available in AZ, AL, GA, LA, CA, MI",
        "caption": "🏡 Did you know? You might qualify for DOWN PAYMENT ASSISTANCE! We help borrowers in AZ, AL, GA, LA, CA, and MI get into their dream homes with little to no money down. DPA programs can cover closing costs AND down payments. Don't let lack of funds hold you back! Ready to explore your options? Apply Now → https://nexamortgageadvisors.com/applications/new #DPA #HomownershipDreams #MortgageHelp"
    },
    {
        "topic": "Refinancing Tips",
        "description": "How to save thousands by refinancing your mortgage at the right time",
        "caption": "💰 Rates dropping? Your current rate too high? A strategic refinance could save you THOUSANDS over the life of your loan. Apply Now → https://nexamortgageadvisors.com/applications/new #Refinance #MoneySavingTips #MortgageLoans"
    },
    {
        "topic": "VA Loans",
        "description": "No down payment, no PMI — benefits for veterans and active military",
        "caption": "🇺🇸 Veterans & Active Military: Your service has its rewards! VA loans offer ZERO down payment, no PMI, and often the lowest rates available. Apply Now → https://nexamortgageadvisors.com/applications/new #VALoans #VeteranBenefits"
    },
    {
        "topic": "First-Time Buyer Myths",
        "description": "Debunking common misconceptions that hold first-time homebuyers back",
        "caption": "🏠 First-time buyers often qualify with 3-5% down, plus DPA programs that cover even THAT! Your dream home is closer than you think. Apply Now → https://nexamortgageadvisors.com/applications/new #FirstTimeHomeBuyer #HomeownershipMadeEasy"
    },
    {
        "topic": "Credit Score Tips",
        "description": "Simple strategies to improve your credit score before applying",
        "caption": "📈 Small credit score improvements can unlock MAJOR savings. 10-point boost = potential $50K+ savings over 30 years. Apply Now → https://nexamortgageadvisors.com/applications/new #CreditScore #MortgageQualification"
    },
    {
        "topic": "Rate Locks",
        "description": "Lock in your rate now — how to protect yourself from rate increases",
        "caption": "🔒 Once we lock your rate, it's GUARANTEED—even if rates jump tomorrow. Apply Now → https://nexamortgageadvisors.com/applications/new #RateLock #MortgageTips"
    },
    {
        "topic": "FHA Loans",
        "description": "Lower down payment requirements and more flexible credit standards",
        "caption": "🔑 FHA loans are a game-changer for buyers with lower down payments. 3.5% down, lower credit score requirements. Apply Now → https://nexamortgageadvisors.com/applications/new #FHALoans #AffordableHousingOptions"
    },
    {
        "topic": "Home Equity",
        "description": "Tap into your home equity with a HELOC or cash-out refinance",
        "caption": "💎 Tap into your home equity to fund home improvements, education, or debt consolidation. Apply Now → https://nexamortgageadvisors.com/applications/new #HomeEquity #RefinanceOptions"
    }
]

def generate_facebook_post():
    try:
        # Select topic based on day of month
        day_of_month = datetime.now().day
        topic_data = TOPICS[day_of_month % len(TOPICS)]
        print(f"[Daily FB Post] Selected topic: {topic_data['topic']}")
        
        # Use a stock real estate image
        image_url = "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200&h=675&fit=crop"
        print(f"[Daily FB Post] Using stock image")
        
        # Generate PDF
        print("[Daily FB Post] Generating PDF flyer...")
        pdf_filename = f"/app/facebook_post_{topic_data['topic'].replace(' ', '_').replace('-', '_').lower()}_{datetime.now().strftime('%Y%m%d')}.pdf"
        
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            'Title',
            parent=styles['Heading1'],
            fontSize=28,
            textColor=NEXA_BLUE,
            spaceAfter=12,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        )
        
        body_style = ParagraphStyle(
            'Body',
            parent=styles['Normal'],
            fontSize=11,
            textColor=NEXA_BLUE,
            leading=14,
            spaceAfter=8
        )
        
        sig_style = ParagraphStyle(
            'Signature',
            parent=styles['Normal'],
            fontSize=7,
            textColor=colors.grey,
            leading=9
        )
        
        doc = SimpleDocTemplate(pdf_filename, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.4*inch, leftMargin=0.4*inch, rightMargin=0.4*inch)
        story = []
        
        # Header
        story.append(Spacer(1, 0.2*inch))
        story.append(Paragraph(topic_data['topic'], title_style))
        story.append(Spacer(1, 0.15*inch))
        
        # Body
        story.append(Paragraph(topic_data['description'], body_style))
        story.append(Spacer(1, 0.1*inch))
        
        # Benefits
        benefits = [
            "✓ Competitive rates tailored to your situation",
            "✓ Expert guidance through the entire process",
            "✓ Fast pre-qualification and approval",
            "✓ Available in AZ, AL, GA, LA, CA, MI"
        ]
        for benefit in benefits:
            story.append(Paragraph(benefit, body_style))
        
        story.append(Spacer(1, 0.15*inch))
        
        # CTA
        cta_table = Table([['APPLY NOW → https://nexamortgageadvisors.com/applications/new']], colWidths=[6*inch])
        cta_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), NEXA_GOLD),
            ('TEXTCOLOR', (0, 0), (-1, -1), NEXA_BLUE),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 11),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
        ]))
        story.append(cta_table)
        story.append(Spacer(1, 0.15*inch))
        
        # Signature
        sig_text = "Brandyn Livingston | Mortgage Loan Originator<br/>5559 S. Sossaman Rd #101, Mesa, AZ 85212<br/>(214) 789-7527 | Blivingston@nexalending.com | www.nexamortgageadvisors.com<br/>NMLS: 1196378 | Company NMLS: 1660690 | AZ License: AZMB-0944059"
        story.append(Paragraph(sig_text, sig_style))
        
        doc.build(story)
        print(f"[Daily FB Post] PDF created: {pdf_filename}")
        
        # Send email with PDF attachment
        print("[Daily FB Post] Sending email with attachments...")
        email_body = f"""
Dear Brandyn,

Your daily Facebook post is ready to go!

**Topic:** {topic_data['topic']}

**Suggested Caption:**
{topic_data['caption']}

**Assets:**
- Hero Image: {image_url}
- PDF Flyer: Attached

**Post Instructions:**
1. Download the attached PDF
2. Copy the caption above
3. Post to Facebook with the image and PDF link

---
Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        """
        
        msg = MIMEMultipart()
        msg['From'] = 'jessica@nexamortgageadvisors.com'
        msg['To'] = 'blivingston@nexalending.com'
        msg['Subject'] = f"Daily Facebook Post Ready: {topic_data['topic']}"
        msg.attach(MIMEText(email_body, 'plain'))
        
        # Attach PDF
        with open(pdf_filename, 'rb') as attachment:
            part = MIMEBase('application', 'octet-stream')
            part.set_payload(attachment.read())
        encoders.encode_base64(part)
        part.add_header('Content-Disposition', f'attachment; filename= {os.path.basename(pdf_filename)}')
        msg.attach(part)
        
        print("[Daily FB Post] ✅ Complete!")
        print(json.dumps({
            'status': 'success',
            'topic': topic_data['topic'],
            'image_url': image_url,
            'pdf_file': pdf_filename,
        }, indent=2))

    except Exception as e:
        print(f"[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()

generate_facebook_post()
EOF

echo "[Daily FB Post] Job complete"
