import {sendMessage as sendMessageViaWA} from './whatsapp.mjs';
import {setCRMToken} from './tools.mjs';
import {getResponseFromLLM, rewriteMessage} from './llm.mjs';
import {WAMessage, WAUser} from './db.mjs';

export async function rewriteThenSendMessage(to, text) {
    if (!to || !text) {
        console.error('Invalid parameters for sending message:', { to, text });
        return;
    }
    const rewrittenMessage = await rewriteMessage(to, text);
    await saveMessage(to, rewrittenMessage);
}

export async function sendMessage(to, text) {
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

export async function gotMessage(from, text) {
    let waUser = await WAUser.findOne({phone: from});    
    if (!waUser) {
        waUser = new WAUser({phone: from});
        await waUser.save();
    }
    if (waUser.token)
        setCRMToken(waUser.token);
    
    await saveMessage(from, "assistant", text);
    const response = await getResponseFromLLM(waUser);
    if (response.token) {
        console.log("Setting CRM token for user", from);
        waUser.token = response.token;
        waUser.email = response.email;
        waUser.name  = response.name;
        await waUser.save();
    }
    await sendMessage(from, response.message);
}