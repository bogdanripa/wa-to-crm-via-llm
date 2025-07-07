import dotenv from 'dotenv';
dotenv.config();

import OpenAI from "openai";
import { getToolsList, callTool } from './mcpClient.mjs';
import {WAMessage} from './db.mjs';

const openai = new OpenAI();

export async function rewriteMessage(phone, message) {
    if (!message || typeof message !== 'string') {
        console.error('Invalid message for rewriting:', message);
        return '';
    }
    // get conversation history for the phone number
    const messages = await WAMessage.find({
        $or: [
            { from: phone },
            { to: phone }
        ]
    })
    .sort({ createdAt: -1 })
    .limit(10);

    let conversationHistory = "";
    messages.reverse().forEach(msg => {
        if (msg.from.match(/\d+/i)) {
            conversationHistory += `- User: ${msg.message}\n`;
        } else {
            conversationHistory += `- Assistant: ${msg.message}\n`;
        }
    });

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: `
You are a helpful assistant that rewrites a message to be more concise and clear.
The result should be a text that flows, not a list of bullet points.
I will provide you the conversation history so that you have some context:
${conversationHistory}
                ` },
                { role: "user", content: message }
            ],
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error rewriting message:', error.message);
        return message; // Fallback to original message in case of error
    }
}

export async function getResponseFromLLM(user) {
    const from = user.phone;
    let inputMessages = [];
    let messages = await WAMessage.find({
        $or: [
                { from: from },
                { to: from },
                { phone: from}
            ]
        })
        .sort({ createdAt: -1 })
        .limit(10);
    messages = messages.reverse();
    inputMessages = messages.map(msg => {
        return msg.from.match(/\d+/i)
        ? {role: "user", content: msg.message}
        : {role: msg.from, content: msg.message};
    });
    if (user.token) {
        // agent mode = user is authenticated
        inputMessages.unshift({role: "system", content: `
            You are talking to ${user.name}. Their phone number is ${from}, and their email address is ${user.email}.
            Today is ${new Date().toString()}.
            You are a helpful assistant helping the user query and make updates to their CRM system.
            Before making any updates, ask the user for confirmation - to verify the data being updated. Do not make any changes to the CRM data without the user's confirmation.
            Stay on topic and don't deviate from the CRM context.
            If you don't know the answer, say so. If you need more information, ask for it.
            Do not share IDs (like Account IDs, Contact IDs, Action Item IDs, etc) with the user. Those are to be used internally when calling tools.
            If you encounter a name and don't know what it is, use the 'get_find' tool to look it up.
            When discussion with the user, avoid using the term "interaction". Use the specific types of interactions - meeting, call, whatsapp message, note, and so on.
            The CRM's homepage is https://genezio-crm.app.genez.io/
            CRM capabilities:
            - A user has access to all CRM accounts created by themselves or other users sharing the same email domain name.
            - All users have the same rights when it comes to managing accounts.
            - An account has multiple contacts (people working at that company).
            - An account has multiple team members (people working on that account).
            - An account has multiple action items (tasks to be done). An action item has a deadline and can be assigned to a team member.
            - An account has a timeline, defined by multiple interactions with that account (meetings, calls, whatsapp messages, notes, emails, notes, sticky notes).
            - An interaction has participants (people involved in that interaction), a title, a description, and a date.
        `});
    } else {
        // agent mode = user is not authenticated
        inputMessages.unshift({role: "system", content: `
            Today is ${new Date().toString()}.
            You are a helpful assistant helping the user query and make updates to their CRM system.
            However, the current user is not authenticated. So at this point, your sole goal is to get the user authenticated.
            You need to authenticate them by asking for their email address, then call the "initAuth" tool. This will send an auth code to their email address.
            If the email address is not found, ask them to create an account.
            Next, you will ask the user to type back the auth code they received over email.
            Once they have provided the auth code back, you will call the "authenticate" tool with their email and auth code.
            The authenticate tool will return a token that we'll then store for subsequent communications.
            The CRM's homepage is https://genezio-crm.app.genez.io/
        `});
    }
    const toolsToUse = await getToolsList(user.token);
    const ret = {};

    while (true) {
        const res = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: inputMessages,
            tools: toolsToUse,
            tool_choice: "auto"
        });
        const message = res.choices[0].message;

          if (message.tool_calls?.length) {
            for (const toolCall of message.tool_calls) {
                const toolName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);

                console.log(`🔧 Calling ${toolName} with`, args);

                if (!user.token) args.phone = user.phone;

                let result = await callTool(toolName, args, user.token);
                // TODO: treat token has expired

                if (toolName == 'authenticate') {
                    try {
                        if (result.token) {
                            ret.token = result.token;
                            ret.name = result.name;
                            ret.email = args.email;
                            result = "The user is now authenticated."
                        }
                    } catch(e) {
                        console.error(e.message);
                    }
                }

                inputMessages.push({
                    role: "assistant",
                    content: `Calling ${toolName} with ${JSON.stringify(args)}`,
                    tool_calls: [toolCall]
                });

                WAMessage.create({
                    from: "assistant",
                    to: "tool",
                    phone: user.phone,
                    message: `Calling ${toolName} with ${JSON.stringify(args)}`
                });

                inputMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: JSON.stringify(result)
                });

                WAMessage.create({
                    from: "tool",
                    to: "assistant",
                    phone: user.phone,
                    message: `Result of ${toolName}: ${JSON.stringify(result)}`
                });
            }
        } else {
            // Final assistant answer
            ret.message = message.content;
            return ret;
        }
    }
}