// background.js
// Service worker. Handles context menu and all Groq API calls.
// Cannot access DOM. Communicates with content/panel via chrome.runtime messages.

importScripts("gemini.js");

// --- Context Menu Setup ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'quiettext-analyse',
    title: 'Analyse with QuietText',
    contexts: ['selection']
  });
});

// --- Context Menu Click ---
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'quiettext-analyse' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'OPEN_PANEL',
      text: info.selectionText
    }, () => { void chrome.runtime.lastError; });
  }
});

// --- Keyboard Shortcut Handler ---
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-panel') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      
      // Execute script to get selected text
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => window.getSelection().toString().trim()
      }, (results) => {
        if (chrome.runtime.lastError) {
          console.warn('QuietText: Could not access page');
          return;
        }
        
        const selectedText = results && results[0] && results[0].result;
        // Open panel even if no text selected (will show tip)
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'OPEN_PANEL',
          text: selectedText || ''
        }, () => { void chrome.runtime.lastError; });
      });
    });
  }
});

// --- Message Router ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Validate message structure
  if (!message || typeof message !== 'object' || !message.type) {
    console.warn('Invalid message received:', message);
    return;
  }

  // API key save
  if (message.type === 'SAVE_API_KEY') {
    chrome.storage.local.set({ gemini_api_key: message.key }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  // API key check
  if (message.type === 'GET_API_KEY') {
    (async () => {
      try {
        const data = await chrome.storage.local.get(['gemini_api_key']);
        sendResponse({ key: data.gemini_api_key || null });
      } catch (e) {
        sendResponse({ key: null });
      }
    })().catch(err => console.error('GET_API_KEY error:', err));
    return true;
  }

  // Simplify — always call callGemini, let gemini.js handle DEFAULT_API_KEY fallback
  if (message.type === 'SIMPLIFY') {
    (async () => {
      try {
        const data = await chrome.storage.local.get(['gemini_api_key']);
        const apiKey = data.gemini_api_key || null;
        const result = await callGemini(PROMPTS.simplify, message.text, apiKey);
        sendResponse({ result });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })().catch(err => console.error('SIMPLIFY error:', err));
    return true;
  }

  // Explain — always call callGemini, let gemini.js handle DEFAULT_API_KEY fallback
  if (message.type === 'EXPLAIN') {
    const styleMap = {
      plain:   PROMPTS.explainPlain,
      bullets: PROMPTS.explainBullets,
      steps:   PROMPTS.explainSteps
    };
    (async () => {
      try {
        const data = await chrome.storage.local.get(['gemini_api_key']);
        const apiKey = data.gemini_api_key || null;
        const prompt = styleMap[message.style] || PROMPTS.explainPlain;
        const result = await callGemini(prompt, message.text, apiKey);
        sendResponse({ result });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })().catch(err => console.error('EXPLAIN error:', err));
    return true;
  }

  // Explain highlight — called from content.js when user highlights text
  if (message.type === 'EXPLAIN_HIGHLIGHT') {
    (async () => {
      try {
        const data = await chrome.storage.local.get(['gemini_api_key']);
        const apiKey = data.gemini_api_key || null;
        const result = await callGemini(PROMPTS.explainHighlight, message.text, apiKey);
        sendResponse({ result });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })().catch(err => console.error('EXPLAIN_HIGHLIGHT error:', err));
    return true;
  }

  // Unknown message type
  console.warn('Unknown message type:', message.type);

});
