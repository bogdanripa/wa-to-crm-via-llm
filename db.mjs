import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose'
mongoose.connect(process.env["GENEZIO_CRM_DATABASE_URL"]);

const waMessageSchema = new mongoose.Schema({
    from: String,
    to: String,
    phone: String,
    message: String,
    conversationId: String,
    tool_call_id: String,
    tool_calls: Object
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
        inputSchema: Object,
        _id: false // disables _id in subdocs
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