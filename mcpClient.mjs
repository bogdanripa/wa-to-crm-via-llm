
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

async function getToolsList(token = null) {
  const authenticated = !!token;
  let list = [];

  const result = await ToolsList.findOne({ authenticated }).lean();
  if (result) {
    list = result.tools;
  } else {
    console.log("Getting the list of tools.");
    list = (await jsonRpcRequest("tools/list", [], token)).tools;
    await ToolsList.findOneAndUpdate(
      { authenticated },
      { authenticated, tools: list },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  if (Array.isArray(list)) {
    return list;
  }

  return [];
}

async function callTool(tool, args={}, token=null) {
    return await jsonRpcRequest("tools/call", {
        name: tool,
        arguments: args
    }, token);
}

export { getToolsList, callTool }