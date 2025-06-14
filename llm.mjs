import dotenv from 'dotenv';
dotenv.config();

import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";
import {WAMessage, WAUser} from './db.mjs';
import {sendMessage as sendMessageViaWA, setMessageCallback} from './whatsapp.mjs';
import {getUserToken, initAuth, authenticate} from './crm.mjs';
import {tools, setCRMToken, callApi} from './tools.mjs';

//console.log(JSON.stringify(tools, null, 2));

const openai = new OpenAI();

async function getResponseFromLLM(from) {
    let messages = await WAMessage.find({
    $or: [
        { from: from },
        { to: from }
    ]
    })
    .sort({ createdAt: -1 })
    .limit(10);
    messages = messages.reverse();
    const user = await WAUser.findOne({phone: from});
    const inputMessages = messages.map(msg => {
        return msg.from.match(/\d+/i)
        ? {role: "user", content: msg.message}
        : {role: msg.from, content: msg.message};
    });
    let threadId;
    if (messages.length === 0 || messages[0].createdAt < new Date(Date.now() - 60 * 60 * 1000) || !user.threadId) {
        threadId = uuidv4();
        user.threadId = threadId;
        await user.save();
    } else {
        threadId = user.threadId;
    }
    inputMessages.unshift({role: "system", content: `
        You are a helpful assistant helping the user query and make updates to their CRM sysrem.
        Stay on topic and don't deviate from the CRM context.
        If you don't know the answer, say so. If you need more information, ask for it.
        Do not share IDs (like Account IDs, Contact IDs, Action Item IDs, etc) with the user. Those are to be used internally when calling tools.
        If you encounter a name and don't know what it is, use the 'get_find' tool to look it up.
        When discussion with the user, avoid using the term "interaction". Use the specific types of interactions - meeting, call, whatsapp message, note, and so on.
        The CRM's gomepage is https://genezio-crm.app.genez.io/
        CRM capabilities:
        - A user has access to all CRM accounts created by themselves or othger users sharing the same email domain name.
        - All users have the same rights when it comes to managing accounts.
        - An account has multiple contacts (people working at that company).
        - An account has multiple team members (people working on that account).
        - An account has multiple action items (tasks to be done). An action item has a deadline and can be assigned to a team member.
        - An account has a timeline, defined by multiple interactions with that account (meetings, calls, whatsapp messages, notes, emails, notes, sticky notes).
        - An interaction has participants (people involved in that interaction), a title, a description, and a date.
        Today is ${new Date().toString()}
    `});

    let step  = 1;
    while (true) {
        const res = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: inputMessages,
            tools,
            tool_choice: "auto"
        });
        const message = res.choices[0].message;

          if (message.tool_calls?.length) {
            for (const toolCall of message.tool_calls) {
                const toolName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);

                console.log(`🔧 Calling ${toolName} with`, args);

                const result = await callApi(toolName, args);

                inputMessages.push({
                    role: "assistant",
                    content: `Calling ${toolName} with ${JSON.stringify(args)}`,
                    tool_calls: [toolCall]
                });

                WAMessage.create({
                    from: "assistant",
                    to: "tool",
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
                    message: `Result of ${toolName}: ${JSON.stringify(result)}`
                });
            }
        } else {
            // Final assistant answer
            console.log("✅ Assistant:", message.content);
            return message.content;
        }
    }
}

async function sendMessage(to, text) {
    // save the message to the database
    await saveMessage("assistant", to, text);
    await sendMessageViaWA(to, text);
}

async function saveMessage(from, to, text) {
    if (!text || !from || !to) {
        console.error('Invalid parameters for saving message:', { from, to, text });
        return;
    }
    const message = new WAMessage({from, to, message: text});
    try {
        await message.save();
    } catch (error) {
        console.error('Error saving message:', error.message);
    }
}

async function extractCodeAndEmail(from) {
    let [code, email] = [null, null];
    const messages = await WAMessage.find({from: from}).sort({createdAt: -1}).limit(10);
    for (const msg of messages) {
        if (!code) {
            const codeMatch = msg.message.match(/(\d{16})/); // Assuming the code is a 16-digit number
            if (codeMatch) {
                code = codeMatch[1];
            }
        }
        if (!email) {
            const emailMatch = msg.message.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch) {
                email = emailMatch[1];
            }
        }
        if (code && email) {
            break; // Stop searching once both are found
        }
    }
    return [code, email];
}

async function gotMessage(from, text) {
    let waUser = await WAUser.findOne({phone: from});
    await saveMessage(from, "assistant", text);

    let token = waUser ? waUser.token : null;
    if (!token) {
        console.log(`No token found for ${from}.`);
        token = await getUserToken(from);
        if (!token) {
            const msgCount = await WAMessage.countDocuments({from: from});
            console.log(`Found ${msgCount} messages from ${from}.`);
            if (msgCount > 1) {
                // we already talked. look for the code and the email
                const [code, email] = await extractCodeAndEmail(from);
                if (code && email) {
                    token = await authenticate(email, from, code);
                    if (!token) {
                        await WAMessage.deleteMany({from: from});
                        await WAMessage.create({from, to: "assistant", message: "Hello"});
                        await sendMessage(from, "Something did not work. Let's try again. Please share your email address.");
                        return;
                    }
                } else if (email) {
                    const response = await initAuth(email);
                    if (response) {
                        await sendMessage(from, response);
                        return;
                    } else {
                        await WAMessage.deleteMany({from: from});
                        await WAMessage.create({from, to: "assistant", message: "Hello"});
                        await sendMessage(from, "Something did not work. Let's try again. Please share your email address.");
                        return;                        
                    }
                } else {
                    await sendMessage(from, "I couldn't find your email address or code in our previous messages. Could you please share your email address so I can sign you in?");
                    return;
                }
            } else {
                await sendMessage(from, "Looks like you're new around here. Do you mind sharing your email address so that I can sign you in?");
                return;
            }
        }
        waUser = new WAUser({phone: from, token});
        await waUser.save();
        await sendMessage(from, "Thank you! You've now been authenticated. What can I do for you?");
        console.log(`Token for ${from} updated successfully.`);
        return;
    }
    setCRMToken(token);
    const response = await getResponseFromLLM(from);
    await sendMessage(from, response);
}

function init() {
    setMessageCallback(gotMessage);
}

export {init};