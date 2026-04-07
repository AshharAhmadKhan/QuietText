// panel.js

let originalText   = '';
let simplifiedText = '';
let metricsChart   = null;
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
closeBtn.addEventListener('click', () => {
  window.parent.postMessage({ type: 'CLOSE_PANEL' }, '*');
});
const panelHeader = document.querySelector('.qt-panel-header');
let isDragging = false;

panelHeader.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.qt-close-btn')) return;
  
  isDragging = true;
  panelHeader.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
  window.parent.postMessage({
    type: 'START_DRAG',
    mouseX: e.clientX,
    mouseY: e.clientY
  }, '*');
  
  e.preventDefault();
  e.stopPropagation();
});
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  
  if (msg.type === 'DRAG_ENDED') {
    isDragging = false;
    panelHeader.style.cursor = '';
    document.body.style.userSelect = '';
  }
});
copyBtn.addEventListener('click', () => {
  const textToCopy = resultText.textContent || resultText.innerText || '';
  if (!textToCopy || textToCopy.trim() === '') {
    showCopyToast('Nothing to copy', 'error');
    return;
  }
  const textArea = document.createElement('textarea');
  textArea.value = textToCopy;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      showCopyToast('✓ Copied to clipboard', 'success');
    } else {
      showCopyToast('Copy failed', 'error');
    }
  } catch (err) {
    console.error('Copy failed:', err);
    showCopyToast('Copy failed', 'error');
  }
  
  document.body.removeChild(textArea);
});
function showCopyToast(message, type = 'success') {
  const existing = document.querySelector('.qt-copy-toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `qt-copy-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
expandBtn.addEventListener('click', () => {
  const expanded = resultText.classList.toggle('qt-expanded');
  expandBtn.textContent = expanded ? '⤡' : '⤢';
  if (expanded) {
    resultText.style.borderColor = '#1C1C1E';
    resultText.style.boxShadow = '0 2px 8px rgba(28, 28, 30, 0.15)';
  } else {
    resultText.style.borderColor = '';
    resultText.style.boxShadow = '';
  }
});
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type !== 'INIT_PANEL' && msg.type !== 'PANEL_RESIZED') return;

  if (msg.type === 'PANEL_RESIZED') {
    if (typeof msg.width !== 'number' || typeof msg.height !== 'number') return;
    if (msg.width <= 0 || msg.height <= 0) return;
    document.body.style.width  = msg.width  + 'px';
    document.body.style.height = msg.height + 'px';
    void document.body.offsetHeight;
    const textBoxes = document.querySelectorAll('.qt-original-box, .qt-result-box');
    textBoxes.forEach(box => {
      box.style.width = '100%';
      void box.offsetWidth;
    });
    if (metricsChart) {
      setTimeout(() => {
        metricsChart.resize();
      }, 10);
    }
    return;
  }

  if (msg.type === 'INIT_PANEL') {
    originalText = msg.text || '';
    if (!originalText || originalText.trim() === '') {
      originalBox.innerHTML = '<span class="qt-placeholder">💡 Tip: Select text on any page, then press Ctrl+Shift+Q or right-click → Analyse with QuietText</span>';
    } else {
      originalBox.textContent = originalText;
    }

    if (msg.restored) {
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
let isRequestInProgress = false;

function setLoading(on) {
  loadingState.style.display = on ? 'flex' : 'none';
  simplifyBtn.disabled       = on;
  explainBtn.disabled        = on;
  errorState.style.display   = 'none';
  isRequestInProgress        = on;
}
function renderText(text, isMarkdown) {
  if (!isMarkdown) {
    resultText.textContent = text;
    return;
  }
  let processed = text
    .replace(/\*\*(.+?)\*\*/g, '<<<BOLD_START>>>$1<<<BOLD_END>>>') // Temp markers
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/<<<BOLD_START>>>/g, '<strong>').replace(/<<<BOLD_END>>>/g, '</strong>')
    .replace(/^(\d+)\.\s+/gm, '<span class="qt-list-num">$1.</span> ')
    .replace(/^[-•]\s+/gm, '<span class="qt-list-bullet">•</span> ')
    .replace(/\n/g, '<br>');
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = processed;
  resultText.innerHTML = tempDiv.innerHTML;
}

function showResult(text, label, isMarkdown) {
  resultLabel.textContent      = label;
  const checkmark = document.createElement('div');
  checkmark.className = 'qt-success-check';
  checkmark.textContent = '✓';
  resultSection.appendChild(checkmark);
  setTimeout(() => checkmark.remove(), 500);
  
  renderText(text, isMarkdown);
  resultSection.style.display  = 'none';
  setTimeout(() => {
    resultSection.style.display  = 'block';
  }, 10);
  loadingState.style.display   = 'none';
  resultText.classList.remove('qt-expanded');
  resultText.style.borderColor = '';
  resultText.style.boxShadow = '';
  expandBtn.textContent = '⤢';
}

function showError(msg) {
  errorState.textContent     = '⚠ ' + msg;
  errorState.style.display   = 'block';
  loadingState.style.display = 'none';
  setTimeout(() => {
    errorState.style.display = 'none';
  }, 5000);
}
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
function drawChart(before, after) {
  const container = document.getElementById('metricsChart').parentElement;
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
    container.innerHTML = '<div class="qt-chart-error">Chart unavailable</div>';
  }
}
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
