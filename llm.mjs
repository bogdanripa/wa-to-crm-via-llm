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
    if (item.type === "tool_call" && item.tool_call) {
      const { name, arguments: args, id } = item.tool_call;
      out.push({
        id: id || `tc_${out.length + 1}`,
        function: {
          name,
          arguments: typeof args === "string" ? args : JSON.stringify(args ?? {})
        }
      });
    }
  }
  return out;
}

function makeToolMessage(name, tool_call_id, resultObj) {
  return {
    role: "tool",
    name,
    tool_call_id,
    content: JSON.stringify(resultObj)
  };
}

export async function getResponseFromLLM(user, from, input, conversationId) {
    let instructions = '';
    if (user.token) {
        // agent mode = user is authenticated
        
        instructions = `You are talking to ${user.name}. Their phone number is ${from}, and their email address is ${user.email}.
            Today is ${new Date().toString()}.
            You are a helpful assistant helping the user query and make updates to their CRM system.
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
            You are a helpful assistant helping the user query and make updates to their CRM system.
            However, the current user is not authenticated. So at this point, your sole goal is to get the user authenticated.
            You need to authenticate them by asking for their email address, then call the "initAuth" tool. This will send an auth code to their email address.
            If the email address is not found, ask them to create an account.
            Next, you will ask the user to type back the auth code they received over email.
            Once they have provided the auth code back, you will call the "authenticate" tool with their email and auth code.
            The authenticate tool will return a token that we'll then store for subsequent communications.
            When calling tools, you must strictly match the exact JSON Schema field names (including casing).
            The CRM's homepage is https://genezio-crm.app.genez.io/
        `;
    }
    const toolsToUse = await getToolsList(user.token);
    const ret = {};
    let previous_response_id = user.previous_response_id;
    let nextInput = Array.isArray(input) ? input : [{ role: "user", content: input }];

    while (true) {
        const payload = {
            model: "gpt-4o",
            instructions,
            input: nextInput,
            tools: toolsToUse,
            tool_choice: "auto"
        };

        if (previous_response_id) {
            payload.previous_response_id = previous_response_id;
        }

        const res = await openai.responses.create(payload);
        previous_response_id = res.id;
        //console.log("2 " + JSON.stringify(toolsToUse, truncateLongStringsReplacer, 2));
        //console.log("3 " + JSON.stringify(res, truncateLongStringsReplacer, 2));

        // If there are tool calls, run them (using your existing logic)
        const toolCalls = extractToolCalls(res);
        if (toolCalls.length) {
            const toolMessages = [];

            for (const toolCall of toolCalls) {
                const toolName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);

                console.log(`🔧 Calling ${toolName} with`, args);

                if (!user.token) args.phone = user.phone;

                let result = await callTool(toolName, args, user.token);

                if (toolName === 'authenticate') {
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

                await WAMessage.create({
                    from: "system",
                    to: from,
                    phone: from,
                    message: `Called ${toolName} with
\`\`\`json
${JSON.stringify(args, truncateLongStringsReplacer, 2)}
\`\`\`

And got
\`\`\`json
${JSON.stringify(result, truncateLongStringsReplacer, 2)}
\`\`\``,
                    conversationId,
                    // NEW: store the response id that led to this tool call
                });

                toolMessages.push(makeToolMessage(toolName, toolCall.id, result));
            }
            nextInput = toolMessages;

            // After handling tools, loop again so the model can continue
            // Now our "previousId" becomes the id from the last model turn.
            continue;
        }

        // No tool calls → final assistant answer
        const assistantText = (res.output_text ?? "").trim();
        ret.message = assistantText;

        user.previous_response_id = previous_response_id;
        await user.save();

        // Store the assistant turn with its response id for chaining
        await WAMessage.create({
            from: "assistant",
            to: from,
            phone: from,
            message: assistantText,
            conversationId,
        });

        return ret;
    }
}