import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  Agent,
  tool,
  OpenAIProvider,
  Runner,
  setTracingDisabled,
  run,
} from "@openai/agents";
import OpenAI from "openai";
import "dotenv/config";
import z from "zod";
import { chromium } from "playwright";
import { delay } from "@ai-sdk/provider-utils";

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

let browser = null;
let page = null;

//***************** Open Browser Tool  *******************/

const openBrowser = tool({
  name: "open_browser_tool",
  description: `open the browser and enter given url`,
  parameters: z.object({
    url: z.string().describe("url to navigate in browser"),
  }),
  async execute({ url }) {
    console.log("Inside openbrowser");
    if (!browser) {
      browser = await chromium.launch({
        headless: false,
        chromiumSandbox: true,
        env: {},
        args: [
          "--disable-extensions",
          "--disable-file-system",
          "--start-maximized",
        ],
      });
    }

    console.log("input url : ", url);

    const context = await browser.newContext({
      viewport: null,
    });

    page = await context.newPage();
    // page = await browser.newPage();
    await page.goto(url);
    await page.waitForTimeout(10000);
    return console.log(`Successfully opened browser and navigated to ${url}`);
  },
});

//***************** Click Element Tool  *******************/

const clickElement = tool({
  name: "clickElement",
  description: "Click an element on the page using a CSS selector or text",
  parameters: z.object({
    selector: z
      .string()
      .describe("CSS selector or text of the element to click"),
  }),
  async execute({ selector }) {
    if (!page) throw new Error("No page initialized. Call openBrowser first.");

    try {
      if (!selector.startsWith(".") && !selector.startsWith("#")) {
        await page.getByText(selector, { exact: true }).click();
      } else {
        await page.click(selector);
      }
      return `Clicked on element: ${selector}`;
    } catch (err) {
      return `Failed to click element: ${selector}. Error: ${err.message}`;
    }
  },
});

//***************** Get From Info Tool  *******************/

const getFormInfoTool = tool({
  name: "get_form_info_tool",
  description: "Analyze and get information about forms on the current page",
  parameters: z.object({
    formSelector: z
      .string()
      .describe("CSS selector for specific form (optional)"),
  }),
  async execute({ formSelector = "form" }) {
    if (!page) throw new Error("No page initialized. Call openBrowser first.");

    try {
      const formInfo = await page.evaluate((selector) => {
        const forms = document.querySelectorAll(selector);
        return Array.from(forms).map((form, index) => {
          const fields = form.querySelectorAll("input, textarea, select");
          return {
            formIndex: index,
            action: form.action || "Not specified",
            method: form.method || "GET",
            fields: Array.from(fields).map((field) => ({
              tagName: field.tagName.toLowerCase(),
              type: field.type || "text",
              name: field.name || "",
              id: field.id || "",
              placeholder: field.placeholder || "",
              required: field.required || false,
              label: field.labels?.[0]?.textContent?.trim() || "",
            })),
          };
        });
      }, formSelector);

      return `Found ${formInfo.length} form(s):\n${JSON.stringify(
        formInfo,
        null,
        2
      )}`;
    } catch (err) {
      return `Failed to get form info: ${err.message}`;
    }
  },
});

//*************** Form Filling Tool ***********************/
const formFillingTool = tool({
  name: "form_filling_tool",
  description:
    "Find and fill form fields with provided data. Can handle input fields, textareas, select dropdowns, checkboxes, and radio buttons.",
  parameters: z.object({
    formData: z
      .object({
        fields: z
          .array(
            z.object({
              selector: z
                .string()
                .describe(
                  "CSS selector, placeholder text, label text, or field name to identify the form field"
                ),
              value: z.string().describe("Value to fill in the field"),
              type: z
                .enum(["input", "textarea", "select", "checkbox", "radio"])
                .describe(
                  "Type of form field (optional, will auto-detect if not provided)"
                ),
            })
          )
          .describe("Array of form fields to fill"),
      })
      .describe("Form data containing fields to fill"),
  }),
  async execute({ formData }) {
    if (!page) throw new Error("No page initialized. Call openBrowser first.");

    const results = [];

    for (const field of formData.fields) {
      try {
        let element = null;
        const { selector, value, type } = field;

        const strategies = [
          () => page.locator(selector),
          () => page.getByPlaceholder(selector),
          () => page.getByLabel(selector),
          () => page.locator(`[name="${selector}"]`),
          () => page.locator(`#${selector}`),
          () => page.getByTestId(selector),
          () =>
            page.locator(
              `label:has-text("${selector}") + input, label:has-text("${selector}") + textarea, label:has-text("${selector}") + select`
            ),
          () =>
            page.locator(
              `input[aria-label="${selector}"], textarea[aria-label="${selector}"], select[aria-label="${selector}"]`
            ),
        ];

        // loop through each strategy until one works
        for (const strategy of strategies) {
          try {
            const locator = strategy();
            if ((await locator.count()) > 0) {
              element = locator.first();
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!element) {
          results.push(`Could not find element with selector: ${selector}`);
          continue;
        }

        await element.waitFor({ state: "visible", timeout: 5000 });

        // Auto-detect element type if not given
        let fieldType = type;
        if (!fieldType) {
          const tagName = await element.evaluate((el) =>
            el.tagName.toLowerCase()
          );
          const inputType = await element.evaluate((el) =>
            el.type?.toLowerCase()
          );

          if (tagName === "select") {
            fieldType = "select";
          } else if (tagName === "textarea") {
            fieldType = "textarea";
          } else if (tagName === "input") {
            if (inputType === "checkbox") {
              fieldType = "checkbox";
            } else if (inputType === "radio") {
              fieldType = "radio";
            } else {
              fieldType = "input";
            }
          } else {
            fieldType = "input";
          }
        }

        // Fill the field based on its type
        switch (fieldType) {
          case "input":
          case "textarea":
            await element.clear();
            await element.type(value, { delay: 120 });

            await element.blur();
            await element.focus();
            break;

          case "select":
            await element.selectOption({ label: value });
            break;

          case "checkbox":
            const isChecked = await element.isChecked();
            const shouldCheck =
              value.toLowerCase() === "true" ||
              value.toLowerCase() === "checked" ||
              value === "1";
            if (isChecked !== shouldCheck) {
              await element.click();
            }
            break;

          case "radio":
            await element.check();
            break;

          default:
            await element.type(value, { delay: 120 });
        }

        // Wait a bit for any dynamic updates
        await page.waitForTimeout(500);

        results.push(
          `Successfully filled ${fieldType} field "${selector}" with value: ${value}`
        );
      } catch (err) {
        results.push(
          `Failed to fill field "${field.selector}": ${err.message}`
        );
      }
    }

    return `Form filling completed: ${results}`;
  },
});

/******** Form Submission Tool */
const submitFormTool = tool({
  name: "submit_form_tool",
  description: "Submit a form by clicking submit button or pressing Enter",
  parameters: z.object({
    submitSelector: z
      .string()
      .describe(
        "CSS selector for submit button (optional, will try common selectors)"
      ),
    method: z
      .enum(["click", "enter"])
      .default("click")
      .describe("Method to submit form - click button or press Enter"),
  }),
  async execute({ submitSelector, method = "click" }) {
    if (!page) throw new Error("No page initialized. Call openBrowser first.");

    try {
      if (method === "enter") {
        await page.keyboard.press("Enter");
        return "Form submitted by pressing Enter";
      }

      // find submit button
      const submitSelectors = [
        submitSelector,
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit")',
        'button:has-text("Sign Up")',
        'button:has-text("Register")',
        'button:has-text("Login")',
        'button:has-text("Sign In")',
        ".submit-btn",
        "#submit",
        '[data-testid*="submit"]',
      ].filter(Boolean);

      for (const selector of submitSelectors) {
        try {
          const element = page.locator(selector).first();
          if ((await element.count()) > 0 && (await element.isVisible())) {
            await element.click();
            return `Form submitted by clicking: ${selector}`;
          }
        } catch (e) {
          continue;
        }
      }

      return "Could not find submit button. Try specifying a specific selector.";
    } catch (err) {
      return `Failed to submit form: ${err.message}`;
    }
  },
});

//*************** Browser Closing Tool ***********************/
const closeBrowser = tool({
  name: "close_browser_tool",
  description: "close the browser",
  parameters: z.object({}),

  async execute() {
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
      return "Browser closed successfully";
    } else {
      return "No browser is currently open";
    }
  },
});

const webAutomationAgent = new Agent({
  name: "Web Automation Agent",
  model: "gemini-2.0-flash",
  tools: [
    openBrowser,
    clickElement,
    getFormInfoTool,
    formFillingTool,
    submitFormTool,
    closeBrowser,
  ],
  instructions: `
    You are a web automation agent responsible for performing specific tasks on websites. 
    Based on user queries, your tasks are to:
    - Open the browser and navigate to the given URL
    - Find specific selector or text in whole website to click on the element
    - Fill data in input forms using the form_filling_tool with proper field identification
    - Submit forms using submit_form_tool
    - Get form information using get_form_info_tool if needed
    - Close the browser when done
    
    For form filling:
    - Use get_form_info_tool first if you need to understand the form structure
    - Use form_filling_tool with an array of fields containing selector and value
    - You can identify fields by CSS selector, placeholder text, label text, or field name
    - Use submit_form_tool to submit the form after filling
    
    Always use the open_browser_tool first, then other tools as needed.
    `,
});

async function chatWithAgent(query) {
  try {
    const result = await run(webAutomationAgent, query);

    console.log("Final Output = ", result.finalOutput);

    if (browser) {
      setTimeout(async () => {
        await browser.close();
        console.log("Browser closed after 5 seconds");
      }, 5000);
    }
  } catch (error) {
    console.log("Error in chatWithAgent:", error);
    // Close browser on error
    if (browser) {
      await browser.close();
    }
  }
}

chatWithAgent(
  `
  open the website 'https://ui.chaicode.com/' in new browser, click on 'Sign Up' button, if it is not available Click on the 'Authentication' menu, and then click on 'Sign Up' button after that fill the form with:
  - First Name: Rohit 
  - Last Name: Kumar
  - Email: rohit@chaicode.com
  - Password: Chaicode@123
  - Confirm Password: Chaicode@123

  Then submit the form
  `
).catch((error) => {
  console.log("Error :", error);
});
