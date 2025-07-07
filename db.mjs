import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose'
mongoose.connect(process.env["GENEZIO_CRM_DATABASE_URL"]);

const waMessageSchema = new mongoose.Schema({
    from: String,
    to: String,
    message: String,
}, {
    timestamps: true
});

const WAMessage = mongoose.model("WAMessage", waMessageSchema);

const waUsersSchema = new mongoose.Schema({
    name:  String,
    phone: String,
    email: String,
    token: String,
}, {
    timestamps: true
});

const WAUser = mongoose.model("WAUser", waUsersSchema);

const toolsListSchema = new mongoose.Schema({
    authenticated: Boolean,
    tools: [{
        name: String,
        title: String,
        description: String,
        inputSchema: Object // refine as needed
    }]
}, {
    timestamps: true
});

const ToolsList = mongoose.model("ToolsList", toolsListSchema);

export {
    WAMessage, 
    WAUser,
    ToolsList
};