import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import {router as waRouter, setWAMessageCallback} from './whatsapp.mjs';
import { router as webRouter, setWebMessageCallback } from './web.mjs';
import {rewriteThenSendMessage, gotMessage} from './comms.mjs';
import { ToolsList, WAMessage } from './db.mjs';
import { marked } from 'marked';
import { WAUser } from './db.mjs';

setWAMessageCallback(gotMessage);
setWebMessageCallback(gotMessage);

const app = express();
app.use(express.json());

app.use('/whatsapp', waRouter);
app.use('/web', webRouter);

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.post('/clearCache', async (_req, res) => {
  await ToolsList.deleteMany();
  res.status(204).send();
});

app.post('/sendMessage', async (req, res) => {
  const bearer = req.headers.authorization;
  if (!bearer || bearer !== `Bearer ${process.env.EMAIL_CODE_AUTH_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'Missing "phone" or "message" in request body' });
  }

  try {
    await rewriteThenSendMessage(phone, message);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error sending message:', error.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.post('/signUpUser', async (req, res) => {
  const bearer = req.headers.authorization;
  if (!bearer || bearer !== `Bearer ${process.env.EMAIL_CODE_AUTH_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { secret, name, email, token } = req.body;

  const user = await WAUser.findOne({ secret });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.name = name;
  user.email = email;
  user.token = token;
  user.secret = undefined;

  await user.save();

  await rewriteThenSendMessage(phone, "Welcome! You are now authenticated.");

  res.status(200).json({ phone: user.phone });
});

function highlightJsonBlocks(text) {
  const jsonLikePattern = /({[\s\S]*?})/g;
  return text.replace(jsonLikePattern, (match) => {
    try {
      const parsed = JSON.parse(match);
      const pretty = JSON.stringify(parsed, null, 2);
      return `\n\n\`\`\`json\n${pretty}\n\`\`\`\n\n`;
    } catch (e) {
      return match; // leave it as-is if not valid JSON
    }
  });
}

app.get('/conversation/:id', async (req, res) => {
  const conversationId = req.params.id;
  if (!conversationId) {
    return res.status(400).json({ error: 'Missing conversation ID' });
  }
  try {
    const messages = await WAMessage.find({ conversationId }).sort({ createdAt: 1 });
    let htmlOutput = `
      <html>
        <head>
          <title>Conversation History</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 800px;
              margin: 2rem auto;
              background-color: #f9f9f9;
              padding: 1rem;
              border-radius: 8px;
              box-shadow: 0 0 10px rgba(0,0,0,0.1);
            }
            h1 {
              text-align: center;
              color: #333;
            }
            .message {
              margin-bottom: 1.5rem;
              padding: 1rem;
              background: #fff;
              border-radius: 6px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            .from {
              font-weight: bold;
              color: #007BFF;
            }
            .timestamp {
              font-size: 0.9em;
              color: #777;
            }
            .content {
              margin-top: 0.5rem;
            }
            ol, ul {
              padding-left: 1.5rem;
            }
          </style>
        </head>
        <body>
          <h1>Conversation History</h1>
    `;
        // Append messages
    messages.forEach(msg => {
      const enhancedMessage = msg.message || '';//highlightJsonBlocks(msg.message || '');
      const htmlMessage = marked.parse(enhancedMessage);
      
      htmlOutput += `
        <div class="message">
          <div><span class="from">${msg.from}</span> <span class="timestamp">(${msg.createdAt.toISOString()})</span></div>
          <div class="content">${htmlMessage}</div>
        </div>
      `;
    });

    htmlOutput += `
        </body>
      </html>
    `;

    res.send(htmlOutput);
  } catch (error) {
    console.error('Error fetching conversation:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

app.listen(8080, () => {
    console.log('Server is running');
});