/**
 * Daily Facebook Post Generator
 * Runs every day to create a new mortgage-themed post
 */

import { createClient } from '@base44/sdk';

const base44 = createClient();

interface TopicData {
  topic: string;
  description: string;
  caption: string;
}

const TOPICS: TopicData[] = [
  {
    topic: "DPA Programs",
    description: "Down Payment Assistance programs available in AZ, AL, GA, LA, CA, MI",
    caption: "🏡 Did you know? You might qualify for DOWN PAYMENT ASSISTANCE! We help borrowers in AZ, AL, GA, LA, CA, and MI get into their dream homes with little to no money down. Apply Now → https://nexamortgageadvisors.com/applications/new #DPA #HomownershipDreams"
  },
  {
    topic: "Refinancing Tips",
    description: "How to save thousands by refinancing your mortgage at the right time",
    caption: "💰 A strategic refinance could save you THOUSANDS over the life of your loan. Apply Now → https://nexamortgageadvisors.com/applications/new #Refinance #MoneySavingTips"
  },
  {
    topic: "VA Loans",
    description: "No down payment, no PMI — benefits for veterans and active military",
    caption: "🇺🇸 Veterans: Your service has its rewards! VA loans offer ZERO down payment, no PMI, and often the lowest rates available. Apply Now → https://nexamortgageadvisors.com/applications/new #VALoans #VeteranBenefits"
  },
  {
    topic: "First-Time Buyer Myths",
    description: "Debunking common misconceptions that hold first-time homebuyers back",
    caption: "🏠 First-time buyers often qualify with 3-5% down, plus DPA programs that cover even THAT! Apply Now → https://nexamortgageadvisors.com/applications/new #FirstTimeHomeBuyer"
  },
  {
    topic: "Credit Score Tips",
    description: "Simple strategies to improve your credit score before applying",
    caption: "📈 Small credit improvements = potential $50K+ savings over 30 years. Apply Now → https://nexamortgageadvisors.com/applications/new #CreditScore"
  },
  {
    topic: "Rate Locks",
    description: "Lock in your rate now — how to protect yourself from rate increases",
    caption: "🔒 Rate locked = guaranteed. Even if rates jump tomorrow, yours stays the same. Apply Now → https://nexamortgageadvisors.com/applications/new #RateLock"
  },
  {
    topic: "FHA Loans",
    description: "Lower down payment requirements and more flexible credit standards",
    caption: "🔑 FHA: 3.5% down, flexible credit, competitive rates. Apply Now → https://nexamortgageadvisors.com/applications/new #FHALoans"
  },
  {
    topic: "Home Equity",
    description: "Tap into your home equity with a HELOC or cash-out refinance",
    caption: "💎 Unlock your equity for home improvements, education, or debt consolidation. Apply Now → https://nexamortgageadvisors.com/applications/new #HomeEquity"
  }
];

export default async function generateDailyFacebookPost(req: any) {
  try {
    console.log('[generateDailyFacebookPost] Starting...');
    
    // Select topic based on day of month
    const dayOfMonth = new Date().getDate();
    const topicData = TOPICS[dayOfMonth % TOPICS.length];
    
    console.log(`[generateDailyFacebookPost] Selected topic: ${topicData.topic}`);
    
    // Prepare email content
    const emailHtml = `
      <h2>Daily Facebook Post Ready: ${topicData.topic}</h2>
      <hr />
      <h3>Suggested Caption:</h3>
      <blockquote style="background: #f5f5f5; padding: 15px; border-left: 4px solid #1A3A5C;">
        <p>${topicData.caption}</p>
      </blockquote>
      <hr />
      <h3>Assets & Instructions:</h3>
      <p><strong>Hero Image Suggestion:</strong> Real estate, homes, families, financial success, blue & gold tones</p>
      <p><strong>Post Instructions:</strong></p>
      <ol>
        <li>Create a new Facebook post with the caption above</li>
        <li>Add a relevant image (suggest using a stock photo service like Unsplash or Pexels)</li>
        <li>Include the CTA link: https://nexamortgageadvisors.com/applications/new</li>
        <li>Post and monitor engagement!</li>
      </ol>
      <hr />
      <p><em>Generated on ${new Date().toISOString()}</em></p>
    `;
    
    // Send email to Brandyn
    const emailResponse = await base44.asServiceRole.sendEmail({
      to: 'blivingston@nexalending.com',
      subject: `Daily Facebook Post Ready: ${topicData.topic}`,
      html: emailHtml,
    });
    
    console.log('[generateDailyFacebookPost] Email sent successfully');
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Daily Facebook post generated and email sent',
        topic: topicData.topic,
        caption: topicData.caption,
      }),
    };
  } catch (error) {
    console.error('[generateDailyFacebookPost] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: String(error),
      }),
    };
  }
}
