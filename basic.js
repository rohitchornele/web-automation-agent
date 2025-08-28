import { Agent, run, tool } from "@openai/agents";
import OpenAI from "openai";
import "dotenv/config";
import z from "zod";

const openai = new OpenAI(
    { 
        apiKey: process.env.GEMINI_API_KEY ,
        baseURL: process.env.GEMINI_BASE_URL,
    }
);

const getCurrentTime = tool({
  name: "get_current_time",
  description: "This tool returns the current time",
  parameters: z.object({}),

  async execute() {
    return new Date().toString();
  },
});

const getMenu = tool({
  name: "get_menu_items",
  description: "Fetches and returns the menu items",
  parameters: z.object({}),
  async execute() {
    return {
      Drinks: {
        Chai: "INR 30",
        coffee: "INR 70",
      },
      Veg: {
        "Dal Makhni": "INR 250",
        Paneer: "INR 400",
      },
      Rice: {
        Plain: "INR 99",
        Fried: "INR 150",
      },
      Roti: {
        Plain: "INR 10",
        Butter: "INR 15",
      },
    };
  },
});

const cookingAgents = new Agent({
  name: "Cooking Agent",
  tools: [getCurrentTime, getMenu],
  instructions: `
    You are a helpful cooking assistance who is specialize in cooking food.
    You help the users with food options and reciepes and help them cook the food.
    `,
});

const codingAgent = new Agent({
  name: "Coding Agent",
  instructions: `
    You are an expert coding assistant particullarly in javascript
    `,
});

const gatewayAgent = Agent.create({
  name: "Triage Agent",
  instructions: "You determine which agent to use based on the user's query",
  handoffs: [codingAgent, cookingAgents],
});

async function chatWithAgent(query) {
  const result = await run(gatewayAgent, query);
  console.log("History : ", result.history);
  console.log("Final Output = ", result.finalOutput);
}

chatWithAgent(
  "depending on current time, suggest me some good food to cook from the available menu items"
);
