import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  Agent,
  tool,
  OpenAIProvider,
  Runner,
  setTracingDisabled,
} from "@openai/agents";
import { OpenAI } from "openai";
import { z } from "zod";
import "dotenv/config";

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: process.env.GEMINI_BASE_URL,
});

const modelProvider = new OpenAIProvider({
  openAIClient: client,
});

setDefaultOpenAIClient(client);
setOpenAIAPI("chat_completions");
setTracingDisabled(true);
const runner = new Runner({ modelProvider });

const getCurrentTime = tool({
  name: "get_current_time",
  description: "This tool returns the current time",
  parameters: z.object({}),
  async execute() {
    return new Date().toString();
  },
});

const cookingAgent = new Agent({
  name: "Cooking Agent",
  model: "gemini-1.5-flash",
  tools: [getCurrentTime],
  instructions: `You're a helpful cooking assistant who is specialized in cooking food. You help the users with food options and recipes and help them cook food,`
});

async function main(query) {
  const result = await runner.run(cookingAgent, query);
  console.log("History: ", result.history);
  console.log(result.lastAgent.name);
  console.log(result.finalOutput);
}

main("the current time");