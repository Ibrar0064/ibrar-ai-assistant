const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";


const AGENT_TOOLS = [
  { type: "openrouter:web_search" },
  { type: "openrouter:web_fetch", parameters: { engine: "openrouter", max_content_tokens: 20000 } },
  { type: "openrouter:datetime" },
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
  }
];

function runAgentTool(name, args) {
  if (name === "get_current_datetime") {
    return { datetime: new Date().toISOString(), timezone: "UTC" };
  }

  if (name === "calculator") {
    const expression = String(args?.expression || "").trim();
    if (!expression || !/^[-0-9+*/().%\s]+$/.test(expression)) {
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

AGENT MODE:
- When Agent Mode is enabled, act as a real task agent rather than only a chat responder.
- You can use web search, web page fetching, current date/time, and a calculator.
- Use web search for current, changing, or uncertain information instead of guessing.
- Use web fetch when the user gives you a URL or when a source found by search needs to be read in detail.
- Use the calculator for arithmetic when precision matters.
- For multi-step tasks, use the available tools as needed and verify important information before answering.
- Do not claim that you searched, opened a page, calculated something, or used a tool unless the tool result was actually available to you.
- Keep tool use focused and stop when the user's task is complete.
`;

app.use(express.json({ limit: "12mb" }));
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

    const image = typeof req.body?.image === "string" ? req.body.image : "";
    const imageName = String(req.body?.imageName || "reference image").slice(0, 200);
    if (image && !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(image)) {
      return res.status(400).json({ error: "The uploaded reference must be a valid image." });
    }
    if (image.length > 11000000) {
      return res.status(413).json({ error: "That image is too large. Please use a smaller image." });
    }

    const asksForSimpleAnswer = /\b(easy|simple|simplest|plain|basic|short)\b/i.test(message)
      || /\b(آسان|سادہ|مختصر)\b/.test(message);

    const dynamicInstructions = asksForSimpleAnswer
      ? `
EASY/SIMPLE MODE:
- The user explicitly wants an easy/simple answer.
- If Agent Mode is on and current information is needed, search for reliable sources first.
- Prefer sources whose wording is understandable and whose facts are easy to explain.
- Use the image as reference when one is attached: identify the important visible details before searching.
- Do not make the search itself overly complicated. Search the exact practical question and use only the information needed.
- Give the final answer in very simple language, with short sentences and the minimum necessary detail.
- Avoid jargon. If a technical word is necessary, explain it in one short phrase.
- Do not omit an important warning or limitation merely to make the answer shorter.
`
      : `
REFERENCE IMAGE:
- If an image is attached, inspect it carefully and use it as reference for the user's question.
- If Agent Mode is on and the user asks for current information, identify useful details from the image and use them to form focused web searches.
- Do not invent text or details that are not visible or reliably readable in the image.
`;

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

    const requestMessages = [
      { role: "system", content: SYSTEM_INSTRUCTIONS + "\n\n" + dynamicInstructions }
    ];
    const multimodalHistory = history.map((item) => ({ ...item }));
    if (image) {
      const lastUserIndex = [...multimodalHistory].map((item) => item.role).lastIndexOf("user");
      if (lastUserIndex >= 0) {
        multimodalHistory[lastUserIndex] = {
          role: "user",
          content: [
            { type: "text", text: message + "\n\nAttached reference image: " + imageName },
            { type: "image_url", image_url: { url: image } }
          ]
        };
      }
    }
    requestMessages.push(...multimodalHistory);

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
        messages: requestMessages,
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

    // Real Agent loop: OpenRouter can execute server tools (web search, web fetch,
    // datetime) while this application executes local tools (calculator). Repeat
    // until the model returns a final answer, with a hard safety cap.
    if (req.body?.agent === true) {
      const agentMessages = [
        ...requestMessages,
        assistantMessage
      ];

      for (let step = 0; step < 5; step++) {
        const toolCalls = Array.isArray(assistantMessage?.tool_calls)
          ? assistantMessage.tool_calls
          : [];

        if (!toolCalls.length) break;

        let executedLocalTool = false;
        for (const call of toolCalls.slice(0, 4)) {
          if (call?.function?.name === "calculator") {
            let args = {};
            try { args = JSON.parse(call.function?.arguments || "{}"); } catch (_) {}
            const result = runAgentTool(call.function.name, args);
            agentMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result)
            });
            executedLocalTool = true;
          }
        }

        if (!executedLocalTool) break;

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
        if (!followUp.ok) {
          return res.status(followUp.status).json({
            error: followData?.error?.message || "Agent tool follow-up failed."
          });
        }

        assistantMessage = followData?.choices?.[0]?.message;
        if (!assistantMessage) break;
        agentMessages.push(assistantMessage);
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
