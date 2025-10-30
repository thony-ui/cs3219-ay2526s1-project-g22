import config from "../config";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletion {
  id: string;
  choices: {
    message: ChatMessage;
    finish_reason: string;
  }[];
}

/**
 * OpenRouter class for handling API calls.
 */
class OpenRouter {
  private apiKey: string = config.openrouter.apiKey;
  private baseUrl: string = config.openrouter.url;

  /**
   * Creates an instance of the OpenRouter class.
   * @param apiKey - Your OpenRouter API key.
   */
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("OpenRouter API key is required.");
    }
    this.apiKey = apiKey;
  }

  /**
   * Makes a call to the chat completions endpoint.
   * @param options - The chat completion options.
   * @returns A promise that resolves to the chat completion response.
   */
  public async chat(options: {
    model: string;
    messages: ChatMessage[];
  }): Promise<ChatCompletion> {

    const url = `${this.baseUrl}/chat/completions`;

    const body = JSON.stringify({
      model: options.model,
      messages: options.messages,
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
          // OpenRouter recommends these headers for monitoring and abuse prevention
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "My Next.js App", // Change to your app's name
        },
        body: body,
      });

      if (!response.ok) {
        // Handle API errors
        const errorData = await response.json();
        console.error("OpenRouter API Error:", errorData);
        throw new Error(errorData.error?.message || "Failed to fetch from OpenRouter");
      }

      return response.json() as Promise<ChatCompletion>;

    } catch (error) {
      console.error("Error calling OpenRouter:", error);
      throw error;
    }
  }

  public async getChatResponse(message: string): Promise<string> {
    const systemPrompt = "You are a helpful assistant.";
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: message },
    ];

    const completion = await this.chat({
      model: "deepseek/deepseek-chat-v3.1:free", // Change to your desired model
      messages: messages,
    });

    return completion.choices[0].message.content;
  }

}

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY environment variable is not set.");
}

const openrouter = new OpenRouter(process.env.OPENROUTER_API_KEY);
export default openrouter;