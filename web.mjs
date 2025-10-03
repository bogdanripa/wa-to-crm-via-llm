// web interface for sending and receiving messages

import dotenv from 'dotenv';
import express from 'express';
import { WAUser, WAMessage } from './db.mjs';
import { callTool } from './mcpClient.mjs';

dotenv.config();
let messageCallback = null;
const router = express.Router();

async function resetCRM(email, phone, token) {
    // delete all interactions from the "Terminator" account
    const terminatorFindings = await callTool("findByName", {name: "Terminator"}, token);
    if (terminatorFindings.length) {
        if (terminatorFindings[0].type == 'account') {
            const account_id = terminatorFindings[0].account_id;
            if (account_id) {
                const account = await callTool("getAccountDetails", {account_id}, token) 
                // remove all interactions
                for (let i in account.interactions) {
                    const interaction_id = account.interactions[i].id;
                    await callTool("deleteInteraction", {account_id, interaction_id}, token)
                }
                // delete all action items
                for (let i in account.actionItems) {
                    const action_item_id = account.actionItems[i].id;
                    await callTool("deleteActionItem", {account_id, action_item_id}, token)
                }
                // remove all employees except for Arnold
                for (let i in account.employees) {
                    if (account.employees[i].name.toLowerCase() != 'arnold') {
                        const contact_id = account.employees[i].id;
                        await callTool("removeContact", {account_id, contact_id}, token)
                    }
                }
            }
        } 
    }
}

router.post('/message', async (req, res) => {
    const text = req.body.message;
    const conversationId = req.body.conversation_id;
    if (!text) {
        res.status(400).send("Please provide a message");
        return;
    }
    let email = null;
    let user;
    let token;
    if (!req.headers.authorization) {
        res.status(401).send("Unauthroized");
        return;
    } else {
        token = req.headers.authorization.replace("Bearer ", '');
        user = await WAUser.findOne({ token });
        if (!user) {
            let userData = await callTool("getUserDataFromToken", { auth_token: token });
            if (userData.email) {
                user = await WAUser.findOne({ email: userData.email });
                if (user) {
                    user.token = token;
                    await user.save();
                } else {
                    user = await WAUser.create({
                        token,
                        email: userData.email,
                        name: userData.name
                    });
                }
                email = userData.email;
            } else {
                // user not found
                res.status(404).send("Could not authrize user")
                return;
            }
        } else {
            email = user.email;
        }
    }
    console.log(`⬅️ "${text}" from ${email}`);
    if (!messageCallback) {
        console.error('No message callback set');
        return res.sendStatus(500);
    }
    let response;
    if (text === "Reset") {
        response = "Reset";

        await resetCRM(user.email, user.phone, token);
        user.previous_response_id = undefined;
        await user.save();
    } else {
        response = await messageCallback({email, text, conversationId});
    }
    console.log(`➡️ "${response}" to ${email}`);
    res.send(response);
})

function setWebMessageCallback(callback) {
    if (typeof callback !== 'function') {
        throw new Error('Callback must be a function');
    }
    messageCallback = callback;
}

export {router, setWebMessageCallback}