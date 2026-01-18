// Content script for AI Slop Feed Detector
// Monitors Twitter/X feed and injects badges on posts

// Cache to avoid re-analyzing posts
const analyzedPosts = new Map();

// Queue for rate-limited processing
const analysisQueue = [];
let isProcessingQueue = false;

// Badge colors by likelihood
const BADGE_COLORS = {
  low: '#22c55e',      // Green
  medium: '#eab308',   // Yellow
  high: '#f97316',     // Orange
  certain: '#ef4444'   // Red
};

const BADGE_LABELS = {
  low: 'Not AI',
  medium: 'Possibly AI',
  high: 'Likely AI',
  certain: 'AI Post'
};

// Initialize observer when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  console.log('AI Slop Feed Detector: Initializing...');

  // Start observing for new tweets
  observeFeed();

  // Process any tweets already on page
  processTweets();
}

function observeFeed() {
  const observer = new MutationObserver((mutations) => {
    let hasNewContent = false;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasNewContent = true;
        break;
      }
    }

    if (hasNewContent) {
      // Debounce processing
      clearTimeout(observeFeed.timeout);
      observeFeed.timeout = setTimeout(processTweets, 200);
    }
  });

  // Observe the entire document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function processTweets() {
  // Find all tweet articles
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');

  for (const tweet of tweets) {
    // Skip if already processed
    if (tweet.dataset.slopAnalyzed) {
      continue;
    }

    // Mark as being processed
    tweet.dataset.slopAnalyzed = 'pending';

    // Extract tweet text
    const textElement = tweet.querySelector('[data-testid="tweetText"]');
    if (!textElement) {
      tweet.dataset.slopAnalyzed = 'no-text';
      continue;
    }

    const text = textElement.innerText.trim();

    // Skip very short posts (likely not enough to analyze)
    if (text.length < 20) {
      tweet.dataset.slopAnalyzed = 'too-short';
      continue;
    }

    // Create a unique ID for this post based on content
    const postId = hashString(text);

    // Check cache
    if (analyzedPosts.has(postId)) {
      const cached = analyzedPosts.get(postId);
      injectBadge(tweet, cached);
      tweet.dataset.slopAnalyzed = 'cached';
      continue;
    }

    // Add to analysis queue
    analysisQueue.push({ tweet, text, postId });
    processQueue();
  }
}

async function processQueue() {
  if (isProcessingQueue || analysisQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;

  while (analysisQueue.length > 0) {
    const { tweet, text, postId } = analysisQueue.shift();

    // Skip if tweet was removed from DOM
    if (!document.contains(tweet)) {
      continue;
    }

    try {
      // Add loading indicator
      injectLoadingBadge(tweet);

      // Send to background script for analysis
      const result = await chrome.runtime.sendMessage({
        action: 'analyzePost',
        text: text
      });

      if (result.error) {
        console.warn('Analysis error:', result.error);
        removeBadge(tweet);
        tweet.dataset.slopAnalyzed = 'error';
        continue;
      }

      // Cache result
      analyzedPosts.set(postId, result);

      // Inject badge
      injectBadge(tweet, result);
      tweet.dataset.slopAnalyzed = 'complete';

    } catch (error) {
      console.error('Error processing tweet:', error);
      removeBadge(tweet);
      tweet.dataset.slopAnalyzed = 'error';
    }

    // Small delay between requests to be respectful of rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  isProcessingQueue = false;
}

function injectLoadingBadge(tweet) {
  removeBadge(tweet);

  const badge = document.createElement('div');
  badge.className = 'slop-detector-badge slop-detector-loading';
  badge.innerHTML = '<span class="slop-detector-spinner"></span>';

  // Find the Grok button and insert badge before it
  const grokButton = tweet.querySelector('[aria-label="Grok actions"]');
  if (grokButton) {
    const grokContainer = grokButton.closest('.r-18u37iz');
    if (grokContainer) {
      grokContainer.parentElement.insertBefore(badge, grokContainer);
    } else {
      grokButton.parentElement.insertBefore(badge, grokButton);
    }
  } else {
    // Fallback to tweet article
    tweet.style.position = 'relative';
    tweet.appendChild(badge);
  }
}

function injectBadge(tweet, result) {
  removeBadge(tweet);

  const badge = document.createElement('div');
  badge.className = `slop-detector-badge slop-detector-${result.likelihood}`;
  badge.style.setProperty('--badge-color', BADGE_COLORS[result.likelihood]);
  badge.textContent = BADGE_LABELS[result.likelihood];

  // Create tooltip element
  const tooltip = document.createElement('div');
  tooltip.className = 'slop-detector-tooltip';
  tooltip.textContent = result.reason;
  document.body.appendChild(tooltip);

  // Position tooltip on hover
  badge.addEventListener('mouseenter', () => {
    const rect = badge.getBoundingClientRect();
    tooltip.style.top = (rect.bottom + 8) + 'px';
    tooltip.style.left = Math.max(10, rect.right - 250) + 'px';
    tooltip.classList.add('slop-detector-tooltip-visible');
  });

  badge.addEventListener('mouseleave', () => {
    tooltip.classList.remove('slop-detector-tooltip-visible');
  });

  // Store tooltip reference for cleanup
  badge.dataset.tooltipId = Date.now();
  tooltip.dataset.tooltipId = badge.dataset.tooltipId;

  // Find the Grok button and insert badge before it
  const grokButton = tweet.querySelector('[aria-label="Grok actions"]');
  if (grokButton) {
    const grokContainer = grokButton.closest('.r-18u37iz');
    if (grokContainer) {
      grokContainer.parentElement.insertBefore(badge, grokContainer);
    } else {
      grokButton.parentElement.insertBefore(badge, grokButton);
    }
  } else {
    // Fallback to tweet article
    tweet.style.position = 'relative';
    tweet.appendChild(badge);
  }
}

function removeBadge(tweet) {
  const existing = tweet.querySelector('.slop-detector-badge');
  if (existing) {
    // Also remove associated tooltip from body
    const tooltipId = existing.dataset.tooltipId;
    if (tooltipId) {
      const tooltip = document.querySelector(`.slop-detector-tooltip[data-tooltip-id="${tooltipId}"]`);
      if (tooltip) tooltip.remove();
    }
    existing.remove();
  }
}

// Simple hash function for creating post IDs
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}
