import {sendMessage as sendMessageViaWA} from './whatsapp.mjs';
import {getResponseFromLLM, rewriteMessage} from './llm.mjs';
import {WAMessage, WAUser} from './db.mjs';

export async function rewriteThenSendMessage(to, text) {
    if (!to || !text) {
        console.error('Invalid parameters for sending message:', { to, text });
        return;
    }
    const rewrittenMessage = await rewriteMessage(to, text);
    await saveMessage("assistant", to, to, rewrittenMessage);
    await sendMessageViaWA(to, rewrittenMessage);
}

async function saveMessage(from, to, phone, text, conversationId) {
    if (!text || !from || !to) {
        console.error('Invalid parameters for saving message:', { from, to, text });
        return;
    }
    const message = new WAMessage({from, to, phone, message: text, conversationId});
    try {
        await message.save();
    } catch (error) {
        console.error('Error saving message:', error.message);
    }
}

export async function gotMessage({ email, phone, text, conversationId }) {
    const orFilters = [];
    if (phone !== undefined) orFilters.push({ phone });
    if (email !== undefined) orFilters.push({ email });

    const orMessageFilters = [];
    if (phone !== undefined) orMessageFilters.push({ phone });
    if (email !== undefined) orMessageFilters.push({ to: email });

    let waUser = await WAUser.findOne({
        $or: orFilters
    });

    if (!waUser && phone) {
        waUser = new WAUser({ phone });
        await waUser.save();
    }

    if (!waUser) {
        return "User not found";
    }

    // check last conversation time
    let shouldDropLastRespId = true;

    const lastConversation = await WAMessage.findOne({ $or: orMessageFilters }).sort({ createdAt: -1 });
    if (lastConversation && lastConversation.createdAt) {
        if ((Date.now() - lastConversation.createdAt.getTime()) < 24 * 60 * 60 * 1000) {
            shouldDropLastRespId = false;
        }
    }

    await saveMessage(phone || email, "assistant", phone || email, text, conversationId);
    const response = await getResponseFromLLM(waUser, phone || email, text, conversationId, shouldDropLastRespId);
    if (response.token) {
        console.log("Setting CRM token for user", phone || email);
        waUser.token = response.token;
        waUser.email = response.email;
        waUser.name  = response.name;
        await waUser.save();
    }
    await saveMessage("assistant", phone || email, phone || email, response.message, conversationId);
    return response.message;
}