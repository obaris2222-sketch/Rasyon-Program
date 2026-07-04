/**
 * AI Service for Groq API Integration (LLaMA 3)
 */

/**
 * Sends a message to the Groq API with the given system prompt.
 * Uses the incredibly fast llama3-70b-8192 model.
 * 
 * @param {string} userMessage - The message written by the user.
 * @param {string} systemPrompt - The formatted system prompt containing context.
 * @returns {Promise<string>} The AI's response text.
 */
export async function askGemini(userMessage, systemPrompt) {
  // Read the new Groq API Key
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("Groq API key (VITE_GROQ_API_KEY) is not set in .env");
  }

  const endpoint = "https://api.groq.com/openai/v1/chat/completions";

  const payload = {
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ],
    temperature: 0.3
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
      console.error("Groq API Error Response:", errorData);
      throw new Error(`API Hatası: ${response.status} - Lütfen API anahtarınızı kontrol edin.`);
    }

    const data = await response.json();

    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    } else {
      throw new Error("Yapay zeka boş bir yanıt döndürdü.");
    }

  } catch (error) {
    console.error("Groq Fetch Error:", error);
    throw new Error(`AI Hatası: ${error.message || "İletişim kurulamadı."}`);
  }
}
