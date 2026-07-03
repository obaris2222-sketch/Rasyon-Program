import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * AI Service for Gemini API Integration using Official SDK
 */

/**
 * Sends a message to the Google Gemini API with the given system prompt.
 * Uses the gemini-1.5-flash model via the official SDK.
 * 
 * @param {string} userMessage - The message written by the user.
 * @param {string} systemPrompt - The formatted system prompt containing context.
 * @returns {Promise<string>} The AI's response text.
 */
export async function askGemini(userMessage, systemPrompt) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error("Gemini API key (VITE_GEMINI_API_KEY) is not set in .env");
  }

  try {
    // Initialize the official SDK
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Get the standard 1.5 flash model
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: systemPrompt
    });

    // Generate content
    const result = await model.generateContent(userMessage);
    const response = await result.response;
    return response.text();
    
  } catch (error) {
    console.error("Gemini SDK Error Response:", error);
    throw new Error(`AI Hatası: ${error.message || "İletişim kurulamadı."}`);
  }
}
