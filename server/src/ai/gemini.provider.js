const { GoogleGenerativeAI } = require("@google/generative-ai");

const generateText = async ({ prompt, systemInstruction, maxOutputTokens = 700, temperature = 0.2, json = false, timeoutMs = 20000 }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL;
  if (!apiKey || !modelName) return null;
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: modelName,
    ...(systemInstruction ? { systemInstruction } : {}),
    generationConfig: { ...(json ? { responseMimeType: "application/json" } : {}), maxOutputTokens, temperature },
  }, { timeout: timeoutMs });
  const result = await model.generateContent(prompt);
  return { text: result.response.text(), usage: result.response.usageMetadata || null, model: modelName };
};

module.exports = { generateText };
