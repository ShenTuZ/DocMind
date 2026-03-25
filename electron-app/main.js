const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
require('dotenv').config();

let mainWindow;
let mcpClient = null;
let mcpTransport = null;
let tools = [];
let voiceProcess = null;
let cachedConfig = null;

const configPath = path.join(__dirname, 'config.json');
const knowledgePath = path.join(__dirname, 'knowledge.json');

const DEFAULT_CONFIG = {
  modelType: 'api',
  apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
  model: 'Qwen/Qwen3-VL-32B-Instruct',
  desktopPath: 'C:\\Users\\Administrator\\Desktop',
  downloadsPath: 'C:\\Users\\Administrator\\Downloads'
};

const PYTHON_COMMAND = process.platform === 'win32' ? 'D:\\anaconda3\\python.exe' : 'python3';

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
  if (cachedConfig) {
    return cachedConfig;
  }

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
      
      cachedConfig = {
        ...DEFAULT_CONFIG,
        apiKey: envVars.API_KEY || process.env.API_KEY,
        model: envVars.API_MODEL_NAME || DEFAULT_CONFIG.model,
        desktopPath: envVars.DESKTOP_PATH || DEFAULT_CONFIG.desktopPath,
        downloadsPath: envVars.DOWNLOADS_PATH || DEFAULT_CONFIG.downloadsPath
      };
      return cachedConfig;
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
  
  cachedConfig = {
    ...DEFAULT_CONFIG,
    apiKey: process.env.API_KEY
  };
  return cachedConfig;
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

function parseToolCallsFromReasoning(reasoningContent) {
  if (!reasoningContent) return null;
  
  const toolCallMatch = reasoningContent.match(/<tool_call>\s*(\{.*?\})\s*<\/tool_call>/s);
  if (!toolCallMatch) return null;
  
  try {
    const toolCallData = JSON.parse(toolCallMatch[1]);
    return {
      tool_calls: [
        {
          id: `call_${Date.now()}`,
          type: 'function',
          function: {
            name: toolCallData.name,
            arguments: JSON.stringify(toolCallData.arguments)
          }
        }
      ],
      content: reasoningContent.replace(/<tool_call>.*?<\/tool_call>/s, '').trim()
    };
  } catch (error) {
    console.error('解析工具调用失败:', error);
    return null;
  }
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

    console.log('API 请求配置:', {
      url: config.apiUrl,
      model: config.model,
      messagesCount: messages.length
    });

    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    console.log('API 响应状态:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API 响应错误:', errorText);
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('API 响应数据:', JSON.stringify(data, null, 2));
    
    if (!data.choices || data.choices.length === 0) {
      throw new Error('API 响应格式错误：没有返回choices');
    }
    
    const message = data.choices[0].message;
    
    if (!message.content && message.reasoning_content) {
      message.content = message.reasoning_content;
    }
    
    if (!message.tool_calls && message.reasoning_content) {
      const parsed = parseToolCallsFromReasoning(message.reasoning_content);
      if (parsed) {
        message.tool_calls = parsed.tool_calls;
        message.content = parsed.content;
        console.log('解析工具调用成功:', message.tool_calls);
      }
    }
    
    return message;
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
    cachedConfig = null;
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

function handleVoiceOutput(event, output) {
  const trimmedOutput = output.trim();
  console.log('语音识别输出:', trimmedOutput);
  
  if (trimmedOutput.startsWith('STARTED')) {
    event.sender.send('voice-status', { status: 'started' });
  } else if (trimmedOutput.startsWith('FINAL:')) {
    const text = trimmedOutput.substring(6);
    event.sender.send('voice-result', { text: text, isFinal: true });
  } else if (trimmedOutput.startsWith('RESULT:')) {
    const text = trimmedOutput.substring(7);
    event.sender.send('voice-result', { text: text, isFinal: false });
  } else if (trimmedOutput.startsWith('STOPPED')) {
    event.sender.send('voice-status', { status: 'stopped' });
  } else if (trimmedOutput.startsWith('ERROR:')) {
    const error = trimmedOutput.substring(6);
    event.sender.send('voice-error', { error: error });
  }
}

function handleVoiceError(event, errorText) {
  console.error('语音识别stderr:', errorText);
  if (errorText.includes('ERROR') || errorText.includes('error') || errorText.includes('Error')) {
    event.sender.send('voice-error', { error: errorText });
  }
}

ipcMain.handle('start-voice-recognition', async (event) => {
  try {
    if (voiceProcess) {
      return { success: false, error: '语音识别已在运行' };
    }

    const voiceScriptPath = path.join(__dirname, 'voice_recognition.py');
    
    voiceProcess = spawn(PYTHON_COMMAND, [voiceScriptPath], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    voiceProcess.stdout.on('data', (data) => {
      handleVoiceOutput(event, data.toString('utf8'));
    });

    voiceProcess.stderr.on('data', (data) => {
      handleVoiceError(event, data.toString('utf8'));
    });

    voiceProcess.on('close', (code) => {
      console.log('语音识别进程退出，代码:', code);
      voiceProcess = null;
      event.sender.send('voice-status', { status: 'stopped' });
    });

    voiceProcess.on('error', (error) => {
      console.error('语音识别进程错误:', error);
      voiceProcess = null;
      event.sender.send('voice-error', { error: error.message });
    });

    return { success: true };
  } catch (error) {
    console.error('启动语音识别失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-voice-recognition', async (event) => {
  try {
    if (voiceProcess) {
      voiceProcess.kill();
      voiceProcess = null;
      return { success: true };
    }
    return { success: false, error: '语音识别未运行' };
  } catch (error) {
    console.error('停止语音识别失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('send-message', async (event, userMessage, attachment = null) => {
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

    let systemPrompt = `你是一个智能助手，可以帮助用户操作文件系统。你有以下工具可以使用：

${tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

当用户需要操作文件时，必须使用工具调用。工具调用格式如下：
{
  "tool_calls": [
    {
      "id": "call_xxx",
      "type": "function",
      "function": {
        "name": "工具名称",
        "arguments": { "参数名": "参数值" }
      }
    }
  ]
}

重要提示：
- 当用户询问文件操作时，必须返回 tool_calls 字段
- tool_calls 必须是一个数组
- arguments 必须是 JSON 对象，不是字符串
- 如果不需要使用工具，直接在 content 字段中回答

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

    if (attachment) {
      if (attachment.type === 'image') {
        systemPrompt += `\n\n用户上传了一张图片：${attachment.name}，请分析图片内容。`;
      } else {
        systemPrompt += `\n\n用户上传了一个文件：${attachment.name}，请分析文件内容。`;
      }
    }

    const history = event.sender.history || [];
    
    let messages = [];
    
    messages.push({ role: 'system', content: systemPrompt });
    
    history.forEach(msg => {
      if (msg.role !== 'system') {
        messages.push({ role: msg.role, content: msg.content });
      }
    });
    
    let userContent = userMessage;
    if (attachment) {
      if (attachment.type === 'image') {
        messages.push({ 
          role: 'user', 
          content: [
            { type: 'text', text: userMessage || '请分析这张图片' },
            { type: 'image_url', image_url: { url: attachment.data } }
          ]
        });
      } else {
        messages.push({ 
          role: 'user', 
          content: [
            { type: 'text', text: userMessage || `请分析文件：${attachment.name}` },
            { type: 'text', text: `文件内容：${attachment.data}` }
          ]
        });
      }
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

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

        // 检查是否为doc、docx或pdf文件，如果是则使用自定义处理
        if (toolCall.function.name === 'read_text_file' && args.path && 
            (args.path.toLowerCase().endsWith('.doc') || 
             args.path.toLowerCase().endsWith('.docx') || 
             args.path.toLowerCase().endsWith('.pdf'))) {
          console.log(`检测到${args.path.toLowerCase().endsWith('.pdf') ? 'pdf' : 'doc'}文件，使用自定义处理`);
          try {
            const pythonScript = `
import sys
import os

# 设置标准输出编码为UTF-8
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

file_path = sys.argv[1]
file_ext = os.path.splitext(file_path)[1].lower()

try:
    if file_ext in ['.doc', '.docx']:
        from docx import Document
        doc = Document(file_path)
        text = []
        for paragraph in doc.paragraphs:
            text.append(paragraph.text)
        print('\\n'.join(text))
    elif file_ext == '.pdf':
        from PyPDF2 import PdfReader
        reader = PdfReader(file_path)
        text = []
        for page in reader.pages:
            text.append(page.extract_text())
        print('\\n'.join(text))
    else:
        print(f"[不支持的文件格式] {file_ext}")
except ImportError as e:
    if 'docx' in str(e):
        print(f"[导入错误] python-docx库未安装，无法解析Word文档")
    elif 'PyPDF2' in str(e):
        print(f"[导入错误] PyPDF2库未安装，无法解析PDF文档")
    else:
        print(f"[导入错误] {str(e)}")
except Exception as e:
    print(f"[解析错误] {str(e)}")
            `;
            
            const tempScriptPath = path.join(__dirname, 'temp_doc_reader.py');
            fs.writeFileSync(tempScriptPath, pythonScript);
            
            const { stdout: stdoutData, stderr: stderrData } = await new Promise((resolve) => {
              const process = spawn(PYTHON_COMMAND, [tempScriptPath, args.path], {
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'pipe']
              });
              
              let stdoutBuffer = '';
              let stderrBuffer = '';
              
              process.stdout.on('data', (data) => {
                stdoutBuffer += data.toString('utf8');
              });
              
              process.stderr.on('data', (data) => {
                stderrBuffer += data.toString('utf8');
              });
              
              process.on('close', () => {
                fs.unlinkSync(tempScriptPath);
                resolve({ stdout: stdoutBuffer, stderr: stderrBuffer });
              });
            });
            
            let result;
            if (stderrData) {
              console.error('doc文件解析错误:', stderrData);
              result = { isError: true, content: [{ type: 'text', text: `解析doc文件失败: ${stderrData}` }] };
            } else {
              result = { isError: false, content: [{ type: 'text', text: stdoutData }] };
            }
          } catch (e) {
            console.error('处理doc文件时出错:', e);
            result = { isError: true, content: [{ type: 'text', text: `处理doc文件失败: ${e.message}` }] };
          }
        } else {
          // 使用标准MCP工具调用
          result = await mcpClient.callTool({
            name: toolCall.function.name,
            arguments: args
          });
        }

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

ipcMain.handle('process-rag-files', async (event, filePaths) => {
  try {
    const ragScriptPath = path.join(__dirname, 'rag_processor.py');
    
    if (!fs.existsSync(ragScriptPath)) {
      throw new Error('RAG处理器文件不存在');
    }
    
    const args = [ragScriptPath, 'process_files', ...filePaths];
    
    return new Promise((resolve, reject) => {
      const process = spawn(PYTHON_COMMAND, args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString('utf8');
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve({ success: true, data: result });
          } catch (error) {
            resolve({ success: true, message: '处理完成' });
          }
        } else {
          console.error('RAG处理失败:', stderr);
          resolve({ success: false, error: stderr || '处理失败' });
        }
      });
      
      process.on('error', (error) => {
        console.error('启动RAG处理器失败:', error);
        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    console.error('处理RAG文件失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-knowledge-stats', async () => {
  try {
    const ragScriptPath = path.join(__dirname, 'rag_processor.py');
    
    if (!fs.existsSync(ragScriptPath)) {
      return { documentCount: 0, chunkCount: 0, vectorCount: 0 };
    }
    
    const args = [ragScriptPath, 'get_stats'];
    
    return new Promise((resolve, reject) => {
      const process = spawn(PYTHON_COMMAND, args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString('utf8');
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (error) {
            resolve({ documentCount: 0, chunkCount: 0, vectorCount: 0 });
          }
        } else {
          console.error('获取知识库统计失败:', stderr);
          resolve({ documentCount: 0, chunkCount: 0, vectorCount: 0 });
        }
      });
      
      process.on('error', (error) => {
        console.error('启动统计获取失败:', error);
        resolve({ documentCount: 0, chunkCount: 0, vectorCount: 0 });
      });
    });
  } catch (error) {
    console.error('获取知识库统计失败:', error);
    return { documentCount: 0, chunkCount: 0, vectorCount: 0 };
  }
});

ipcMain.handle('get-knowledge-files', async () => {
  try {
    const chunksPath = path.join(__dirname, 'rag_data', 'chunks.json');
    
    if (!fs.existsSync(chunksPath)) {
      return { success: true, files: [] };
    }
    
    const chunksData = fs.readFileSync(chunksPath, 'utf8');
    const files = JSON.parse(chunksData);
    
    return { success: true, files: files };
  } catch (error) {
    console.error('获取知识库文件列表失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-knowledge-file', async (event, filePath) => {
  try {
    const chunksPath = path.join(__dirname, 'rag_data', 'chunks.json');
    const chunksContentPath = path.join(__dirname, 'rag_data', 'chunks_content.json');
    const embeddingsPath = path.join(__dirname, 'rag_data', 'embeddings.json');
    
    if (!fs.existsSync(chunksPath)) {
      return { success: false, error: '知识库文件不存在' };
    }
    
    // 读取并过滤文件列表
    const chunksData = fs.readFileSync(chunksPath, 'utf8');
    const files = JSON.parse(chunksData);
    
    // 规范化路径格式以进行匹配
    const normalizedFilePath = path.normalize(filePath);
    
    // 查找要删除的文件（使用规范化路径进行匹配）
    const fileToDelete = files.find(f => {
      const normalizedStoredPath = path.normalize(f.path);
      return normalizedStoredPath === normalizedFilePath;
    });
    
    if (!fileToDelete) {
      console.log(`找不到要删除的文件: ${filePath}`);
      console.log(`现有文件: ${JSON.stringify(files, null, 2)}`);
      return { success: false, error: '文件不存在于知识库中' };
    }
    
    console.log(`删除文件: ${fileToDelete.name}, 路径: ${fileToDelete.path}`);
    
    // 删除文件信息
    const updatedFiles = files.filter(f => {
      const normalizedStoredPath = path.normalize(f.path);
      return normalizedStoredPath !== normalizedFilePath;
    });
    
    // 保存更新后的文件列表
    fs.writeFileSync(chunksPath, JSON.stringify(updatedFiles, null, 2), 'utf8');
    console.log(`更新后的文件列表长度: ${updatedFiles.length}`);
    
    // 如果有文本块内容文件，也需要更新
    if (fs.existsSync(chunksContentPath)) {
      const chunksContent = JSON.parse(fs.readFileSync(chunksContentPath, 'utf8'));
      const updatedChunks = chunksContent.filter(c => {
        const normalizedChunkPath = path.normalize(c.file_path);
        return normalizedChunkPath !== normalizedFilePath;
      });
      fs.writeFileSync(chunksContentPath, JSON.stringify(updatedChunks, null, 2), 'utf8');
      console.log(`更新后的文本块数量: ${updatedChunks.length}`);
    }
    
    // 如果有嵌入向量文件，也需要更新
    if (fs.existsSync(embeddingsPath)) {
      const embeddings = JSON.parse(fs.readFileSync(embeddingsPath, 'utf8'));
      const updatedEmbeddings = embeddings.filter(e => {
        const normalizedEmbeddingPath = path.normalize(e.file_path);
        return normalizedEmbeddingPath !== normalizedFilePath;
      });
      fs.writeFileSync(embeddingsPath, JSON.stringify(updatedEmbeddings, null, 2), 'utf8');
      console.log(`更新后的向量数量: ${updatedEmbeddings.length}`);
    }
    
    return { success: true };
  } catch (error) {
    console.error('删除知识库文件失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-knowledge', async (event, query, selectedFilePath = '') => {
  try {
    const ragScriptPath = path.join(__dirname, 'rag_processor.py');
    
    if (!fs.existsSync(ragScriptPath)) {
      return [];
    }
    
    const args = [ragScriptPath, 'query', '--query-text', query];
    
    // 如果选择了特定文件，添加文件路径参数
    if (selectedFilePath) {
      args.push('--file-path', selectedFilePath);
    }
    
    return new Promise((resolve, reject) => {
      const process = spawn(PYTHON_COMMAND, args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString('utf8');
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            if (result.success && result.results) {
              resolve(result.results);
            } else {
              resolve([]);
            }
          } catch (error) {
            console.error('解析搜索结果失败:', error);
            resolve([]);
          }
        } else {
          console.error('搜索知识库失败:', stderr);
          resolve([]);
        }
      });
      
      process.on('error', (error) => {
        console.error('搜索知识库失败:', error);
        resolve([]);
      });
    });
  } catch (error) {
    console.error('搜索知识库失败:', error);
    return [];
  }
});

ipcMain.handle('chat-with-knowledge', async (event, query, selectedFilePath = '') => {
  try {
    const config = loadConfigSync();
    
    // 先搜索知识库获取相关内容
    const ragScriptPath = path.join(__dirname, 'rag_processor.py');
    
    if (!fs.existsSync(ragScriptPath)) {
      return { success: false, error: 'RAG处理器文件不存在' };
    }
    
    const args = [ragScriptPath, 'query', '--query-text', query];
    
    // 如果选择了特定文件，添加文件路径参数
    if (selectedFilePath) {
      args.push('--file-path', selectedFilePath);
    }
    
    // 调用搜索
    const searchResult = await new Promise((resolve, reject) => {
      const process = spawn(PYTHON_COMMAND, args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString('utf8');
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });

      process.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (error) {
            console.error('解析搜索结果失败:', error);
            resolve({ success: false, error: '解析搜索结果失败' });
          }
        } else {
          console.error('搜索失败:', stderr);
          resolve({ success: false, error: stderr });
        }
      });
      
      process.on('error', (error) => {
        console.error('搜索知识库失败:', error);
        resolve({ success: false, error: error.message });
      });
    });
    
    if (!searchResult.success || searchResult.results.length === 0) {
      return { 
        success: true, 
        content: '未找到相关信息，请尝试其他关键词'
      };
    }
    
    // 构建上下文信息（限制长度）
    let context = '';
    let totalLength = 0;
    const maxContextLength = 2000; // 限制上下文最大长度
    
    for (let index = 0; index < searchResult.results.length; index++) {
      const result = searchResult.results[index];
      const segment = '文档片段 ' + (index + 1) + ':\n' + result.content + '\n\n';
      if (totalLength + segment.length <= maxContextLength) {
        context += segment;
        totalLength += segment.length;
      } else {
        // 如果超过长度限制，截断内容
        const remainingLength = maxContextLength - totalLength;
        context += segment.substring(0, remainingLength) + '...';
        break;
      }
    }
    
    // 构建系统提示（不使用markdown格式）
    const systemPrompt = '你是一个智能助手，根据提供的文档内容回答用户的问题。请基于以下文档内容进行回答：\n\n' + context + '\n\n重要提示：\n1. 只基于提供的文档内容回答问题\n2. 如果文档中没有相关信息，请明确说明\n3. 保持回答简洁明了\n4. 用中文回答\n5. 不要使用任何Markdown格式，只输出纯文本内容\n6. 不要使用标题、列表、加粗、斜体等格式标记';
    
    // 构建消息
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query }
    ];
    
    // 调用模型（流式输出）
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: messages,
        stream: true,
        max_tokens: 1000,
        temperature: 0.7
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API 响应错误:', errorText);
      return { success: false, error: `API 请求失败: ${response.status} - ${errorText}` };
    }
    
    // 处理流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullContent = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6);
          if (data === '[DONE]') continue;
          
          try {
            const json = JSON.parse(data);
            if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
              const content = json.choices[0].delta.content;
              fullContent += content;
              // 发送流式数据到渲染进程
              event.sender.send('knowledge-stream', { content });
            }
          } catch (e) {
            console.error('解析流式数据失败:', e);
          }
        }
      }
    }
    
    return { 
      success: true, 
      content: fullContent
    };
  } catch (error) {
    console.error('知识库对话失败:', error);
    return { success: false, error: error.message };
  }
});

// PageIndex 无向量RAG相关处理

ipcMain.handle('process-pageindex-files', async (event, filePaths) => {
  try {
    const runPageIndexPath = path.join(__dirname, 'run_pageindex.py');
    
    if (!fs.existsSync(runPageIndexPath)) {
      throw new Error('PageIndex处理器文件不存在');
    }
    
    // 处理每个文件
    const results = [];
    
    for (const filePath of filePaths) {
      const fileExt = path.extname(filePath).toLowerCase();
      let args;
      
      if (fileExt === '.pdf') {
        args = [runPageIndexPath, '--pdf_path', filePath];
      } else if (fileExt === '.md' || fileExt === '.markdown') {
        args = [runPageIndexPath, '--md_path', filePath];
      } else {
        results.push({
          file: filePath,
          success: false,
          error: '不支持的文件格式，仅支持 .pdf 和 .md 文件'
        });
        continue;
      }
      
      const result = await new Promise((resolve) => {
        const process = spawn(PYTHON_COMMAND, args, {
          cwd: __dirname,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        process.stdout.on('data', (data) => {
          stdout += data.toString('utf8');
        });
        
        process.stderr.on('data', (data) => {
          stderr += data.toString('utf8');
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            resolve({
              file: filePath,
              success: true,
              output: stdout
            });
          } else {
            console.error(`PageIndex处理失败 (${filePath}):`, stderr);
            resolve({
              file: filePath,
              success: false,
              error: stderr || '处理失败'
            });
          }
        });
        
        process.on('error', (error) => {
          console.error(`启动PageIndex处理器失败 (${filePath}):`, error);
          resolve({
            file: filePath,
            success: false,
            error: error.message
          });
        });
      });
      
      results.push(result);
    }
    
    return { success: true, results };
  } catch (error) {
    console.error('处理PageIndex文件失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-pageindex-files', async () => {
  try {
    const resultsDir = path.join(__dirname, 'results');
    
    if (!fs.existsSync(resultsDir)) {
      return { success: true, files: [] };
    }
    
    const files = [];
    const filesInDir = fs.readdirSync(resultsDir);
    
    filesInDir.forEach(file => {
      if (file.endsWith('_structure.json')) {
        const filePath = path.join(resultsDir, file);
        const stats = fs.statSync(filePath);
        files.push({
          name: file.replace('_structure.json', ''),
          path: filePath,
          size: stats.size,
          status: '已处理'
        });
      }
    });
    
    return { success: true, files };
  } catch (error) {
    console.error('获取PageIndex文件列表失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-pageindex-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    } else {
      return { success: false, error: '文件不存在' };
    }
  } catch (error) {
    console.error('删除PageIndex文件失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chat-with-pageindex', async (event, query, filePath) => {
  try {
    const vectorlessRagPath = path.join(__dirname, 'vectorless_rag.py');
    
    if (!fs.existsSync(vectorlessRagPath)) {
      return { success: false, error: 'Vectorless RAG文件不存在' };
    }
    
    const args = [vectorlessRagPath, 'query', filePath, '--query', query];
    
    return new Promise((resolve, reject) => {
      const process = spawn(PYTHON_COMMAND, args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString('utf8');
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, response: stdout.trim() });
        } else {
          console.error('PageIndex对话失败:', stderr);
          resolve({ success: false, error: stderr || '对话失败' });
        }
      });
      
      process.on('error', (error) => {
        console.error('启动Vectorless RAG失败:', error);
        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    console.error('PageIndex对话失败:', error);
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
  if (voiceProcess) {
    voiceProcess.kill();
  }
});