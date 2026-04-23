#!/usr/bin/env python3
"""
Daily Facebook Post Generator - Skill wrapper
Runs the full post generation workflow.
This skill is designed to be called by the backend function.
"""

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
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib import colors

# Colors
NEXA_BLUE = colors.HexColor('#1A3A5C')
NEXA_GOLD = colors.HexColor('#C9A84C')
WHITE = colors.white

# Topics to rotate
TOPICS = [
    {
        "topic": "DPA Programs",
        "description": "Down Payment Assistance programs available in AZ, AL, GA, LA, CA, MI",
        "image_prompt": "Down payment assistance mortgage program. Happy family in front of new home. Real estate success. Professional, warm, aspirational. Blue and gold tones.",
        "caption": "🏡 Did you know? You might qualify for DOWN PAYMENT ASSISTANCE! We help borrowers in AZ, AL, GA, LA, CA, and MI get into their dream homes with little to no money down. DPA programs can cover closing costs AND down payments. Don't let lack of funds hold you back! Ready to explore your options? Apply Now → https://nexamortgageadvisors.com/applications/new #DPA #HomownershipDreams #MortgageHelp"
    },
    {
        "topic": "Refinancing Tips",
        "description": "How to save thousands by refinancing your mortgage at the right time",
        "image_prompt": "Refinance mortgage concept. Person analyzing financial documents. Savings, growth, success. Professional, modern, aspirational. Blue and gold.",
        "caption": "💰 Rates dropping? Your current rate too high? A strategic refinance could save you THOUSANDS over the life of your loan. We break down the numbers so you know exactly how much you'll save. It takes just 15 minutes to get started. Apply Now → https://nexamortgageadvisors.com/applications/new #Refinance #MoneySavingTips #MortgageLoans"
    },
    {
        "topic": "VA Loans",
        "description": "No down payment, no PMI — benefits for veterans and active military",
        "image_prompt": "Military veteran homebuyer. American flag. Home purchase. Patriotic, professional, proud. Blue and gold tones.",
        "caption": "🇺🇸 Veterans & Active Military: Your service has its rewards! VA loans offer ZERO down payment, no PMI, and often the lowest rates available. If you've served, you've earned this benefit. Let's get you into your home TODAY. Apply Now → https://nexamortgageadvisors.com/applications/new #VALoans #VeteranBenefits #ThankYouForYourService"
    },
    {
        "topic": "First-Time Buyer Myths",
        "description": "Debunking common misconceptions that hold first-time homebuyers back",
        "image_prompt": "First time home buyer. Young family or couple with new keys. Happy, hopeful, excited. Real estate success. Professional, modern.",
        "caption": "🏠 MYTH: 'You need 20% down to buy a home.' ❌ REALITY: First-time buyers often qualify with 3-5% down, plus DPA programs that cover even THAT! We've helped hundreds of first-time buyers with limited savings. Your dream home is closer than you think. Apply Now → https://nexamortgageadvisors.com/applications/new #FirstTimeHomeBuyer #HomeownershipMadeEasy"
    },
    {
        "topic": "Credit Score Tips",
        "description": "Simple strategies to improve your credit score before applying",
        "image_prompt": "Credit score improvement. Financial growth chart. Person managing finances. Success, upward trend. Professional, blue and gold.",
        "caption": "📈 Your credit score holding you back? Even with a lower score, we have loan programs that work! But here's the good news: small improvements can unlock MAJOR savings. 10-point boost = potential $50K+ savings over 30 years. Ready to get qualified? Apply Now → https://nexamortgageadvisors.com/applications/new #CreditScore #MortgageQualification"
    },
    {
        "topic": "Rate Locks",
        "description": "Lock in your rate now — how to protect yourself from rate increases",
        "image_prompt": "Mortgage rate lock security. Padlock protecting home. Safety, security, confidence. Professional, modern, blue tones.",
        "caption": "🔒 In this market, a rate lock is your best friend. Once we lock your rate, it's GUARANTEED—even if rates jump tomorrow. Don't gamble with your rate. Get locked in TODAY and sleep easy. Apply Now → https://nexamortgageadvisors.com/applications/new #RateLock #MortgageTips #HomeLoans"
    },
    {
        "topic": "FHA Loans",
        "description": "Lower down payment requirements and more flexible credit standards",
        "image_prompt": "FHA loan program. Affordable home purchase. Accessible homeownership. Family, hope, success. Professional, modern, inviting.",
        "caption": "🔑 FHA loans are a game-changer for buyers with lower down payments & flexible credit needs. 3.5% down, lower credit score requirements, and competitive rates. If traditional loans aren't your fit, FHA might be perfect. Apply Now → https://nexamortgageadvisors.com/applications/new #FHALoans #AffordableHousingOptions"
    },
    {
        "topic": "Home Equity",
        "description": "Tap into your home equity with a HELOC or cash-out refinance",
        "image_prompt": "Home equity access. House with financial growth. Financial freedom. Wealth building. Professional, modern, aspirational.",
        "caption": "💎 Your home equity is your financial superpower! Tap into it with a HELOC or cash-out refinance to fund home improvements, education, or debt consolidation. Let's unlock your equity. Apply Now → https://nexamortgageadvisors.com/applications/new #HomeEquity #RefinanceOptions #SmartBorrowing"
    }
]

def generate_facebook_post():
    try:
        # Select topic based on day of month
        day_of_month = datetime.now().day
        topic_data = TOPICS[day_of_month % len(TOPICS)]
        
        print(f"[Daily FB Post] Selected topic: {topic_data['topic']}")
        
        # We can't call generate_image here directly, so we'll save a placeholder
        # The actual image generation will need to happen via the backend function
        # calling the SDK, or we use a fallback image URL
        
        # For now, use a placeholder image URL (you could use a stock image service)
        image_url = "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200&h=675&fit=crop"
        print(f"[Daily FB Post] Using stock image: {image_url}")
        
        # Download image for PDF
        print("[Daily FB Post] Downloading image...")
        img_response = requests.get(image_url, timeout=30)
        if img_response.status_code == 200:
            from PIL import Image as PILImage
            img = PILImage.open(io.BytesIO(img_response.content))
            img_path = '/app/temp_post_image.png'
            img.save(img_path)
        else:
            print(f"[WARNING] Could not download image, proceeding without...")
            img_path = None
        
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
        
        # Image if available
        if img_path and os.path.exists(img_path):
            try:
                story.append(Image(img_path, width=6*inch, height=3.375*inch))
                story.append(Spacer(1, 0.15*inch))
            except Exception as e:
                print(f"[WARNING] Could not add image to PDF: {e}")
        
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
        
        # Upload PDF publicly
        print("[Daily FB Post] Uploading PDF...")
        with open(pdf_filename, 'rb') as f:
            upload_response = requests.post(
                'https://api.base44.com/upload-public',
                headers={'Authorization': f"Bearer {os.environ.get('BASE44_SERVICE_TOKEN')}"},
                files={'file': f}
            )
        
        if upload_response.status_code != 200:
            print(f"[ERROR] PDF upload failed: {upload_response.status_code}")
            print(f"Response: {upload_response.text[:200]}")
            return
        
        try:
            pdf_data = upload_response.json()
            pdf_url = pdf_data.get('file_url') or pdf_data.get('url')
        except:
            pdf_url = upload_response.text[:200]
        
        print(f"[Daily FB Post] PDF uploaded: {pdf_url}")
        
        # Send email to Brandyn
        print("[Daily FB Post] Sending email...")
        email_html = f"""
        <h2>Daily Facebook Post Ready: {topic_data['topic']}</h2>
        <hr />
        <h3>Suggested Caption:</h3>
        <blockquote style="background: #f5f5f5; padding: 15px; border-left: 4px solid #1A3A5C;">
        <p><code>{topic_data['caption']}</code></p>
        </blockquote>
        <hr />
        <h3>Assets:</h3>
        <p><strong>Hero Image:</strong> <a href="{image_url}">View</a></p>
        <p><strong>PDF Flyer:</strong> <a href="{pdf_url}">Download</a></p>
        <hr />
        <p>👉 <strong>Post Instructions:</strong> Copy the caption above and post to your Facebook page with both the image and PDF link!</p>
        """
        
        email_response = requests.post(
            'https://api.base44.com/send-email',
            headers={
                'Authorization': f"Bearer {os.environ.get('BASE44_SERVICE_TOKEN')}",
                'Content-Type': 'application/json'
            },
            json={
                'to': 'blivingston@nexalending.com',
                'subject': f"Daily Facebook Post Ready: {topic_data['topic']}",
                'html': email_html
            }
        )
        
        if email_response.status_code != 200:
            print(f"[ERROR] Email send failed: {email_response.status_code}")
            print(f"Response: {email_response.text[:200]}")
            return
        
        print("[Daily FB Post] ✅ Complete! Email sent to Brandyn.")
        print(json.dumps({
            'status': 'success',
            'topic': topic_data['topic'],
            'image_url': image_url,
            'pdf_url': pdf_url,
        }, indent=2))
        
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    generate_facebook_post()
