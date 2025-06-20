import fs from "fs";

const swaggerPath = "./swagger.json";
const rawSwagger = fs.readFileSync(swaggerPath, "utf8");
const swagger = JSON.parse(rawSwagger);

let crmToken = null;

const tools = [];

function cleanupSchema(obj) {
  if (Array.isArray(obj)) {
    for (let i = obj.length - 1; i >= 0; i--) {
      const item = obj[i];
      if (typeof item === "object" && item !== null) {
        cleanupSchema(item);
      }
    }
  } else if (typeof obj === "object" && obj !== null) {
    for (const key of Object.keys(obj)) {
      const val = obj[key];

      // Remove or fix invalid 'required'
      if (key === "required") {
        if (!Array.isArray(val)) {
          delete obj[key];
          continue;
        }
      }

      // Recurse into nested objects
      if (typeof val === "object" && val !== null) {
        cleanupSchema(val);
      }
    }
  }
}

// 3. Build a tool for each endpoint
for (const path in swagger.paths) {
  const methods = swagger.paths[path];

  for (const method in methods) {
    const operation = methods[method];
    let operationId = operation.operationId || `${method}_${path}`;
    operationId = operationId.replace(/{\w+}$/g, "id");
    operationId = operationId.replace(/{\w+}/g, "");
    operationId = operationId.replace(/\W+/g, "_");
    operationId = operationId.replace(/_+/g, '_');
    operationId = operationId.replace(/_$/g, '');
    const summary = operation. description || operation.summary || `Call ${method.toUpperCase()} ${path}`;
    const parameters = operation.parameters || [];
    const shape = {
      required: [],
      properties: {}
    };

    if (parameters.length > 0) {
      shape.type = "object";
      for (const param of parameters) {
        if (!param.name || !param.in) continue;
        const paramSchema = param.schema || { type: "string" };
        shape.properties[param.name] = paramSchema;
        if (param.description)
          shape.properties[param.name].description = param.description;
        if (param.required)
          shape.required.push(param.name);
        if (param.in)
          shape.properties[param.name].in = param.in;
      }
    }

    if (
      operation.requestBody &&
      operation.requestBody.content &&
      operation.requestBody.content["application/json"] && 
      operation.requestBody.content["application/json"].schema
    ) {
        shape.type = "object";
        let requestBodySchema = operation.requestBody.content["application/json"].schema;
        if (requestBodySchema['$ref']) {
          const refPath = requestBodySchema['$ref'].replace('#/components/schemas/', '');
          const refSchema = swagger.components.schemas[refPath];
          requestBodySchema = refSchema || {};
        }
        shape.required.push(...(requestBodySchema.required || []));
        cleanupSchema(requestBodySchema.properties)
        shape.properties = {
          ...shape.properties,
          ...requestBodySchema.properties
        };
    }

    if (shape.required.length === 0)
      delete shape.required;

    if (Object.keys(shape.properties).length === 0)
      delete shape.properties;

    const inputSchema = shape;

    // 5. Build the tool
    const tool = {
      type: "function",
      function: {
        name: operationId,
        description: summary,
      },
      path: path,
      method: method.toUpperCase(),
    };
    if (Object.keys(inputSchema).length > 0)
      tool.function.parameters = inputSchema;

    tools.push(tool);
  }
}

async function callApi(tool_name, input) {
  let tool = tools.find(t => t.function.name === tool_name);
  if (!tool) {
    tool = authTools.find(t => t.function.name === tool_name);
    if (!tool) throw new Error(`Tool ${tool_name} not found`);
  }
  let { path, method, addSecret } = tool;
  const baseUrl = swagger.servers?.[0]?.url || process.env.CRM_URL;
  const queryParams = {};
  for (const key in input) {
    if (path.includes(`{${key}}`)) {
      path = path.replace(`{${key}}`, encodeURIComponent(input[key]));
      delete input[key]; // Remove the key from input as it's already used in the path
    }
    if (tool.function.parameters.properties[key] && tool.function.parameters.properties[key].in === 'query') {
      queryParams[key] = input[key];
      delete input[key]; // Remove the key from input as it's already used in the query
    }
  }
  const queryString = new URLSearchParams(queryParams).toString();

  let fullUrl = `${baseUrl}${path}`;
  if (queryString)
    fullUrl += `?${queryString}`;

  console.log(`${method} ${fullUrl}`);

  if (addSecret) input.secret = process.env.EMAIL_CODE_AUTH_SECRET;

  const body = Object.keys(input).length > 0 ? JSON.stringify(input, null, 2) : undefined;

  if (body) {
    console.log(`Body: ${body}`); // Log first 100 chars for brevity
  }

  const response = await fetch(fullUrl, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${crmToken}`
    },
    body
  });

  const data = await response.text();
  console.log(`Response: ${response.status} - ${data.substring(0, 50)}...`); // Log first 100 chars for brevity
  if (!response.ok) {
    return `Error: ${response.statusText} - ${data}`;
  }

  return data;
}

function setCRMToken(token) {
  crmToken = token;
}

const authTools = [
  {
    type: "function",
    function: {
      name: "initAuth",
      description: `
        Initiates the authentication for a given user.
        This function will find the user by email and, of found,
        will send a auth code to the users' email that they have to enter later on.
      `,
      parameters: {
        type: "object",
        required: ["email"],
        properties: {
          "email": {
            type: "string",
            description: "The user's email address, as provided by the user.",
          }
        },
        "type": "object"
      }
    },
    "path": "/auth/email-code/init",
    "method": "POST",
    "addSecret": true
  },
  {
    type: "function",
    function: {
      name: "authenticate",
      description: `
        Authenticates a given user.
        Receives the user's email and a auth code and returns a auth token.
      `,
      parameters: {
        type: "object",
        required: ["email", "code"],
        properties: {
          "email": {
            type: "string",
            description: "The user's email address, as provided by the user.",
          },
          "code": {
            type: "string",
            description: "The auth code, as provided back by the user."
          }
        }
      }
    },
    "path": "/auth/email-code/authenticate",
    "method": "POST",
    "addSecret": true
  }
]

export {tools, authTools, setCRMToken, callApi};