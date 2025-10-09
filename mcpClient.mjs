import { tool } from '@openai/agents';
import { ToolsList } from './db.mjs'
const MCP_URL = process.env.CRM_URL + '/mcp';

async function jsonRpcRequest(method, params, token=null) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
      headers.authorization = "Bearer " + token;
  }
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: Math.floor(Math.random() * 1000)
    })
  });

  const responseText = await response.text();
  try {
    const data = JSON.parse(responseText);
    if (data.error) {
      return data.error;
    }
    return data.result;
  } catch(e) {
    console.log(MCP_URL, headers, method, params, e);
    return "Internal Error calling " + method;
  }
}

async function getToolsList(token = null, phone = null) {
  const authenticated = !!token;
  let list = [];

  const result = await ToolsList.findOne({ authenticated }).lean();
  if (result) {
    list = result.tools;
  } else {
    console.log("Getting the list of tools.");
    list = (await jsonRpcRequest("tools/list", [], token)).tools;
    list = list.map(tool => ({
      ...tool,
      parameters: tool.inputSchema,
      inputSchema: undefined
    }));
    await ToolsList.findOneAndUpdate(
      { authenticated },
      { authenticated, tools: list },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  if (Array.isArray(list)) {
    const ret = [];

    // call tool for each list element
    list.forEach(t => {
      ret.push(tool({
        ...t,
        execute: async (args) => {
          if (!token) {
            args.phone = phone;
          }
          return await callTool(t.name, args, token)
        }
      }));
    });
    return ret;
  }

  return [];
}

async function callTool(tool, args={}, token=null) {
    console.log(`🔧 Calling ${tool} with`, args);
    return await jsonRpcRequest("tools/call", {
        name: tool,
        arguments: args
    }, token);
}

export { getToolsList, callTool }