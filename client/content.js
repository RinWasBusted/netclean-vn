/**
 * content.js
 * Content script running on Threads.net.
 * Handles scraping and modifying the post elements.
 */

let settings = {
  autoClean: true,
  hideReplies: false,
  hideReactionary: true
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
    if (!settings.autoClean) {
      stopObserver();
      return;
    }
    processPage();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

// WebSocket manager
let socket = null;
let isReconnecting = false;
const socketQueue = [];

function getWsUrl(httpUrl) {
  return httpUrl.replace(/^http/, 'ws');
}

function initWebSocketConnection() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const wsUrl = getWsUrl(serverUrl);
  console.log('Connecting to WebSocket server:', wsUrl);
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('WebSocket connection established.');
    isReconnecting = false;
    
    // Send queued requests
    while (socketQueue.length > 0) {
      const payload = socketQueue.shift();
      sendWsMessage(payload);
    }

    // Classify existing unclassified posts on reconnect
    chrome.storage.local.get(['scrapedPostsList'], (res) => {
      const list = res.scrapedPostsList || [];
      const unclassified = list.filter(item => !item.prediction && item.caption && item.caption !== '[No text content]');
      if (unclassified.length > 0) {
        console.log(`Classifying ${unclassified.length} existing unclassified posts on reconnect`);
        classifyPostsBatch(unclassified);
      }
    });
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'classification_result' && message.data) {
        handleClassificationResults(message.data);
      } else if (message.type === 'error') {
        console.error('WebSocket server error:', message.message);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  };

  socket.onclose = (event) => {
    console.warn(`WebSocket closed: code=${event.code}, reason=${event.reason}. Retrying in 3 seconds...`);
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = (err) => {
    console.error('WebSocket error:', err);
    socket.close();
  };
}

function scheduleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  setTimeout(() => {
    initWebSocketConnection();
  }, 3000);
}

function sendWsMessage(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  } else {
    socketQueue.push(payload);
    initWebSocketConnection();
  }
}

function handleClassificationResults(results) {
  chrome.storage.local.get(['scrapedPostsList', 'scrapedCount'], (res) => {
    let list = res.scrapedPostsList || [];
    const count = res.scrapedCount || list.length;
    let updated = false;

    results.forEach((resItem) => {
      const idx = list.findIndex(li => li.id === resItem.id);
      if (idx !== -1 && resItem.prediction) {
        list[idx].prediction = resItem.prediction;
        updated = true;
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

// Initialize settings and scraped posts from local storage
chrome.storage.local.get(['autoClean', 'hideReplies', 'hideReactionary', 'scrapedCount', 'scrapedPostsList'], async (data) => {
  await loadEnv();
  
  // Establish connection after serverUrl is loaded
  initWebSocketConnection();

  settings.autoClean = data.autoClean !== undefined ? !!data.autoClean : true;
  settings.hideReplies = !!data.hideReplies;
  settings.hideReactionary = data.hideReactionary !== undefined ? !!data.hideReactionary : true;
  scrapedCount = data.scrapedCount || 0;
  scrapedPostsList = data.scrapedPostsList || [];
  
  // Populate the processed post IDs set from already saved posts to prevent duplicates
  scrapedPostsList.forEach(item => {
    if (item.id) processedPosts.add(item.id);
  });
  
  if (settings.autoClean) {
    processPage();
    startObserver();
  }
});

// Listen for messages/updates from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETTINGS_CHANGED') {
    const wasAutoClean = settings.autoClean;
    settings = message.settings;
    if (settings.autoClean) {
      processPage();
      startObserver();
    } else {
      stopObserver();
      // Hủy classification request đang chờ debounce, tránh gọi API "trễ"
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      classificationQueue = [];
      // Restore all hidden elements on Threads
      restoreAllHiddenPosts();
    }
  } else if (message.type === 'CLEAR_DATA') {
    processedPosts.clear();
    scrapedCount = 0;
    scrapedPostsList = [];
    chrome.storage.local.set({ scrapedCount: 0, scrapedPostsList: [] }, () => {
      if (sendResponse) sendResponse({ status: 'cleared' });
    });
    return true; // Keep message channel open for async response
  } else if (message.type === 'TRIGGER_SCRAPE') {
    if (!settings.autoClean) {
      if (sendResponse) sendResponse({ status: 'disabled', newCount: 0 });
      return false;
    }
    const beforeCount = scrapedCount;
    processPage();
    const afterCount = scrapedCount;
    const newCount = afterCount - beforeCount;
    if (sendResponse) sendResponse({ status: 'success', newCount });
    return false;
  }
});

// React to storage changes dynamically (robust source of truth fallback)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    let changed = false;
    if (changes.autoClean !== undefined) {
      settings.autoClean = !!changes.autoClean.newValue;
      changed = true;
    }
    if (changes.hideReplies !== undefined) {
      settings.hideReplies = !!changes.hideReplies.newValue;
      changed = true;
    }
    if (changes.hideReactionary !== undefined) {
      settings.hideReactionary = !!changes.hideReactionary.newValue;
      changed = true;
    }

    if (changed) {
      if (settings.autoClean) {
        processPage();
        startObserver();
      } else {
        stopObserver();
        // Hủy classification request đang chờ debounce, tránh gọi API "trễ"
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        classificationQueue = [];
        restoreAllHiddenPosts();
      }
    }
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
  if (!settings.autoClean) {
    restoreAllHiddenPosts();
    return;
  }
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

    if (settings.autoClean && !processedPosts.has(postId)) {
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

    if (settings.autoClean && ((isReply && settings.hideReplies) || (isReactionaryPost && settings.hideReactionary))) {
      post.setAttribute('data-ext-hidden', 'true');

      // Clean up any temporary styles if any
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

    // Keyword highlighting/filtering has been deleted
    post.style.border = '';
    post.style.backgroundColor = '';
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
 * Restores visibility to all elements that were hidden by the extension
 */
function restoreAllHiddenPosts() {
  const posts = findPostElements();
  posts.forEach((post) => {
    post.removeAttribute('data-ext-hidden');
    post.style.border = '';
    post.style.backgroundColor = '';
    
    // Also clean up any styles from inner content tags if modified
    const postDetails = extractPostCaption(post);
    const contentTag = postDetails.targetElement;
    if (contentTag) {
      contentTag.style.removeProperty('border');
      contentTag.style.removeProperty('background-color');
      contentTag.style.removeProperty('color');
    }
  });
}

/**
 * Generates a simplistic unique key for each post element to avoid double scraping
 */
function getPostUniqueId(post, textContent) {
  const cleanText = textContent.slice(0, 100).replace(/\s+/g, '');
  return cleanText || post.className;
}

/**
 * Helper to check if a descendant belongs directly to the post container
 * and is not inside any nested child post container.
 */
function isDirectDescendant(post, descendant) {
  let current = descendant.parentElement;
  while (current && current !== post) {
    if (
      current.tagName === 'ARTICLE' ||
      current.getAttribute('role') === 'article' ||
      current.getAttribute('data-pressable-container') === 'true'
    ) {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

/**
 * Extract username, caption, and the target DOM element that contains the caption details
 */
function extractPostCaption(post) {
  // Get username
  let username = 'Unknown';
  const userLink = Array.from(post.querySelectorAll('a[href^="/@"]')).find(link => isDirectDescendant(post, link));
  if (userLink) {
    const href = userLink.getAttribute('href');
    const match = href.match(/^\/@([^\/]+)/);
    if (match) {
      username = match[1];
    } else {
      username = href.substring(2);
    }
  } else {
    const fallbackLink = Array.from(post.querySelectorAll('a')).find(link => isDirectDescendant(post, link));
    if (fallbackLink && fallbackLink.textContent) {
      username = fallbackLink.textContent.trim();
    }
  }

  // Look for elements with dir="auto" which Threads uses for body text and headers
  const textElements = Array.from(post.querySelectorAll('[dir="auto"]')).filter(elem => isDirectDescendant(post, elem));
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
    const spans = Array.from(post.querySelectorAll('span')).filter(span => isDirectDescendant(post, span));
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
  const lines = Array.from(post.querySelectorAll('div[style*="width: 2px"], div[style*="width:2px"]'));
  const directLines = lines.filter(line => isDirectDescendant(post, line));
  if (directLines.length > 0) {
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
  if (!settings.autoClean) {
    classificationQueue = [];
    return;
  }

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
    if (!settings.autoClean) return; // Chặn fetch nếu vừa bị tắt

    const validItems = batchToProcess.filter(item => item.caption && item.caption !== '[No text content]');
    if (validItems.length === 0) return;

    // Send via WebSocket instead of Fetch API
    const itemsPayload = validItems.map(item => ({
      id: item.id,
      text: item.caption
    }));

    sendWsMessage({
      type: 'classify',
      items: itemsPayload
    });
  }, 250); // wait 250ms for scroll-induced scrapings to group together
}

