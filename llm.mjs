import dotenv from 'dotenv';
dotenv.config();

import OpenAI from "openai";
import { getToolsList, callTool } from './mcpClient.mjs';
import {WAUser, WAMessage} from './db.mjs';

const openai = new OpenAI();

function truncateLongStringsReplacer(key, value) {
    if (typeof value === "string" && value.length > 50) {
      return value.slice(0, 50) + "...";
    }
    return value;
}

export async function rewriteMessage(phone, message) {
    if (!message || typeof message !== 'string') {
        console.error('Invalid message for rewriting:', message);
        return '';
    }
    // get user details from phone number
    const user = await WAUser.findOne({ phone });
    if (!user) {
        console.error('User not found for phone:', phone);
        return '';
    }

    try {
        const payload = {
            model: "gpt-4o",
            instructions: `You rewrite a single user message to be clearer and more concise, while keeping the original intent and tone.
- Output exactly one paragraph of flowing text (no bullet points, no headings).
- Prefer short sentences; remove filler, hedges, and repeated info.
- Preserve proper nouns, dates, numbers, links, and action items.
- Never invent facts or add new requests.
- If you are sending the same message over and over again, return a blank string.`,
            input: [{ role: "user", content: message }],
        };
        if (user.previous_response_id) {
            payload.previous_response_id = user.previous_response_id;
        }
        const response = await openai.responses.create(payload);
        if (response.id) {
            user.previous_response_id = response.id;
            await user.save();
        }
        return (response.output_text || "").trim();
    } catch (error) {
        console.error('Error rewriting message:', error.message);
        return message; // Fallback to original message in case of error
    }
}

function extractToolCalls(resp) {
  // Normalize Responses API tool-call items to your { name, arguments, id } shape
  const out = [];
  for (const item of resp.output ?? []) {
    if (item.type === "function_call") {
      out.push(item);
    };
  }
  return out;
}

export async function getResponseFromLLM(user, from, input, conversationId, shouldDropLastRespId = false) {
    //console.log("0 " + JSON.stringify(user, truncateLongStringsReplacer, 2));
    let instructions = '';
    if (user.token) {
        // agent mode = user is authenticated
        
        instructions = `You are talking to ${user.name}. Their phone number is ${from}, and their email address is ${user.email}.
            Today is ${new Date().toString()}.
            You are "Maya" — a friendly, human-like CRM assistant available via WhatsApp, created by Genezio.
            Before making any updates, ask the user for confirmation - to verify the data being updated. Do not make any changes to the CRM data without the user's confirmation.
            Stay on topic and don't deviate from the CRM context.
            If you don't know the answer, say so. If you need more information, ask for it.
            Do not share IDs (like Account IDs, Contact IDs, Action Item IDs, etc) with the user. Those are to be used internally when calling tools.
            If you encounter a name and don't know what it is, use the 'findByName' tool to look it up.
            When discussing with the user, avoid using the term "interaction". Use the specific types of interactions - meeting, call, whatsapp message, note, and so on.
            When calling tools, you must strictly match the exact JSON Schema field names (including casing).
            ---------
            The CRM's homepage is https://genezio-crm.app.genez.io/
            CRM capabilities:
            - A user has access to all CRM accounts created by themselves or other users sharing the same email domain name.
            - All users have the same rights when it comes to managing accounts.
            - An account has multiple contacts (people working at that company).
            - An account has multiple team members (people working on that account).
            - An account has multiple action items (tasks to be done). An action item has a deadline and can be assigned to a team member.
            - An account has a timeline, defined by multiple interactions with that account (meetings, calls, whatsapp messages, notes, emails, notes, sticky notes).
            - An interaction has attendees (people involved in that interaction), a title, a description, and a date.
        `;
    } else {
        // agent mode = user is not authenticated
        instructions = `
Today is ${new Date().toString()}.
You are "Maya" — a friendly, human-like CRM assistant available via WhatsApp, created by Genezio.
You help users manage their accounts, contacts, action items, and interactions — directly from chat.
The CRM's homepage is https://genezio-crm.app.genez.io/.

When introducing yourself, sound natural and approachable, as if you were a helpful person from the Genezio team.
For example:
"Hi! I'm Maya from Genezio — your WhatsApp-based CRM assistant. I can help you manage your accounts, contacts, action items, and customer interactions — all right here in chat."

After introducing yourself, your **sole goal** is to get the user authenticated or help them create an account.

## Does the user have an account with us?
Ask for their *work* email address, make sure it's not a personal email address (gmail, etc), then call the "init_auth" tool.
- If they already have a CRM account, the tool sends them an authentication code via email.
- If they are new, the tool returns an account creation URL that they need to click to start registering.

## Authentication process
Once an auth code has been sent to their work email, ask them to type it here.
Then call the "sign_in" tool with their work email and auth code.
The tool returns a token that you must store for future communications.

## Creating an account
If the user doesn't have an account, send them the URL returned by init_auth and ask them to create an account by clicking the URL.

# General notes
When calling tools, you must strictly match the exact JSON schema field names (including casing).
`;
    }
    const toolsToUse = await getToolsList(user.token, user.phone);
    const ret = {};
    let previous_response_id = shouldDropLastRespId?undefined:user.previous_response_id;
    let nextInput = input;
    let assistantText = 'Waiting...';
    let turn = 0;

    while (turn++ < 10) {
        if (!nextInput) return;
        const payload = {
            model: "gpt-4o",
            instructions,
            input: nextInput,
            store: true,
            tools: toolsToUse,
            tool_choice: "auto"
        };

        if (previous_response_id) {
            payload.previous_response_id = previous_response_id;
        }

        //console.log("1 " + JSON.stringify(payload, truncateLongStringsReplacer, 2));
        let res;
        try {
            res = await openai.responses.create(payload);
        } catch (error) {
            console.error("Error occurred while fetching response:", error);
            console.log(`resetting previous_response_id from ${previous_response_id} to undefined`);
            previous_response_id = undefined;
            continue;
        }
        previous_response_id = res.id;

        //console.log("2 " + JSON.stringify(res, truncateLongStringsReplacer, 2));

        // If there are tool calls, run them (using your existing logic)
        if (res.output.length) {
            const toolMessages = [];

            for (const outputItem of res.output) {
                if (outputItem.type === 'message') continue;
                console.log(`Processing outputItem: ${JSON.stringify(outputItem, truncateLongStringsReplacer)}`);
                if (outputItem.type !== "function_call") {
                    console.log("Untreated outputItem type", outputItem.type);
                    continue;
                }
                const toolName = outputItem.name;
                if (!outputItem.arguments) {
                    console.error(`Tool ${toolName} has no arguments:`, outputItem);
                    continue;
                }
                const args = JSON.parse(outputItem.arguments);

                if (!user.token) args.phone = user.phone;
                console.log(`Tool call: ${toolName}(${JSON.stringify(args, truncateLongStringsReplacer)})`);
                let result = await callTool(toolName, args, user.token);

                if (toolName === 'sign_in') {
                    try {
                        if (result.token) {
                            ret.token = result.token;
                            ret.name = result.name;
                            ret.email = args.email;
                            result = "The user is now authenticated.";
                        }
                    } catch (e) {
                        console.error(e.message);
                    }
                }

                if (toolName === 'init_auth' && result.match(/^http/) && user.secret) {
                    result += user.secret;
                }

                toolMessages.push({
                    type: "function_call_output",
                    call_id: outputItem.call_id,
                    output: JSON.stringify(result),
                });
                console.log(`Tool call response: ${toolName} → ${JSON.stringify(result, truncateLongStringsReplacer)}`);
            }
            if (toolMessages.length === 0) {
                assistantText = res.output_text;
                break;
            }
            nextInput = toolMessages;
        } else {
            assistantText = res.output_text;
            break; // If we have a text response, we can stop here
        }
    }
    // No more tool calls → final assistant answer
    ret.message = assistantText;

    user.previous_response_id = previous_response_id;
    await user.save();

    return ret;
}