// panel.js
// Controls the floating AI panel.

let originalText   = '';
let simplifiedText = '';
let metricsChart   = null;

// ── DOM refs ──
const originalBox    = document.getElementById('originalText');
const simplifyBtn    = document.getElementById('simplifyBtn');
const explainBtn     = document.getElementById('explainBtn');
const explainStyle   = document.getElementById('explainStyle');
const resultSection  = document.getElementById('resultSection');
const resultLabel    = document.getElementById('resultLabel');
const resultText     = document.getElementById('resultText');
const loadingState   = document.getElementById('loadingState');
const errorState     = document.getElementById('errorState');
const metricsSection = document.getElementById('metricsSection');
const metricsGrid    = document.getElementById('metricsGrid');
const closeBtn       = document.getElementById('closeBtn');
const copyBtn        = document.getElementById('copyBtn');
const expandBtn      = document.getElementById('expandBtn');

// ── Close panel ──
closeBtn.addEventListener('click', () => {
  window.parent.postMessage({ type: 'CLOSE_PANEL' }, '*');
});

// ── Drag panel via header (4-dot grip) ──
const panelHeader = document.querySelector('.qt-panel-header');
let isDragging = false;

panelHeader.addEventListener('pointerdown', (e) => {
  // Only drag from header, not from close button
  if (e.target.closest('.qt-close-btn')) return;
  
  isDragging = true;
  panelHeader.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
  
  // Tell parent to start dragging with initial pointer position
  window.parent.postMessage({
    type: 'START_DRAG',
    mouseX: e.clientX,
    mouseY: e.clientY
  }, '*');
  
  e.preventDefault();
  e.stopPropagation();
});

// Listen for DRAG_ENDED message from parent overlay
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  
  if (msg.type === 'DRAG_ENDED') {
    isDragging = false;
    panelHeader.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// ── Copy result ──
copyBtn.addEventListener('click', () => {
  // Fix 3: Validate empty result
  if (!simplifiedText || simplifiedText.trim() === '') {
    showError('Nothing to copy');
    return;
  }
  
  navigator.clipboard.writeText(simplifiedText).then(() => {
    // Fix 2: Visual feedback for success
    copyBtn.textContent = '✓';
    copyBtn.style.color = '#2e7d32';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
      copyBtn.style.color = '';
    }, 1500);
  }).catch(() => {
    // Fix 2: Visual feedback for failure
    copyBtn.textContent = 'Failed';
    copyBtn.style.color = '#d32f2f';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
      copyBtn.style.color = '';
    }, 1500);
  });
});

// ── Expand/collapse result box ──
expandBtn.addEventListener('click', () => {
  const expanded = resultText.classList.toggle('qt-expanded');
  expandBtn.textContent = expanded ? '⤡' : '⤢';
  // Fix 1: Visual feedback for expanded state
  if (expanded) {
    resultText.style.borderColor = '#1C1C1E';
    resultText.style.boxShadow = '0 2px 8px rgba(28, 28, 30, 0.15)';
  } else {
    resultText.style.borderColor = '';
    resultText.style.boxShadow = '';
  }
});

// ── Receive selected text from content.js ──
window.addEventListener('message', (event) => {
  // Messages come from the host page's content script — accept any origin
  // but validate the message structure strictly
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type !== 'INIT_PANEL' && msg.type !== 'PANEL_RESIZED') return;

  if (msg.type === 'PANEL_RESIZED') {
    // Validate dimensions
    if (typeof msg.width !== 'number' || typeof msg.height !== 'number') return;
    if (msg.width <= 0 || msg.height <= 0) return;

    // Force document reflow when container is resized
    document.body.style.width  = msg.width  + 'px';
    document.body.style.height = msg.height + 'px';
    
    // Force immediate layout recalculation
    void document.body.offsetHeight;
    
    // Force all text boxes to reflow
    const textBoxes = document.querySelectorAll('.qt-original-box, .qt-result-box');
    textBoxes.forEach(box => {
      box.style.width = '100%';
      void box.offsetWidth;
    });
    
    // Resize chart if it exists
    if (metricsChart) {
      setTimeout(() => {
        metricsChart.resize();
      }, 10);
    }
    return;
  }

  if (msg.type === 'INIT_PANEL') {
    originalText = msg.text || '';
    originalBox.textContent = originalText;

    if (msg.restored) {
      // Fix 9 & 13: Validate restored data structure
      if (!msg.restored.simplified || typeof msg.restored.simplified !== 'string') {
        showError('Corrupted history data');
        return;
      }
      if (!msg.restored.metrics || typeof msg.restored.metrics !== 'object') {
        showError('Corrupted history data');
        return;
      }
      if (!msg.restored.metrics.before || !msg.restored.metrics.after) {
        showError('Corrupted history data');
        return;
      }
      
      simplifiedText = msg.restored.simplified;
      showResult(simplifiedText, 'Simplified Text', false);
      
      try {
        drawChart(msg.restored.metrics.before, msg.restored.metrics.after);
        showMetricsGrid(msg.restored.metrics.before, msg.restored.metrics.after);
        metricsSection.style.display = 'block';
      } catch (err) {
        console.error('Failed to restore metrics:', err);
        showError('Could not restore metrics chart');
      }
    }
  }
});

// ── Show/hide UI states ──
let isRequestInProgress = false;

function setLoading(on) {
  loadingState.style.display = on ? 'flex' : 'none';
  simplifyBtn.disabled       = on;
  explainBtn.disabled        = on;
  errorState.style.display   = 'none';
  isRequestInProgress        = on;
}

// ── Minimal markdown renderer for bullets/steps ──
function renderText(text, isMarkdown) {
  if (!isMarkdown) {
    resultText.textContent = text;
    return;
  }
  
  // Fix 1 & 6: Process bold BEFORE HTML escaping, add bullet support
  let processed = text
    .replace(/\*\*(.+?)\*\*/g, '<<<BOLD_START>>>$1<<<BOLD_END>>>') // Temp markers
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/<<<BOLD_START>>>/g, '<strong>').replace(/<<<BOLD_END>>>/g, '</strong>')
    .replace(/^(\d+)\.\s+/gm, '<span class="qt-list-num">$1.</span> ')
    // Fix 5: Add bullet point support
    .replace(/^[-•]\s+/gm, '<span class="qt-list-bullet">•</span> ')
    .replace(/\n/g, '<br>');
  
  // Fix 7: Use textContent for safety, then replace safe HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = processed;
  resultText.innerHTML = tempDiv.innerHTML;
}

function showResult(text, label, isMarkdown) {
  resultLabel.textContent      = label;
  renderText(text, isMarkdown);
  // Fix 14: Add animation to result section
  resultSection.style.display  = 'none';
  setTimeout(() => {
    resultSection.style.display  = 'block';
  }, 10);
  loadingState.style.display   = 'none';
  // Reset expand state
  resultText.classList.remove('qt-expanded');
  resultText.style.borderColor = '';
  resultText.style.boxShadow = '';
  expandBtn.textContent = '⤢';
}

function showError(msg) {
  errorState.textContent     = '⚠ ' + msg;
  errorState.style.display   = 'block';
  loadingState.style.display = 'none';
  // Fix 13: Auto-dismiss after 5 seconds
  setTimeout(() => {
    errorState.style.display = 'none';
  }, 5000);
}

// ── Simplify button ──
simplifyBtn.addEventListener('click', async () => {
  if (!originalText || isRequestInProgress) return;
  if (!chrome.runtime?.id) { showError('Extension was reloaded. Please close and reopen the panel.'); return; }
  setLoading(true);

  try {
    chrome.runtime.sendMessage({ type: 'SIMPLIFY', text: originalText }, (response) => {
      setLoading(false);
      if (chrome.runtime.lastError || !response) {
        showError('Could not reach the extension. Try reloading the page.');
        return;
      }
      if (response.error) { showError(response.error); return; }

      simplifiedText = response.result;
      showResult(simplifiedText, 'Simplified Text', false);

      const before = calculateMetrics(originalText);
      const after  = calculateMetrics(simplifiedText);
      drawChart(before, after);
      showMetricsGrid(before, after);
      metricsSection.style.display = 'block';

      saveResult({ original: originalText, simplified: simplifiedText, metrics: { before, after } });
    });
  } catch (e) {
    setLoading(false);
    showError('Extension was reloaded. Please close and reopen the panel.');
  }
});

// ── Explain button ──
explainBtn.addEventListener('click', async () => {
  if (!originalText || isRequestInProgress) return;
  if (!chrome.runtime?.id) { showError('Extension was reloaded. Please close and reopen the panel.'); return; }
  const style = explainStyle.value;
  setLoading(true);

  try {
    chrome.runtime.sendMessage({ type: 'EXPLAIN', text: originalText, style }, (response) => {
      setLoading(false);
      if (chrome.runtime.lastError || !response) {
        showError('Could not reach the extension. Try reloading the page.');
        return;
      }
      if (response.error) { showError(response.error); return; }

      // bullets and steps may contain markdown-style formatting
      const isMarkdown = style === 'bullets' || style === 'steps';
      const labelMap   = { plain: 'Explanation', bullets: 'Key Points', steps: 'Step by Step' };
      simplifiedText   = response.result;
      showResult(response.result, labelMap[style] || 'Explanation', isMarkdown);
    });
  } catch (e) {
    setLoading(false);
    showError('Extension was reloaded. Please close and reopen the panel.');
  }
});

// ── Draw Chart.js grouped bar chart ──
function drawChart(before, after) {
  const container = document.getElementById('metricsChart').parentElement;
  // Fix 8: Set explicit height before creating chart
  container.style.height = '180px';
  
  const ctx = document.getElementById('metricsChart').getContext('2d');
  if (metricsChart) { metricsChart.destroy(); metricsChart = null; }

  try {
    metricsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Readability', 'Sentence Len', 'Difficult %', 'Read Time (min)'],
        datasets: [
          {
            label: 'Before',
            data: [before.readabilityScore, before.avgSentenceLength, before.difficultWordPct, before.readingTime],
            backgroundColor: 'rgba(211, 47, 47, 0.5)',
            borderColor:     'rgba(211, 47, 47, 0.9)',
            borderWidth: 1,
            borderRadius: 3
          },
          {
            label: 'After',
            data: [after.readabilityScore, after.avgSentenceLength, after.difficultWordPct, after.readingTime],
            backgroundColor: 'rgba(46, 125, 50, 0.6)',
            borderColor:     'rgba(46, 125, 50, 1)',
            borderWidth: 1,
            borderRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { font: { size: 10 } } },
          x: { ticks: { font: { size: 10 } } }
        }
      }
    });
  } catch (err) {
    console.error('Chart initialization failed:', err);
    // Fix 10: Styled error fallback
    container.innerHTML = '<div class="qt-chart-error">Chart unavailable</div>';
  }
}

// ── Metrics grid ──
function showMetricsGrid(before, after) {
  const metrics = [
    { label: 'Readability Score',   b: before.readabilityScore,  a: after.readabilityScore  },
    { label: 'Avg Sentence Length', b: before.avgSentenceLength, a: after.avgSentenceLength },
    { label: 'Difficult Words %',   b: before.difficultWordPct,  a: after.difficultWordPct  },
    { label: 'Reading Time (min)',  b: before.readingTime,       a: after.readingTime       }
  ];

  metricsGrid.innerHTML = metrics.map(m => `
    <div class="qt-metric-card">
      <div class="qt-metric-label">${m.label}</div>
      <div class="qt-metric-values">
        <span class="qt-metric-before">${m.b}</span>
        <span class="qt-metric-arrow">→</span>
        <span class="qt-metric-after">${m.a}</span>
      </div>
    </div>
  `).join('');
}
