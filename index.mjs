import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import {router as waRouter} from './whatsapp.mjs';
import {init as initLLM} from './llm.mjs';

initLLM();

const app = express();
app.use(express.json());

app.use('/whatsapp', waRouter);

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(8080, () => {
    console.log('Server is running');
});