document.addEventListener('DOMContentLoaded', () => {
  const autoCleanCheck = document.getElementById('autoClean');
  const hideRepliesCheck = document.getElementById('hideReplies');
  const hideReactionaryCheck = document.getElementById('hideReactionary');
  const scrapeBtn = document.getElementById('scrapeBtn');
  const postCountSpan = document.getElementById('postCount');
  const feedContainer = document.getElementById('feedContainer');
  const clearBtn = document.getElementById('clearBtn');

  // Helper function to render scraped posts list
  function renderFeed(postsList) {
    if (!postsList || postsList.length === 0) {
      feedContainer.innerHTML = '<div class="empty-feed">No posts scraped yet. Scroll Threads web to capture!</div>';
      return;
    }

    feedContainer.innerHTML = '';
    postsList.forEach(post => {
      const item = document.createElement('div');
      item.className = 'feed-item';

      const header = document.createElement('div');
      header.className = 'feed-header';

      const user = document.createElement('span');
      user.className = 'feed-user';
      user.textContent = `@${post.username}`;

      const time = document.createElement('span');
      time.textContent = post.timestamp;

      header.appendChild(user);
      header.appendChild(time);

      const caption = document.createElement('div');
      caption.className = 'feed-caption';
      caption.textContent = post.caption;

      item.appendChild(header);
      item.appendChild(caption);

      if (post.prediction) {
        const predictionDiv = document.createElement('div');
        predictionDiv.style.marginTop = '6px';
        predictionDiv.style.padding = '4px 6px';
        predictionDiv.style.borderRadius = '4px';
        
        const isReactionary = post.prediction.classification === 'REACTIONARY';
        predictionDiv.style.backgroundColor = isReactionary ? 'rgba(255, 48, 64, 0.15)' : '#222';
        predictionDiv.style.border = isReactionary ? '1px solid #ff3040' : '1px solid #333';
        predictionDiv.style.fontSize = '10px';
        predictionDiv.style.color = isReactionary ? '#ff8080' : '#aaa';

        let predictionText = `<strong>Status:</strong> ${post.prediction.classification}<br>`;
        predictionText += 'Probabilities:<br>';
        
        const probs = post.prediction.probabilities || {};
        for (const [label, val] of Object.entries(probs)) {
          const percentage = (val * 100).toFixed(1);
          predictionText += `• <strong>${label}</strong>: ${percentage}%<br>`;
        }
        predictionDiv.innerHTML = predictionText;
        item.appendChild(predictionDiv);
      }

      feedContainer.appendChild(item);
    });
  }

  // Helper to save settings automatically
  function saveSettings() {
    const settings = {
      autoClean: autoCleanCheck.checked,
      hideReplies: hideRepliesCheck.checked,
      hideReactionary: hideReactionaryCheck.checked
    };

    chrome.storage.local.set(settings, () => {
      // Notify active tab about the change
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_CHANGED', settings });
        }
      });
    });
  }

  autoCleanCheck.addEventListener('change', saveSettings);
  hideRepliesCheck.addEventListener('change', saveSettings);
  hideReactionaryCheck.addEventListener('change', saveSettings);

  // Load saved settings & scraped items
  chrome.storage.local.get(['autoClean', 'hideReplies', 'hideReactionary', 'scrapedCount', 'scrapedPostsList'], (data) => {
    autoCleanCheck.checked = data.autoClean !== undefined ? !!data.autoClean : true;
    hideRepliesCheck.checked = !!data.hideReplies;
    hideReactionaryCheck.checked = data.hideReactionary !== undefined ? !!data.hideReactionary : true;
    postCountSpan.textContent = data.scrapedCount || 0;
    renderFeed(data.scrapedPostsList);
  });

  // Listen to background/content script messages for live updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'POSTS_UPDATED') {
      postCountSpan.textContent = message.scrapedCount;
      renderFeed(message.scrapedPostsList);
    }
  });

  // Clear data handler
  clearBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_DATA' }, () => {
          postCountSpan.textContent = 0;
          renderFeed([]);
        });
      } else {
        // Fallback if not on active tab
        chrome.storage.local.set({ scrapedCount: 0, scrapedPostsList: [] }, () => {
          postCountSpan.textContent = 0;
          renderFeed([]);
        });
      }
    });
  });

  scrapeBtn.addEventListener('click', () => {
    chrome.storage.local.get('autoClean', (data) => {
      const isAutoCleanEnabled = data.autoClean !== undefined ? !!data.autoClean : true;
      if (!isAutoCleanEnabled) {
        scrapeBtn.textContent = 'Auto Clean is Off';
        setTimeout(() => {
          scrapeBtn.textContent = 'Scrape Posts Now';
        }, 1500);
        return;
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          scrapeBtn.textContent = 'Scraping...';
          scrapeBtn.disabled = true;
          chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_SCRAPE' }, (response) => {
            if (chrome.runtime.lastError) {
              scrapeBtn.textContent = 'Error: Open Threads!';
            } else {
              if (response && response.status === 'disabled') {
                scrapeBtn.textContent = 'Auto Clean is Off';
              } else {
                scrapeBtn.textContent = response && response.newCount !== undefined ? `Scraped! (${response.newCount} new)` : 'Scraped!';
              }
            }
            setTimeout(() => {
              scrapeBtn.textContent = 'Scrape Posts Now';
              scrapeBtn.disabled = false;
            }, 1500);
          });
        } else {
          scrapeBtn.textContent = 'Error: No active tab!';
          setTimeout(() => {
            scrapeBtn.textContent = 'Scrape Posts Now';
          }, 1500);
        }
      });
    });
  });
});
