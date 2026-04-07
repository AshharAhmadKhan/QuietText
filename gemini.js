// gemini.js
// Single module that handles the fetch call to Groq API (OpenAI-compatible).
// Called only from background.js. No backend. No proxy.

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_API_KEY = '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';

async function callGemini(systemPrompt, userText, apiKey) {
  const key = apiKey || DEFAULT_API_KEY;

  const body = {
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userText }
    ],
    temperature: 0.3,
    max_tokens: 1024
  };

  // 30-second timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMsg = 'Groq API error';
      try {
        const err = await response.json();
        errorMsg = err?.error?.message || errorMsg;
      } catch {
        // Malformed JSON response
        errorMsg = `API error (${response.status})`;
      }
      throw new Error(errorMsg);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('API returned invalid data');
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('No response from Groq');
    return text.trim();

  } catch (err) {
    clearTimeout(timeoutId);
    // Network errors
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    if (err.message.includes('fetch')) {
      throw new Error('No internet connection');
    }
    throw err;
  }
}

// Prompt templates — unchanged
const PROMPTS = {
  simplify: `You are a reading assistant for people with dyslexia.
Rewrite the following text so it is much easier to read.
Use short sentences. Use simple, common words.
Keep every important idea from the original.
Do not remove facts. Do not add new information.
Write for an adult. Do not be condescending or childish.
Return only the rewritten text. No preamble.`,

  explainPlain: `You are a patient reading tutor.
Explain the following passage in simple, clear prose.
Write as if you are explaining to a thoughtful adult who is unfamiliar with the topic.
Keep the explanation under 120 words.
Return only the explanation.`,

  explainBullets: `Extract the 4 to 6 key points from the following text.
Return them as a simple numbered list.
Each point should be one short sentence. No introduction needed.`,

  explainSteps: `Break down the following text into a step-by-step explanation.
Number each step. Keep each step to one or two sentences.
Write for someone reading this for the first time.`
};
