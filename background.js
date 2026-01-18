// Background service worker for AI Slop Feed Detector
// Handles OpenAI API calls and settings management

const DETECTION_PROMPT = `Detect AI-generated social media slop. Focus on STRUCTURE and PATTERNS, not content topic.

STRONG INDICATORS (any one = high/certain):
- "This isn't X. This is Y." or "It's not X, it's Y" reframing
- "[Subject] isn't just X; [subject] is Y" or "They aren't just doing X; they're doing Y"
- "If you think X, you're missing Y" or "If you think X, think again"
- Dramatic staccato: "No X. No Y. No Z. Just..."
- "While others do X, [subject] quietly/actually does Y" comparisons
- Clickbait opener: emoji + ALL CAPS + alarming/hype claim (e.g., "🚨 BREAKING...")
- Emoji section headers (🚧 The problem: / 💡 The solution: / 🔥 Key insight:)
- Excessive em dashes (—) throughout the text - VERY common AI pattern
- Engagement bait question at end ("How many can...?", "Are you ready?")
- Faux-educational tone: "To understand X, you have to...", "Here's what most people miss..."
- Describing stranger's experience as profound ("A man casually...", "Someone just...")
- Breathless tech/business hype with dramatic metaphors ("invisible killer", "secret weapon", "game-changer")
- Multiple paragraphs of polished hype about a product/person/company
- Numbered threads (1/, 2/, 3/) with "insights" or "lessons"

MEDIUM INDICATORS:
- Overly polished parallel sentence structures
- LinkedIn-style corporate inspiration tone
- "Here's the thing", "The reality is", "Let me explain"
- Dramatic metaphors in technical explanations ("Trojan horse", "secret sauce")

NOT INDICATORS - these are normal:
- Short opinions or feature suggestions
- Tagging people relevant to a topic
- Discussing AI/tech topics (topic ≠ AI-generated)
- Lack of personal anecdotes
- Simple straightforward statements
- Single em dash used normally

IMPORTANT: Flag based on STRUCTURAL patterns, not topic. Long polished posts with emoji headers and em dashes throughout are almost always AI.

Post:
"""
{POST_TEXT}
"""

JSON only:
{"likelihood": "low" | "medium" | "high" | "certain", "reason": "cite specific pattern found, or 'no slop patterns detected'}"}`;

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second between requests

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzePost') {
    handleAnalyzePost(request.text).then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (request.action === 'getSettings') {
    getSettings().then(sendResponse);
    return true;
  }

  if (request.action === 'saveSettings') {
    saveSettings(request.settings).then(sendResponse);
    return true;
  }

  if (request.action === 'getStats') {
    getStats().then(sendResponse);
    return true;
  }
});

async function handleAnalyzePost(postText) {
  try {
    // Check if extension is enabled
    const settings = await getSettings();
    if (!settings.enabled) {
      return { error: 'Extension disabled' };
    }

    if (!settings.apiKey) {
      return { error: 'No API key configured' };
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    // Call OpenAI API
    const result = await analyzeWithOpenAI(postText, settings.apiKey);

    // Update stats
    await updateStats(result.likelihood);

    return result;
  } catch (error) {
    console.error('Error analyzing post:', error);
    return { error: error.message };
  }
}

async function analyzeWithOpenAI(postText, apiKey) {
  const prompt = DETECTION_PROMPT.replace('{POST_TEXT}', postText);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a skeptical AI slop detector. Lean toward flagging suspicious content. Viral/hype posts are usually AI-generated. Respond only with valid JSON, no markdown.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 150
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from API');
  }

  // Parse JSON response
  try {
    // Remove any markdown formatting if present
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanContent);

    // Validate response structure
    if (!['low', 'medium', 'high', 'certain'].includes(parsed.likelihood)) {
      throw new Error('Invalid likelihood value');
    }

    return {
      likelihood: parsed.likelihood,
      reason: parsed.reason || 'No reason provided'
    };
  } catch (parseError) {
    console.error('Failed to parse API response:', content);
    throw new Error('Failed to parse API response');
  }
}

async function getSettings() {
  const result = await chrome.storage.local.get(['apiKey', 'enabled']);
  return {
    apiKey: result.apiKey || '',
    enabled: result.enabled !== false // Default to true
  };
}

async function saveSettings(settings) {
  await chrome.storage.local.set(settings);
  return { success: true };
}

async function getStats() {
  const result = await chrome.storage.local.get(['stats']);
  return result.stats || {
    totalAnalyzed: 0,
    low: 0,
    medium: 0,
    high: 0,
    certain: 0
  };
}

async function updateStats(likelihood) {
  const stats = await getStats();
  stats.totalAnalyzed++;
  stats[likelihood]++;
  await chrome.storage.local.set({ stats });
}
