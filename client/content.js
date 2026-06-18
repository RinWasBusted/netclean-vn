/**
 * content.js
 * Content script running on Threads.net.
 * Handles scraping and modifying the post elements.
 */

let settings = {
  hideReplies: false,
  hideReactionary: true,
  highlightKeywords: false,
  keywords: ''
};

let serverUrl = 'http://localhost:5000'; // fallback default

// Inject a stable stylesheet using an attribute selector (immune to React's class-stripping/clobbering)
const extStyle = document.createElement('style');
extStyle.innerHTML = `
  [data-ext-hidden="true"] {
    display: none !important;
    opacity: 0 !important;
    height: 0 !important;
    overflow: hidden !important;
    padding: 0 !important;
    margin: 0 !important;
    pointer-events: none !important;
  }
`;

// Safely append avoiding null document.head crashes if injected early
if (document.head) {
  document.head.appendChild(extStyle);
} else {
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(extStyle));
}

// Load .env variables
async function loadEnv() {
  try {
    const url = chrome.runtime.getURL('.env');
    const response = await fetch(url);
    const text = await response.text();
    const env = {};
    text.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        if (key) env[key] = value;
      }
    });
    if (env.SERVER_URL) {
      serverUrl = env.SERVER_URL;
      console.log('Loaded SERVER_URL from .env:', serverUrl);
    }
  } catch (err) {
    console.warn('Could not load .env file, using default SERVER_URL:', serverUrl);
  }
}

// A set to keep track of processed post element unique identifiers
const processedPosts = new Set();
let scrapedCount = 0;
let scrapedPostsList = [];

// Set up a mutation observer to handle dynamically loaded posts on scroll
let observer = null;
let isProcessing = false;

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(() => {
    if (isProcessing) return;
    processPage();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Initialize settings and scraped posts from local storage
chrome.storage.local.get(['hideReplies', 'hideReactionary', 'highlightKeywords', 'keywords', 'scrapedCount', 'scrapedPostsList'], async (data) => {
  await loadEnv();
  settings.hideReplies = !!data.hideReplies;
  settings.hideReactionary = data.hideReactionary !== undefined ? !!data.hideReactionary : true;
  settings.highlightKeywords = !!data.highlightKeywords;
  settings.keywords = data.keywords || '';
  scrapedCount = data.scrapedCount || 0;
  scrapedPostsList = data.scrapedPostsList || [];
  
  // Populate the processed post IDs set from already saved posts to prevent duplicates
  scrapedPostsList.forEach(item => {
    if (item.id) processedPosts.add(item.id);
  });
  
  processPage();
  startObserver();
});

// Listen for messages/updates from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETTINGS_CHANGED') {
    settings = message.settings;
    processPage();
  } else if (message.type === 'CLEAR_DATA') {
    processedPosts.clear();
    scrapedCount = 0;
    scrapedPostsList = [];
    chrome.storage.local.set({ scrapedCount: 0, scrapedPostsList: [] }, () => {
      if (sendResponse) sendResponse({ status: 'cleared' });
    });
    return true; // Keep message channel open for async response
  } else if (message.type === 'TRIGGER_SCRAPE') {
    const beforeCount = scrapedCount;
    processPage();
    const afterCount = scrapedCount;
    const newCount = afterCount - beforeCount;
    if (sendResponse) sendResponse({ status: 'success', newCount });
    return false;
  }
});

/**
 * Scrape details and manipulate UI elements
 */
function findPostElements() {
  // Try finding standard article elements first
  let posts = Array.from(document.querySelectorAll('article, [role="article"], [data-pressable-container="true"]'));
  
  // If no containers found, look for container elements wrapping around Thread post links
  const detailLinks = document.querySelectorAll('a[href*="/post/"]');
  const seen = new Set(posts);
  
  for (const link of detailLinks) {
    let current = link.parentElement;
    while (current && current !== document.body) {
      // Look for interactive thread action wrappers (containing Like/Reply buttons)
      const titles = Array.from(current.querySelectorAll('title, svg[aria-label], [aria-label]'));
      const hasActions = titles.some(t => {
        const text = (t.textContent || t.getAttribute('aria-label') || '').trim();
        return ['Like', 'Reply', 'Repost', 'Share'].includes(text);
      });
      
      if (hasActions) {
        if (!seen.has(current)) {
          seen.add(current);
          posts.push(current);
        }
        break;
      }
      current = current.parentElement;
    }
  }
  return posts;
}

function processPage() {
  if (isProcessing) return;
  isProcessing = true;
  const posts = findPostElements();
  let newPostsScraped = false;
  const newPostsToClassify = [];

  try {
    posts.forEach((post) => {
    // Identify the specific tag containing the caption
    const postDetails = extractPostCaption(post);
    const contentTag = postDetails.targetElement;

    // Use a persistent data attribute for the unique post ID to prevent ID shifting when hidden
    let postId = post.getAttribute('data-ext-post-id');
    if (!postId) {
      // Create a stable key from the username and stable caption text, avoiding transient components like timestamps and action text
      const stableText = postDetails.username + postDetails.caption;
      postId = getPostUniqueId(post, stableText);
      post.setAttribute('data-ext-post-id', postId);
    }

    const textContent = postDetails.caption;

    if (!processedPosts.has(postId)) {
      processedPosts.add(postId);
      scrapedCount++;

      const postItem = {
        id: postId,
        username: postDetails.username,
        caption: postDetails.caption,
        timestamp: new Date().toLocaleTimeString()
      };

      scrapedPostsList.unshift(postItem); // Add new post to start of array
      
      // Limit size of stored list to last 100 items
      if (scrapedPostsList.length > 100) {
        scrapedPostsList.pop();
      }

      newPostsScraped = true;
      newPostsToClassify.push(postItem);
    }

    // 2. Modifying UI based on settings
    const isReply = detectIfReply(post);
    
    // Check if the current DOM post matches any previously cached scraped post that was flagged as REACTIONARY
    let isReactionaryPost = false;
    const matchedCachedPost = scrapedPostsList.find(item => item.id === postId);
    if (matchedCachedPost && matchedCachedPost.prediction && matchedCachedPost.prediction.classification === 'REACTIONARY') {
      isReactionaryPost = true;
    }

    if ((isReply && settings.hideReplies) || (isReactionaryPost && settings.hideReactionary)) {
      post.setAttribute('data-ext-hidden', 'true');

      // Clean up any temporary debugging highlight styles
      if (contentTag) {
        contentTag.style.removeProperty('border');
        contentTag.style.removeProperty('background-color');
        contentTag.style.removeProperty('color');
      }
    } else {
      if (contentTag) {
        contentTag.style.removeProperty('border');
        contentTag.style.removeProperty('background-color');
        contentTag.style.removeProperty('color');
      }
      
      post.removeAttribute('data-ext-hidden');
    }

    // Keyword highlighting/filtering
    if (settings.highlightKeywords && settings.keywords.trim() !== '') {
      const keywordList = settings.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      const matchesKeyword = keywordList.some(keyword => textContent.toLowerCase().includes(keyword));
      
      if (matchesKeyword) {
        post.style.border = '2px dashed #ff3040';
        post.style.backgroundColor = 'rgba(255, 48, 64, 0.05)';
      } else {
        post.style.border = '';
        post.style.backgroundColor = '';
      }
    } else {
      post.style.border = '';
      post.style.backgroundColor = '';
    }
  });

  // Save changes if new posts were scraped
  if (newPostsScraped) {
    chrome.storage.local.set({ 
      scrapedCount, 
      scrapedPostsList 
    }, () => {
      // Send message to popup to update dynamically if open
      chrome.runtime.sendMessage({ 
        type: 'POSTS_UPDATED', 
        scrapedCount, 
        scrapedPostsList 
      }, () => {
        // Ignore error if popup is closed
        if (chrome.runtime.lastError) {
          // No active listeners, safe to ignore
        }
      });

      // Classify the newly scraped posts in a batch
      if (newPostsToClassify.length > 0) {
        classifyPostsBatch(newPostsToClassify);
      }
    });
  }
  } finally {
    isProcessing = false;
  }
}

/**
 * Generates a simplistic unique key for each post element to avoid double scraping
 */
function getPostUniqueId(post, textContent) {
  const cleanText = textContent.slice(0, 100).replace(/\s+/g, '');
  return cleanText || post.className;
}

/**
 * Extract username, caption, and the target DOM element that contains the caption details
 */
function extractPostCaption(post) {
  // Get username
  let username = 'Unknown';
  const userLink = post.querySelector('a[href^="/@"]');
  if (userLink) {
    const href = userLink.getAttribute('href');
    const match = href.match(/^\/@([^\/]+)/);
    if (match) {
      username = match[1];
    } else {
      username = href.substring(2);
    }
  } else {
    const fallbackLink = post.querySelector('a');
    if (fallbackLink && fallbackLink.textContent) {
      username = fallbackLink.textContent.trim();
    }
  }

  // Look for elements with dir="auto" which Threads uses for body text and headers
  const textElements = Array.from(post.querySelectorAll('[dir="auto"]'));
  let caption = '';
  let targetElement = null;
  
  for (const elem of textElements) {
    // Clone element to clean up any nested Translate buttons/text
    const cloned = elem.cloneNode(true);
    cloned.querySelectorAll('[role="button"], button, a[role="button"]').forEach(btn => btn.remove());
    
    let text = cloned.textContent.replace(/&nbsp;/g, ' ').replace(/[\s\u00A0\xa0]+/g, ' ').trim();
    if (!text) continue;
    
    // Exclude username variations
    if (text === username || ('@' + username) === text) continue;
    
    // Exclude action elements (buttons, link buttons)
    let isActionOrFooter = false;
    let current = elem;
    while (current && current !== post) {
      const role = current.getAttribute('role');
      if (role === 'button' || current.tagName === 'BUTTON' || current.tagName === 'A' && current.getAttribute('href')?.includes('/status/')) {
        isActionOrFooter = true;
        break;
      }
      current = current.parentElement;
    }
    
    if (isActionOrFooter) continue;
    
    // Ignore timestamps (e.g. 2h, 1d, 34m, Just now, 18h, 6h)
    if (/^([0-9]+[hdmw]|Just now|•)$/.test(text)) continue;

    if (text.endsWith('Translate')) {
      text = text.substring(0, text.length - 9).trim();
    }

    // We accumulate text elements or choose the longest/first substantial block
    if (text.length > caption.length) {
      caption = text;
      targetElement = elem;
    }
  }
  
  if (!caption) {
    // Search within span tags as fallback
    const spans = Array.from(post.querySelectorAll('span'));
    for (const span of spans) {
      let text = span.textContent.replace(/&nbsp;/g, ' ').replace(/[\s\u00A0\xa0]+/g, ' ').trim();
      if (text.endsWith('Translate')) {
        text = text.substring(0, text.length - 9).trim();
      }
      if (text.length > 15 && !text.includes('Reply') && !text.includes('Repost') && text !== username) {
        caption = text;
        targetElement = span;
        break;
      }
    }
  }

  return {
    username,
    caption: caption || '[No text content]',
    targetElement
  };
}

/**
 * Simple heuristics to detect if the element represents a reply post
 */
function detectIfReply(post) {
  // Threads replies usually contain thread lines connecting them, 
  // or have a specific structure where the post text starts with/contains user tags.
  // We check for elements resembling the vertical thread connector lines (typically divs with absolute positioning and width ~2px).
  const lines = post.querySelectorAll('div[style*="width: 2px"], div[style*="width:2px"]');
  if (lines.length > 0) {
    return true;
  }
  // Check if it resides in a nested block or sibling structures representing replies
  return false;
}



/**
 * Sends a batch of post captions to our Node server for classification
 */
let classificationQueue = [];
let debounceTimer = null;

function classifyPostsBatch(newItems) {
  // Add new items to classification queue
  classificationQueue.push(...newItems);

  // Clear previous debounce timer to batch requests within a short timeframe
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Set debounce timer to execute classification request once scraping bursts settle
  debounceTimer = setTimeout(() => {
    const batchToProcess = [...classificationQueue];
    classificationQueue = [];

    if (batchToProcess.length === 0) return;

    const validItems = batchToProcess.filter(item => item.caption && item.caption !== '[No text content]');
    if (validItems.length === 0) return;

    const texts = validItems.map(item => item.caption);

    fetch(`${serverUrl}/api/v1/classify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ texts })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success && data.data && data.data.length > 0) {
        chrome.storage.local.get(['scrapedPostsList', 'scrapedCount'], (res) => {
          let list = res.scrapedPostsList || [];
          const count = res.scrapedCount || list.length;
          let updated = false;

          validItems.forEach((item, index) => {
            const prediction = data.data[index];
            if (prediction) {
              const idx = list.findIndex(li => li.id === item.id);
              if (idx !== -1) {
                list[idx].prediction = prediction;
                updated = true;
              }
            }
          });

          if (updated) {
            scrapedPostsList = list;
            chrome.storage.local.set({ scrapedPostsList: list }, () => {
              // Notify popup to refresh UI
              chrome.runtime.sendMessage({
                type: 'POSTS_UPDATED',
                scrapedCount: count,
                scrapedPostsList: list
              }, () => {
                if (chrome.runtime.lastError) {
                  // Ignore error if popup is closed
                }
              });

              // Re-run processPage to apply DOM hiding/filtering to newly classified posts
              processPage();
            });
          }
        });
      }
    })
    .catch(err => {
      console.error('Error classifying batch of posts:', err);
    });
  }, 250); // wait 250ms for scroll-induced scrapings to group together
}

