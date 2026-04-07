/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const sendButton = document.getElementById("sendBtn");
const latestQuestionText = document.getElementById("latestQuestionText");

const workerURL = "https://loreal.wagnercp.workers.dev/";
const lorealDataApiUrl =
  "https://makeup-api.herokuapp.com/api/v1/products.json?brand=l%27oreal";

const systemPrompt =
  "You are a helpful beauty assistant for L'Oréal. Only answer questions about L'Oréal products, makeup, skincare, haircare, fragrance, routines, and recommendations. If a user asks anything unrelated to beauty or L'Oréal, politely refuse and redirect them to beauty-related questions. Keep responses concise, helpful, and beginner-friendly.";

const refusalMessage =
  "I can only help with L'Oréal products, beauty routines, and recommendations. Please ask about skincare, haircare, makeup, or fragrance.";

const conversationMessages = [{ role: "system", content: systemPrompt }];
let cachedLorealProducts = [];
const userContext = {
  name: null,
  pastQuestions: [],
};

const allowedKeywords = [
  "loreal",
  "l'oréal",
  "l’oreal",
  "l'oreal",
  "product",
  "products",
  "makeup",
  "skincare",
  "skin care",
  "haircare",
  "hair care",
  "fragrance",
  "perfume",
  "routine",
  "recommendation",
  "recommend",
  "cleanser",
  "moisturizer",
  "serum",
  "sunscreen",
  "foundation",
  "concealer",
  "lipstick",
  "mascara",
  "blush",
  "shampoo",
  "conditioner",
  "hair mask",
  "hair oil",
];

function addMessage(role, text) {
  const messageRow = document.createElement("div");
  messageRow.className = `msg ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = text;

  messageRow.appendChild(bubble);
  chatWindow.appendChild(messageRow);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return bubble;
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  userInput.disabled = isLoading;
}

function extractUserName(text) {
  const namePatterns = [
    /my name is\s+([a-zA-Z'-]{2,})/i,
    /i am\s+([a-zA-Z'-]{2,})/i,
    /i'm\s+([a-zA-Z'-]{2,})/i,
    /call me\s+([a-zA-Z'-]{2,})/i,
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const rawName = match[1].trim();
      return rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
    }
  }

  return null;
}

function updateUserContext(messageText) {
  const foundName = extractUserName(messageText);
  if (foundName) {
    userContext.name = foundName;
  }

  userContext.pastQuestions.push(messageText);

  // Keep only recent questions to avoid sending too much text each turn.
  if (userContext.pastQuestions.length > 8) {
    userContext.pastQuestions = userContext.pastQuestions.slice(-8);
  }
}

function buildConversationContext() {
  const nameLine = userContext.name
    ? `User name: ${userContext.name}`
    : "User name: unknown";

  const recentQuestions = userContext.pastQuestions.slice(-5);
  const questionsLine =
    recentQuestions.length > 0
      ? `Recent user questions: ${recentQuestions.join(" | ")}`
      : "Recent user questions: none yet";

  return `${nameLine}\n${questionsLine}\nUse this context to keep replies natural and consistent across turns.`;
}

function isLorealRelated(text) {
  const normalizedText = text.toLowerCase();

  // More permissive filter: allow any beauty-related question
  const beautyKeywords = [
    "beauty",
    "makeup",
    "skincare",
    "skin",
    "hair",
    "haircare",
    "face",
    "cosmetic",
    "fragrance",
    "perfume",
    "product",
  ];
  const refusalKeywords = [
    "weather",
    "math",
    "code",
    "javascript",
    "python",
    "sports",
    "politics",
    "joke",
    "recipe",
    "code",
  ];

  // Block obviously non-beauty questions
  const isRefusal = refusalKeywords.some((keyword) =>
    normalizedText.includes(keyword),
  );
  if (isRefusal) {
    return false;
  }

  // Allow if it contains any beauty keyword
  const isBeauty = beautyKeywords.some((keyword) =>
    normalizedText.includes(keyword),
  );
  if (isBeauty) {
    return true;
  }

  // Allow general beauty actions even without specific keywords
  const beautyVerbs = [
    "help",
    "recommend",
    "suggest",
    "advice",
    "best",
    "good",
    "how",
    "what",
    "which",
  ];
  const hasBeautyVerb = beautyVerbs.some((verb) =>
    normalizedText.includes(verb),
  );

  // If it has a beauty verb and is reasonably long, give it a chance
  if (hasBeautyVerb && text.length > 5) {
    return true;
  }

  return allowedKeywords.some((keyword) => normalizedText.includes(keyword));
}

async function fetchLorealProducts() {
  if (cachedLorealProducts.length > 0) {
    return cachedLorealProducts;
  }

  const response = await fetch(lorealDataApiUrl);

  if (!response.ok) {
    throw new Error("L'Oreal data request failed.");
  }

  const data = await response.json();
  cachedLorealProducts = Array.isArray(data) ? data : [];
  return cachedLorealProducts;
}

function getRelevantProducts(products, userQuestion) {
  const queryWords = userQuestion
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);

  const scoredProducts = products.map((product) => {
    const searchableText = [
      product.name || "",
      product.product_type || "",
      product.category || "",
      product.description || "",
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;

    queryWords.forEach((word) => {
      if (searchableText.includes(word)) {
        score += 1;
      }
    });

    return { product, score };
  });

  const matchedProducts = scoredProducts
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => entry.product);

  // If no strong match is found, return a few products so the assistant still has data.
  if (matchedProducts.length === 0) {
    return products.slice(0, 5);
  }

  return matchedProducts;
}

async function getLorealDataContext(userQuestion) {
  try {
    const products = await fetchLorealProducts();
    const relevantProducts = getRelevantProducts(products, userQuestion);

    if (relevantProducts.length === 0) {
      return "No L'Oreal product data is available right now.";
    }

    const productLines = relevantProducts.map((product) => {
      const name = product.name || "Unknown product";
      const type = product.product_type || "beauty item";
      const price = product.price ? `$${product.price}` : "price not listed";
      return `- ${name} (${type}, ${price})`;
    });

    return `Use this L'Oreal product data as your factual source when possible:\n${productLines.join("\n")}`;
  } catch (error) {
    return "L'Oreal product data could not be loaded, so answer with general L'Oreal beauty guidance only.";
  }
}

async function getChatResponse(requestMessages) {
  const response = await fetch(workerURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: requestMessages,
    }),
  });

  if (!response.ok) {
    throw new Error("OpenAI request failed.");
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

chatWindow.innerHTML = "";
addMessage(
  "ai",
  "Hello! Ask me about L'Oréal products, routines, or recommendations.",
);

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const messageText = userInput.value.trim();

  if (!messageText) {
    return;
  }

  latestQuestionText.textContent = messageText;
  chatWindow.innerHTML = "";
  addMessage("user", messageText);
  userInput.value = "";
  updateUserContext(messageText);

  if (!isLorealRelated(messageText)) {
    addMessage("ai", refusalMessage);
    return;
  }

  const loadingMessage = addMessage("ai", "Thinking...");

  setLoading(true);

  try {
    // Add live L'Oreal product data to each request so answers are better grounded.
    const lorealDataContext = await getLorealDataContext(messageText);
    const conversationContext = buildConversationContext();

    // Build request: system prompt + product context + conversation history + current user message
    const requestMessages = [
      { role: "system", content: systemPrompt },
      { role: "system", content: conversationContext },
      { role: "system", content: lorealDataContext },
      ...conversationMessages.filter((msg) => msg.role !== "system"),
      { role: "user", content: messageText },
    ];

    const reply = await getChatResponse(requestMessages);
    loadingMessage.textContent = reply;

    // Save conversation turns for next round of context.
    conversationMessages.push({ role: "user", content: messageText });
    conversationMessages.push({ role: "assistant", content: reply });
  } catch (error) {
    loadingMessage.textContent =
      "Sorry, I could not get a response right now. Please try again in a moment.";
  } finally {
    setLoading(false);
  }
});
