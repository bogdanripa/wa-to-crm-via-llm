import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import {router as waRouter, setMessageCallback} from './whatsapp.mjs';
import {sendMessage, gotMessage} from './comms.mjs';

setMessageCallback(gotMessage);

const app = express();
app.use(express.json());

app.use('/whatsapp', waRouter);

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.post('/sendMessage', async (req, res) => {
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

app.listen(8080, () => {
    console.log('Server is running');
});