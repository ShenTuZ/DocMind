const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
require('dotenv').config();

let mainWindow;
let mcpClient = null;
let mcpTransport = null;
let tools = [];

const configPath = path.join(__dirname, 'config.json');
const knowledgePath = path.join(__dirname, 'knowledge.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    frame: true,
    backgroundColor: '#f5f7fa',
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function connectMCP() {
  try {
    const config = loadConfigSync();
    
    mcpTransport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 
             config.desktopPath || 'C:\\Users\\Administrator\\Desktop',
             config.downloadsPath || 'C:\\Users\\Administrator\\Downloads']
    });

    mcpClient = new Client({
      name: 'mcp-agent-electron',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await mcpClient.connect(mcpTransport);
    
    const toolsResult = await mcpClient.listTools();
    tools = toolsResult.tools;
    
    return { success: true, tools: tools };
  } catch (error) {
    console.error('MCP 连接失败:', error);
    return { success: false, error: error.message };
  }
}

function loadConfigSync() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const data = fs.readFileSync(envPath, 'utf8');
      const envVars = {};
      
      data.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          envVars[key.trim()] = valueParts.join('=').trim();
        }
      });
      
      return {
        modelType: 'api',
        apiKey: envVars.API_KEY || 'sk-wzinqxnzpnngnwuxmlumohzwlxlofdncobyuwzjytofokewn',
        apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
        model: envVars.API_MODEL_NAME || 'Qwen/Qwen3.5-35B-A3B',
        desktopPath: envVars.DESKTOP_PATH || 'C:\\Users\\Administrator\\Desktop',
        downloadsPath: envVars.DOWNLOADS_PATH || 'C:\\Users\\Administrator\\Downloads'
      };
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
  
  return {
    modelType: 'api',
    apiKey: 'sk-wzinqxnzpnngnwuxmlumohzwlxlofdncobyuwzjytofokewn',
    apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'Qwen/Qwen3.5-35B-A3B',
    desktopPath: 'C:\\Users\\Administrator\\Desktop',
    downloadsPath: 'C:\\Users\\Administrator\\Downloads'
  };
}

function loadKnowledgeSync() {
  try {
    if (fs.existsSync(knowledgePath)) {
      const data = fs.readFileSync(knowledgePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('加载知识库失败:', error);
  }
  return [];
}

function getToolDefinitions() {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

async function callSiliconFlowAPI(config, messages, tools) {
  try {
    const requestBody = {
      model: config.model,
      messages: messages,
      stream: false,
      max_tokens: 4096,
      temperature: 0.7
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    console.log('发送请求体:', JSON.stringify(requestBody, null, 2));

    const apiKey = process.env.API_KEY || 'sk-wzinqxnzpnngnwuxmlumohzwlxlofdncobyuwzjytofokewn';
    const apiUrl = 'https://api.siliconflow.cn/v1/chat/completions';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API 响应错误:', errorText);
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message;
  } catch (error) {
    console.error('❌ SiliconFlow API 调用失败:', error.message);
    throw error;
  }
}

ipcMain.handle('load-config', async () => {
  return loadConfigSync();
});

ipcMain.handle('save-config', async (event, config) => {
  try {
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    if (config.model) {
      envContent += `API_MODEL_NAME=${config.model}\n`;
    }
    if (config.desktopPath) {
      envContent += `DESKTOP_PATH=${config.desktopPath}\n`;
    }
    if (config.downloadsPath) {
      envContent += `DOWNLOADS_PATH=${config.downloadsPath}\n`;
    }
    
    fs.writeFileSync(envPath, envContent, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-knowledge', async () => {
  return loadKnowledgeSync();
});

ipcMain.handle('save-knowledge', async (event, data) => {
  try {
    fs.writeFileSync(knowledgePath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-history', async (event) => {
  return { success: true };
});

ipcMain.handle('send-message', async (event, userMessage) => {
  try {
    const config = loadConfigSync();
    const knowledge = loadKnowledgeSync();
    
    if (!mcpClient) {
      const connectResult = await connectMCP();
      if (!connectResult.success) {
        throw new Error('MCP 连接失败');
      }
    }

    const toolDefinitions = getToolDefinitions();

    const knowledgeText = knowledge.length > 0 
      ? `\n\n知识库信息：\n${knowledge.map(k => `- ${k.title}: ${k.content}`).join('\n')}` 
      : '';

    const systemPrompt = `你是一个智能助手，可以帮助用户操作文件系统。你有以下工具可以使用：

${tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

当用户需要操作文件时，请使用相应的工具。工具调用格式如下：
{
  "tool_calls": [
    {
      "id": "call_xxx",
      "type": "function",
      "function": {
        "name": "工具名称",
        "arguments": "JSON 格式的参数字符串"
      }
    }
  ]
}

如果不需要使用工具，直接回答用户即可。
注意：
1. 只能访问 ${config.desktopPath} 和 ${config.downloadsPath} 目录
2. 文件路径必须是完整路径
3. 使用 list_directory 列出目录内容
4. 使用 read_text_file 读取文件内容
5. 使用 write_file 写入文件
6. 使用 search_files 搜索文件
7. 使用 get_file_info 获取文件信息
${knowledgeText}

请用中文回答用户的问题。`;

    const history = event.sender.history || [];
    
    let messages = [];
    
    messages.push({ role: 'system', content: systemPrompt });
    
    history.forEach(msg => {
      if (msg.role !== 'system') {
        messages.push({ role: msg.role, content: msg.content });
      }
    });
    
    messages.push({ role: 'user', content: userMessage });

    let maxIterations = 5;
    let iteration = 0;
    const toolCalls = [];
    
    while (iteration < maxIterations) {
      iteration++;

      const assistantMessage = await callSiliconFlowAPI(config, messages, toolDefinitions);
      messages.push(assistantMessage);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const history = event.sender.history || [];
        
        history.push({ role: 'user', content: userMessage });
        history.push({ role: 'assistant', content: assistantMessage.content });
        
        event.sender.history = history;
        
        return { 
          success: true, 
          content: assistantMessage.content,
          toolCalls: toolCalls
        };
      }

      for (const toolCall of assistantMessage.tool_calls) {
        let args;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          args = toolCall.function.arguments;
        }
        
        const toolCallInfo = {
          name: toolCall.function.name,
          args: args,
          timestamp: new Date().toISOString()
        };
        toolCalls.push(toolCallInfo);

        const result = await mcpClient.callTool({
          name: toolCall.function.name,
          arguments: args
        });

        const toolMessage = {
          role: 'tool',
          content: JSON.stringify(result.isError ? { error: result.content[0].text } : { content: result.content[0].text }),
          tool_call_id: toolCall.id
        };
        messages.push(toolMessage);
      }
    }

    return { 
      success: true, 
      content: '达到最大迭代次数，请重新提问。',
      toolCalls: toolCalls
    };
  } catch (error) {
    console.error('处理消息失败:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (mcpClient) {
    await mcpClient.close();
  }
});