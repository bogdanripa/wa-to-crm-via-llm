import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import axios from 'axios';

const router = express.Router();
let messageCallback = null;

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_SECRET) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

router.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;

    if (messages && messages.length > 0) {
      const msg = messages[0];
      const from = msg.from;
      const text = msg.text?.body;

      console.log(`Received message: "${text}" from ${from}`);

      if (!messageCallback) {
        console.error('No message callback set');
        return res.sendStatus(500);
      }
      await messageCallback(from, text);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

router.post('/sendMessage', async (req, res) => {
  const bearer = req.headers.authorization;
  if (!bearer || bearer !== `Bearer ${process.env.EMAIL_CODE_AUTH_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'Missing "phone" or "text" in request body' });
  }

  try {
    await sendMessage(phone, message);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error sending message:', error.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    type: 'text',
    to: to,
    text: { body: text }
  }
  const headers = {
    'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
  try {
    await axios.post(url, payload, { headers });
  } catch (error) {
    console.error(`Error sending message to ${to}:`, error.message);
  }
}

function setMessageCallback(callback) {
  if (typeof callback !== 'function') {
    throw new Error('Callback must be a function');
  }
  messageCallback = callback;
}

export {router, sendMessage, setMessageCallback}