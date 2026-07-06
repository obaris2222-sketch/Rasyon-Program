/**
 * AI Service for Groq API Integration (LLaMA 3)
 */

/**
 * Sends a full conversation to the Groq API.
 * Supports multi-turn chat history for context-aware responses.
 *
 * @param {Array<{role: string, content: string}>} messages - Full conversation history
 *   including the system prompt as the first element.
 * @returns {Promise<string>} The AI's response text.
 */
export async function askGemini(messages) {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error("DeepSeek API key (VITE_DEEPSEEK_API_KEY) is not set in .env");
  }

  const endpoint = "https://api.deepseek.com/chat/completions";

  const payload = {
    model: "deepseek-chat",
    messages,
    temperature: 0.35,
    max_tokens: 4096,
    top_p: 0.9,
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("DeepSeek API Error Response:", errorData);
      throw new Error(`API Hatası: ${response.status} - Lütfen API anahtarınızı kontrol edin.`);
    }

    const data = await response.json();

    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    } else {
      throw new Error("Yapay zeka boş bir yanıt döndürdü.");
    }

  } catch (error) {
    console.error("DeepSeek Fetch Error:", error);
    throw new Error(`AI Hatası: ${error.message || "İletişim kurulamadı."}`);
  }
}
