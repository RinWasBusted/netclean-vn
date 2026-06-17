/**
 * content.js
 * Content script running on Threads.net.
 * Handles scraping and modifying the post elements.
 */

let settings = {
  hideReplies: false,
  highlightKeywords: false,
  keywords: ''
};

// Initialize settings from local storage
chrome.storage.local.get(['hideReplies', 'highlightKeywords', 'keywords'], (data) => {
  settings.hideReplies = !!data.hideReplies;
  settings.highlightKeywords = !!data.highlightKeywords;
  settings.keywords = data.keywords || '';
  processPage();
});

// Listen for messages/updates from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETTINGS_CHANGED') {
    settings = message.settings;
    processPage();
  }
});

// A set to keep track of processed post element unique identifiers
const processedPosts = new Set();
let scrapedCount = 0;
let scrapedPostsList = [];

// Initialize settings and scraped posts from local storage
chrome.storage.local.get(['hideReplies', 'highlightKeywords', 'keywords', 'scrapedCount', 'scrapedPostsList'], (data) => {
  settings.hideReplies = !!data.hideReplies;
  settings.highlightKeywords = !!data.highlightKeywords;
  settings.keywords = data.keywords || '';
  scrapedCount = data.scrapedCount || 0;
  scrapedPostsList = data.scrapedPostsList || [];
  
  // Populate the processed post IDs set from already saved posts to prevent duplicates
  scrapedPostsList.forEach(item => {
    if (item.id) processedPosts.add(item.id);
  });
  
  processPage();
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
  const posts = Array.from(document.querySelectorAll('article, [role="article"]'));
  const detailLinks = document.querySelectorAll('a[href*="/post/"]');
  const seen = new Set(posts);
  
  for (const link of detailLinks) {
    let current = link.parentElement;
    while (current && current !== document.body) {
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
  const posts = findPostElements();
  let newPostsScraped = false;

  posts.forEach((post) => {
    // 1. Scraping and identifying post unique text
    const textContent = post.innerText || '';
    const postId = getPostUniqueId(post, textContent);

    if (!processedPosts.has(postId)) {
      processedPosts.add(postId);
      scrapedCount++;

      // Extract details
      const postDetails = extractPostCaption(post);
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
    }

    // 2. Modifying UI based on settings
    const isReply = detectIfReply(post);
    if (isReply && settings.hideReplies) {
      post.style.display = 'none';
    } else {
      post.style.display = ''; // Reset display
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
    });
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
 * Extract username and caption details from the post node
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
        break;
      }
    }
  }

  return {
    username,
    caption: caption || '[No text content]'
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

// Set up a mutation observer to handle dynamically loaded posts on scroll
const observer = new MutationObserver(() => {
  processPage();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
