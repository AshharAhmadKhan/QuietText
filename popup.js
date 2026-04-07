// popup.js
// Main popup UI logic

// Tab switching
let tabScrollPositions = { presets: 0, history: 0, settings: 0 };

function showTab(tab) {
  // Save scroll position of current tab
  const currentTab = document.querySelector('.qt-tab-content:not(.hidden)');
  if (currentTab) {
    const currentTabName = currentTab.id.replace('panel', '').toLowerCase();
    tabScrollPositions[currentTabName] = currentTab.scrollTop;
  }

  document.querySelectorAll('.qt-tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.qt-tab').forEach(el => el.classList.remove('active'));

  const tabMap = { presets: 'panelPresets', history: 'panelHistory', settings: 'panelSettings' };
  const btnMap = { presets: 'tabPresets',   history: 'tabHistory',   settings: 'tabSettings'   };

  const tabContent = document.getElementById(tabMap[tab]);
  tabContent.classList.remove('hidden');
  document.getElementById(btnMap[tab]).classList.add('active');

  // Restore scroll position
  setTimeout(() => {
    tabContent.scrollTop = tabScrollPositions[tab] || 0;
  }, 0);

  if (tab === 'history') loadHistory();
  if (tab === 'presets') updatePresetUI(activePreset);
  if (tab === 'settings') updateApiKeyStatus();
}

// Send message to content script
function sendToActiveTab(message, callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      if (callback) callback({ error: 'No active tab' });
      return;
    }
    
    // Check for restricted pages
    const url = tabs[0].url || '';
    const restrictedPages = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'devtools://'];
    const isRestricted = restrictedPages.some(prefix => url.startsWith(prefix));
    
    if (isRestricted) {
      // Expected on chrome:// pages
      if (callback) callback({ error: 'restricted_page' });
      return;
    }
    
    // Timeout after 2s
    let responded = false;
    const timeoutId = setTimeout(() => {
      if (!responded && callback) {
        responded = true;
        callback({ error: 'timeout' });
      }
    }, 2000);

    chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
      if (responded) return;
      responded = true;
      clearTimeout(timeoutId);

      if (chrome.runtime.lastError) {
        // Skip warning for restricted pages
        if (!isRestricted) {
          console.warn('QuietText: content script not available on this page.');
        }
        if (callback) callback({ error: chrome.runtime.lastError.message });
        return;
      }
      if (callback) callback(response);
    });
  });
}

// Preset selection
let activePreset = null;
let presetDebounceTimer = null;

function selectPreset(preset) {
  const toggle = document.getElementById('masterToggle');
  
  // Don't toggle off if clicking the same preset
  if (activePreset === preset) return;

  activePreset = preset;
  toggle.checked = true;
  updatePresetUI(preset);
  
  // Debounce preset changes
  clearTimeout(presetDebounceTimer);
  presetDebounceTimer = setTimeout(() => {
    sendToActiveTab({ type: 'SET_PRESET', preset });
    chrome.storage.local.set({ qt_active_preset: preset });
  }, 100);
}

function updatePresetUI(preset) {
  const btns = {
    'qt-mild':    document.getElementById('btn-mild'),
    'qt-comfort': document.getElementById('btn-comfort'),
    'qt-focus':   document.getElementById('btn-focus')
  };
  Object.entries(btns).forEach(([key, btn]) => {
    if (btn) btn.classList.toggle('active', key === preset);
  });
}

let loadHistoryDebounceTimer = null;

function loadHistory() {
  // Debounce history loads
  clearTimeout(loadHistoryDebounceTimer);
  loadHistoryDebounceTimer = setTimeout(() => {
    const list = document.getElementById('historyList');
    chrome.storage.local.get(['quiettext_history'], (data) => {
      const history = data.quiettext_history || [];
      if (history.length === 0) {
        list.innerHTML = '<p class="qt-empty">Select text on any page, right-click → <strong>Analyse with QuietText</strong></p>';
        return;
      }
      list.innerHTML = history.map(entry => {
        const displayTime = entry.timestamp ? formatRelativeTime(entry.timestamp) : 'Unknown';
        return `
          <div class="qt-history-item" data-id="${entry.id}">
            <div class="qt-history-preview">${escapeHtml(entry.preview)}...</div>
            <div class="qt-history-time">${displayTime} · ${entry.original?.length || 0} chars</div>
          </div>
        `;
      }).join('');
      list.querySelectorAll('.qt-history-item').forEach(el => {
        el.addEventListener('click', () => openHistoryEntry(el.dataset.id));
      });
    });
  }, 100);
}

// Format relative time
function formatRelativeTime(timestamp) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return new Date(timestamp).toLocaleDateString();
}

function openHistoryEntry(id) {
  const list = document.getElementById('historyList');
  const items = list.querySelectorAll('.qt-history-item');
  items.forEach(item => item.style.pointerEvents = 'none');
  
  chrome.storage.local.get(['quiettext_history'], (data) => {
    const history = data.quiettext_history || [];
    const entry = history.find(e => e.id === id);
    if (!entry) {
      items.forEach(item => item.style.pointerEvents = '');
      return;
    }
    if (!entry.original || typeof entry.original !== 'string') {
      items.forEach(item => item.style.pointerEvents = '');
      showError('Corrupted history entry');
      return;
    }
    if (!entry.simplified || typeof entry.simplified !== 'string') {
      items.forEach(item => item.style.pointerEvents = '');
      showError('Corrupted history entry');
      return;
    }
    
    sendToActiveTab({ type: 'OPEN_PANEL', text: entry.original, restored: entry }, (response) => {
      if (response && !response.error) {
        window.close();
      } else {
        items.forEach(item => item.style.pointerEvents = '');
        const errorMsg = document.createElement('p');
        errorMsg.className = 'qt-error';
        errorMsg.textContent = '⚠ Could not open panel. Try refreshing the page.';
        errorMsg.style.cssText = 'color:#d32f2f;padding:8px;margin:8px 0;';
        list.insertBefore(errorMsg, list.firstChild);
        setTimeout(() => errorMsg.remove(), 3000);
      }
    });
  });
}

function clearHistory() {
  if (!confirm('Clear all history? This cannot be undone.')) {
    return;
  }
  
  const btn = document.querySelector('.qt-clear-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Clearing...';
  
  chrome.storage.local.remove(['quiettext_history'], () => {
    loadHistory();
    btn.disabled = false;
    btn.textContent = originalText;
  });
}


function showError(msg) {
  const list = document.getElementById('historyList');
  const errorMsg = document.createElement('p');
  errorMsg.className = 'qt-error';
  errorMsg.textContent = '⚠ ' + msg;
  errorMsg.style.cssText = 'color:#d32f2f;padding:8px;margin:8px 0;';
  list.insertBefore(errorMsg, list.firstChild);
  setTimeout(() => errorMsg.remove(), 3000);
}


function updateApiKeyStatus() {
  chrome.storage.local.get(['gemini_api_key'], (data) => {
    const status = document.getElementById('keyStatus');
    if (data.gemini_api_key) {
      status.innerHTML   = '✓ API key is set. <a href="#" id="removeKeyLink" style="color:#6E6E73;margin-left:6px;">Remove</a>';
      status.style.color = '#1C1C1E';
      wireRemoveKey();
    } else {
      status.textContent = '';
    }
  });
}

function saveApiKey() {
  const input  = document.getElementById('apiKeyInput');
  const status = document.getElementById('keyStatus');
  const btn    = document.querySelector('.qt-save-btn');
  const key    = input.value.trim();
  
  if (!key) {
    status.textContent = 'Please enter a valid key.';
    status.style.color = '#6E6E73';
    return;
  }
  if (!key.startsWith('gsk_') || key.length < 20) {
    status.textContent = '⚠ Invalid key format. Groq keys start with gsk_';
    status.style.color = '#d32f2f';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';

  chrome.runtime.sendMessage({ type: 'SAVE_API_KEY', key }, (response) => {
    btn.disabled = false;
    btn.textContent = 'Save';
    
    if (response && response.success) {
      status.innerHTML   = '✓ Key saved. <a href="#" id="removeKeyLink" style="color:#6E6E73;margin-left:6px;">Remove</a>';
      status.style.color = '#1C1C1E';
      input.value = '';
      wireRemoveKey();
    } else {
      status.textContent = '⚠ Failed to save key. Try again.';
      status.style.color = '#d32f2f';
    }
  });
}

function removeApiKey() {
  chrome.storage.local.remove(['gemini_api_key'], () => {
    const status = document.getElementById('keyStatus');
    status.textContent = 'Key removed.';
    status.style.color = '#6E6E73';
  });
}

function wireRemoveKey() {
  const link = document.getElementById('removeKeyLink');
  if (link) link.addEventListener('click', (e) => { e.preventDefault(); removeApiKey(); });
}


function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tabPresets').addEventListener('click',  () => {
    if (document.body.classList.contains('qt-minimized')) return;
    showTab('presets');
  });
  document.getElementById('tabHistory').addEventListener('click',  () => {
    if (document.body.classList.contains('qt-minimized')) return;
    showTab('history');
  });
  document.getElementById('tabSettings').addEventListener('click', () => {
    if (document.body.classList.contains('qt-minimized')) return;
    showTab('settings');
  });

  document.getElementById('btn-mild').addEventListener('click',    () => selectPreset('qt-mild'));
  document.getElementById('btn-comfort').addEventListener('click', () => selectPreset('qt-comfort'));
  document.getElementById('btn-focus').addEventListener('click',   () => selectPreset('qt-focus'));

  document.querySelector('.qt-clear-btn').addEventListener('click', clearHistory);
  document.querySelector('.qt-save-btn').addEventListener('click',  saveApiKey);


  const minimizeBtn = document.getElementById('minimizeBtn');
  minimizeBtn.addEventListener('click', () => {
    const minimized = document.body.classList.toggle('qt-minimized');
    minimizeBtn.textContent = minimized ? '⊕' : '⊖';
    minimizeBtn.title = minimized ? 'Restore' : 'Minimize';
    chrome.storage.local.set({ qt_popup_minimized: minimized });
  });


  let toggleLocked = false;
  document.getElementById('masterToggle').addEventListener('change', (e) => {
    if (toggleLocked) return;
    toggleLocked = true;
    setTimeout(() => { toggleLocked = false; }, 200);

    if (e.target.checked) {
      sendToActiveTab({ type: 'GET_STATE' }, (response) => {
        let preset = activePreset;
        if (response && response.preset) {
          preset = response.preset;
        } else if (!preset) {
          preset = 'qt-comfort';
        }
        activePreset = preset;
        updatePresetUI(preset);
        sendToActiveTab({ type: 'SET_PRESET', preset });
        chrome.storage.local.set({ qt_active_preset: preset });
      });
    } else {
      activePreset = null;
      updatePresetUI(null);
      sendToActiveTab({ type: 'SET_PRESET', preset: null });
      chrome.storage.local.set({ qt_active_preset: null });
    }
  });


  const introAnimation = document.getElementById('introAnimation');
  const headerContent = document.getElementById('headerContent');
  
  function skipIntro() {
    if (introAnimation) {
      introAnimation.style.display = 'none';
      headerContent.style.animation = 'none';
      headerContent.style.opacity = '1';
      document.querySelector('.qt-logo').style.animation = 'none';
      document.querySelector('.qt-logo').style.opacity = '1';
      document.querySelector('.qt-logo').style.transform = 'none';
      document.querySelector('.qt-header-controls').style.animation = 'none';
      document.querySelector('.qt-header-controls').style.opacity = '1';
      document.querySelector('.qt-header-controls').style.transform = 'none';
      document.querySelectorAll('.qt-tagline-word').forEach(word => {
        word.style.animation = 'none';
        word.style.opacity = '1';
        word.style.transform = 'none';
      });
    }
  }
  
  // Click to skip
  document.body.addEventListener('click', skipIntro, { once: true });

  setTimeout(() => {
    if (introAnimation) introAnimation.remove();
  }, 3500);


  chrome.storage.local.get(['qt_active_preset', 'gemini_api_key', 'qt_popup_minimized', 'qt_first_use'], (data) => {
    if (data.qt_popup_minimized) {
      document.body.classList.add('qt-minimized');
      document.getElementById('minimizeBtn').textContent = '⊕';
      document.getElementById('minimizeBtn').title = 'Restore';
    }
    const isFirstUse = !data.qt_first_use;
    if (isFirstUse) {
      chrome.storage.local.set({ qt_first_use: true });
    }
    sendToActiveTab({ type: 'GET_STATE' }, (response) => {
      let preset = null;
      if (response && response.preset) {
        preset = response.preset;
      } else if (data.qt_active_preset) {
        preset = data.qt_active_preset;
        sendToActiveTab({ type: 'SET_PRESET', preset });
      } else if (isFirstUse) {
        preset = 'qt-comfort';
        sendToActiveTab({ type: 'SET_PRESET', preset });
        chrome.storage.local.set({ qt_active_preset: preset });
      }

      if (preset) {
        activePreset = preset;
        document.getElementById('masterToggle').checked = true;
        updatePresetUI(activePreset);
      }
    });
    if (data.gemini_api_key) {
      const status = document.getElementById('keyStatus');
      status.innerHTML   = '✓ API key is set. <a href="#" id="removeKeyLink" style="color:#6E6E73;margin-left:6px;">Remove</a>';
      status.style.color = '#1C1C1E';
      wireRemoveKey();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (presetDebounceTimer) clearTimeout(presetDebounceTimer);
  });
});
