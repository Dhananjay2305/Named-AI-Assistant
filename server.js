const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// AI API Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const USE_GEMINI = process.env.USE_GEMINI === "true";

// Chat endpoint - uses OpenAI or Gemini
app.post("/api/chat", async (req, res) => {
  try {
    const { question, assistantName, userId } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "Question is required" });
    }

    let answer = "";

    if (USE_GEMINI && GEMINI_API_KEY) {
      // Use Google Gemini API
      answer = await getGeminiResponse(question, assistantName);
    } else if (OPENAI_API_KEY) {
      // Use OpenAI API
      answer = await getOpenAIResponse(question, assistantName);
    } else {
      // Fallback response if no API keys
      answer = `${assistantName}: I'm configured but need an API key. Please add OPENAI_API_KEY or GEMINI_API_KEY to your .env file.`;
    }

    res.json({ answer, assistantName, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Chat API error:", error);
    res.status(500).json({ 
      error: "Failed to process question",
      message: error.message 
    });
  }
});

// OpenAI API integration
async function getOpenAIResponse(question, assistantName) {
  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key not configured");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `
You are ${assistantName}, an exam-focused AI assistant.

RULES:
- Give exact answers.
- No unnecessary explanation.
- If definition → 3-5 lines.
- If explanation → structured bullet points.
- If programming → only code + short explanation.
- If 10 marks → detailed but structured answer.
- Format clearly using headings.
`,
        },
        {
          role: "user",
          content: question,
        },
      ],
      max_tokens: 600,
      temperature: 0.2, // VERY IMPORTANT for exact answers
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message}`);
  }

  const data = await response.json();
  const answer = data.choices[0]?.message?.content || "No response generated.";

  return `${assistantName}:\n${answer}`;
}

// Google Gemini API integration
async function getGeminiResponse(question, assistantName) {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You are ${assistantName}, a helpful AI study assistant for students. You help with explanations, notes, code examples, study planning, and career guidance. Be concise, friendly, and educational. Format your responses clearly with bullet points when helpful.\n\nUser question: ${question}`,
              },
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const answer = data.candidates[0]?.content?.parts[0]?.text || "I couldn't generate a response.";
  
  return `${assistantName}: ${answer}`;
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    hasOpenAI: !!OPENAI_API_KEY,
    hasGemini: !!GEMINI_API_KEY,
    usingGemini: USE_GEMINI && !!GEMINI_API_KEY,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/chat`);
  console.log(`🔑 OpenAI configured: ${!!OPENAI_API_KEY}`);
  console.log(`🔑 Gemini configured: ${!!GEMINI_API_KEY}`);
  console.log(`🎯 Using: ${USE_GEMINI && GEMINI_API_KEY ? "Gemini" : OPENAI_API_KEY ? "OpenAI" : "None (fallback mode)"}`);
});
