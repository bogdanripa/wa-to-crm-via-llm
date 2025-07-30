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
      const phone = msg.from;
      const text = msg.text?.body;

      console.log(`Received message: "${text}" from ${phone}`);

      if (!messageCallback) {
        console.error('No message callback set');
        return res.sendStatus(500);
      }
      const response = await messageCallback({phone, text});
      await sendMessage(phone, response);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
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
    'authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    'content-type': 'application/json'
  };
  try {
    const response = await axios.post(url, payload, { headers });
    if (response.status === 200) {
      console.log(`Message sent to ${to}: "${text}"`);
    } else {
      console.error(`Failed to send message to ${to}:`, response.data);
    }
  } catch (error) {
    console.error(`Error sending message to ${to}:`, error.message);
  }
}

function setWAMessageCallback(callback) {
  if (typeof callback !== 'function') {
    throw new Error('Callback must be a function');
  }
  messageCallback = callback;
}

export {router, sendMessage, setWAMessageCallback}