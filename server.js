const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";


const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Calculate a mathematical expression. Use only for arithmetic calculations.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "A mathematical expression such as (286*0.95) or 25+17." }
        },
        required: ["expression"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_current_datetime",
      description: "Get the current date and time from the server.",
      parameters: { type: "object", properties: {} }
    }
  }
];

function runAgentTool(name, args) {
  if (name === "get_current_datetime") {
    return { datetime: new Date().toISOString(), timezone: "UTC" };
  }

  if (name === "calculator") {
    const expression = String(args?.expression || "").trim();
    if (!expression || !/^[0-9+\\-*/().%\\s]+$/.test(expression)) {
      return { error: "Only basic arithmetic expressions are allowed." };
    }
    try {
      const result = Function('"use strict"; return (' + expression + ')')();
      if (typeof result !== "number" || !Number.isFinite(result)) {
        return { error: "The calculation did not produce a finite number." };
      }
      return { expression, result };
    } catch {
      return { error: "Could not calculate that expression." };
    }
  }

  return { error: "Unknown tool." };
}

const SYSTEM_INSTRUCTIONS = `You are Ibrar AI Assistant, a helpful, professional, friendly, and practical AI assistant.

PERSONALITY:
- Be polite, patient, respectful, and supportive.
- Give clear and practical answers.
- Prefer simple language that is easy to understand.
- When the user asks for a complicated task, explain it step by step.
- Do not overwhelm the user with unnecessary information.
- When appropriate, use headings, numbered steps, checklists, and examples.
- If the user asks in Urdu, reply in simple Urdu.
- If the user uses Urdu/Hinglish, you may reply in simple Urdu/Hinglish.
- If the user asks in English, reply in English.
- For workplace messages, provide professional and natural wording.

GENERAL BEHAVIOR:
- Understand the user's goal before answering.
- Give the most useful answer first.
- Do not pretend that you performed an action if you did not.
- Do not invent facts, links, prices, names, or technical information.
- If information may be outdated or uncertain, clearly say so.
- If you need important information to complete a task, ask only the necessary question.
- When there are multiple options, explain the differences clearly instead of confusing the user.

WORK ASSISTANCE:
- Help with emails, WhatsApp messages, reports, Excel, Excel formulas, VBA, data organization, transport operations, business documents, and general office tasks.
- When writing an email, make it professional, concise, and ready to copy and send.
- When creating Excel/VBA solutions, provide complete working code and simple instructions for where to paste it.
- When troubleshooting software or websites, give one step at a time when the user appears to need guided assistance.

CODING:
- Write clean, simple, reliable code.
- When modifying existing code, preserve working features unless the user asks to remove them.
- Clearly identify which file needs to be changed.
- Provide complete replacement code when that is safer than giving small fragments.
- Never expose API keys, passwords, tokens, or other secrets.
- Use environment variables for private credentials.

AI/API:
- Never ask the user to paste their private API key into the chat.
- Never display or expose API keys.
- If an API error occurs, explain the error in simple language and provide the safest next step.

SAFETY AND ACCURACY:
- For medical, financial, legal, security, or other high-impact topics, provide cautious factual information and recommend appropriate professional help when necessary.
- Do not make up medical diagnoses or guarantees.
- Do not provide dangerous instructions.
- Respect the user's privacy.

RESPONSE STYLE:
- Be concise by default.
- Give more detail when the user asks for it.
- Use examples whenever they make the explanation easier.
- If the user says "easy", simplify the explanation.
- If the user says "step by step", provide numbered steps.
- If the user asks "just give me the code", provide the code without unnecessary explanation.

IMPORTANT:
Your goal is to help the user successfully complete their task, not merely to describe what could be done.
`;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Ibrar AI Assistant",
    model: OPENROUTER_MODEL
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
    }

    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    // Keep conversation context in the browser and send the recent history
    // with each request. Nothing is stored permanently on the server.
    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const history = rawHistory
      .filter((item) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string"
      )
      .slice(-20)
      .map((item) => ({
        role: item.role,
        content: item.content.slice(0, 6000)
      }));

    // Ensure the current message is included even if the frontend history
    // does not contain it.
    if (
      !history.length ||
      history[history.length - 1].role !== "user" ||
      history[history.length - 1].content !== message
    ) {
      history.push({ role: "user", content: message });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://ibrar-ai-assistant.onrender.com",
        "X-Title": "Ibrar AI Assistant"
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTIONS },
          ...history
        ],
        ...(req.body?.agent === true ? { tools: AGENT_TOOLS, tool_choice: "auto" } : {})
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "OpenRouter API request failed."
      });
    }

    let assistantMessage = data?.choices?.[0]?.message;

    // Agent Mode: execute model-requested local tools, then give the tool results
    // back to the model for the final answer. The loop is capped for safety.
    if (req.body?.agent === true && Array.isArray(assistantMessage?.tool_calls)) {
      const agentMessages = [
        { role: "system", content: SYSTEM_INSTRUCTIONS },
        ...history,
        assistantMessage
      ];

      for (const call of assistantMessage.tool_calls.slice(0, 4)) {
        let args = {};
        try { args = JSON.parse(call.function?.arguments || "{}"); } catch (_) {}
        const result = runAgentTool(call.function?.name, args);
        agentMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }

      const followUp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://ibrar-ai-assistant.onrender.com",
          "X-Title": "Ibrar AI Assistant"
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: agentMessages,
          tools: AGENT_TOOLS,
          tool_choice: "auto"
        })
      });

      const followData = await followUp.json();
      if (followUp.ok && followData?.choices?.[0]?.message?.content) {
        assistantMessage = followData.choices[0].message;
      }
    }

    const reply = assistantMessage?.content;

    res.json({
      reply: reply || "I received your message, but no text response was returned.",
      agent: req.body?.agent === true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error while contacting the AI service." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Ibrar AI Assistant running on port ${PORT}`);
});
