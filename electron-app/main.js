const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const mysql = require('mysql2/promise');
require('dotenv').config();

let mainWindow;
let mcpClient = null;
let mcpTransport = null;
let tools = [];
let voiceProcess = null;
let cachedConfig = null;
let dbConnection = null;

const configPath = path.join(__dirname, 'config.json');
const knowledgePath = path.join(__dirname, 'knowledge.json');

const DEFAULT_CONFIG = {
  modelType: 'api',
  apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
  apiKey: '',
  model: 'Qwen/Qwen3-VL-32B-Instruct',
  ollamaModel: 'qwen3.5:4b',
  desktopPath: '',
  downloadsPath: '',
  pythonPath: ''
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: true,
      enableRemoteModule: true
    },
    frame: true,
    backgroundColor: '#f5f7fa',
    show: false,
    resizable: false
  });

  // 先加载登录界面
  mainWindow.loadFile('login.html');

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
    
    // 使用用户主目录作为默认路径
    const userHome = process.env.USERPROFILE || process.env.HOME || '';
    const defaultDesktop = userHome ? `${userHome}\\Desktop` : '';
    const defaultDownloads = userHome ? `${userHome}\\Downloads` : '';
    
    mcpTransport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 
             config.desktopPath || defaultDesktop,
             config.downloadsPath || defaultDownloads]
    });

    mcpClient = new Client({
      name: 'mcp-agent-electron',
      version: '1.0.0'
    }, {
      capabilities: {
        roots: {
          listChanged: true
        }
      }
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
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const configData = JSON.parse(data);
      
      cachedConfig = {
        ...DEFAULT_CONFIG,
        ...configData
      };
      return cachedConfig;
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
  
  cachedConfig = {
    ...DEFAULT_CONFIG
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

// 数据库连接函数
async function getDbConnection() {
  try {
    if (!dbConnection) {
      const dbPassword = process.env.DB_PASSWORD;
      if (!dbPassword) {
        throw new Error('数据库密码未设置，请在.env文件中配置DB_PASSWORD');
      }
      
      dbConnection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: dbPassword,
        database: process.env.DB_NAME || 'docmind'
      });
      console.log('数据库连接成功');
    }
    return dbConnection;
  } catch (error) {
    console.error('数据库连接失败:', error);
    throw error;
  }
}

/**
 * 智能检测可用的 Python 命令
 * @returns {Promise<string>} 可用的 Python 命令路径
 */
async function findPythonCommand() {
  const { spawn } = require('child_process');
  
  // 常见的 Python 命令候选列表
  const candidates = process.platform === 'win32' 
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];
  
  // 尝试常见的 Anaconda/Miniconda 安装路径
  if (process.platform === 'win32') {
    const commonPaths = [
      'C:\\anaconda3\\python.exe',
      'C:\\miniconda3\\python.exe',
      'D:\\anaconda3\\python.exe',
      'D:\\miniconda3\\python.exe',
      path.join(process.env.USERPROFILE || '', 'anaconda3', 'python.exe'),
      path.join(process.env.USERPROFILE || '', 'miniconda3', 'python.exe'),
    ];
    candidates.unshift(...commonPaths);
  }
  
  // 依次尝试每个候选命令
  for (const candidate of candidates) {
    try {
      const result = await new Promise((resolve) => {
        const proc = spawn(candidate, ['--version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);
        
        proc.on('close', (code) => {
          resolve({ code, stdout, stderr });
        });
        
        proc.on('error', () => {
          resolve({ code: -1, stdout: '', stderr: '' });
        });
      });
      
      // 检查是否成功执行并输出版本信息
      if (result.code === 0 && (result.stdout || result.stderr)) {
        const version = (result.stdout || result.stderr).trim();
        console.log(`找到可用的 Python: ${candidate} (${version})`);
        return candidate;
      }
    } catch (error) {
      // 继续尝试下一个候选
      continue;
    }
  }
  
  throw new Error('未找到可用的 Python 环境');
}

/**
 * 获取 Python 命令
 * 优先使用配置，配置不存在时自动检测
 * @returns {Promise<string>} Python 命令路径
 */
async function getPythonCommand() {
  const config = loadConfigSync();
  
  // 如果配置中有 pythonPath 且不为空，直接使用
  if (config.pythonPath && config.pythonPath.trim()) {
    console.log(`使用配置的 Python 路径: ${config.pythonPath}`);
    return config.pythonPath;
  }
  
  // 否则自动检测
  console.log('配置中未指定 Python 路径，开始自动检测...');
  const pythonCommand = await findPythonCommand();
  
  // 将检测到的路径保存到配置中
  try {
    const updatedConfig = {
      ...config,
      pythonPath: pythonCommand
    };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
    cachedConfig = updatedConfig;
    console.log(`已将检测到的 Python 路径保存到配置: ${pythonCommand}`);
  } catch (error) {
    console.error('保存 Python 路径到配置失败:', error);
  }
  
  return pythonCommand;
}

/**
 * 验证 Python 命令是否可用
 * @param {string} pythonCommand - Python 命令路径
 * @returns {Promise<{valid: boolean, version: string, error?: string}>}
 */
async function validatePythonCommand(pythonCommand) {
  try {
    const result = await new Promise((resolve) => {
      const proc = spawn(pythonCommand, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => stdout += data);
      proc.stderr.on('data', (data) => stderr += data);
      
      proc.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
      
      proc.on('error', (error) => {
        resolve({ code: -1, stdout: '', stderr: error.message });
      });
    });
    
    if (result.code === 0) {
      const version = (result.stdout || result.stderr).trim();
      return { valid: true, version };
    } else {
      return { 
        valid: false, 
        version: '', 
        error: `Python 命令执行失败，退出码: ${result.code}` 
      };
    }
  } catch (error) {
    return { 
      valid: false, 
      version: '', 
      error: error.message 
    };
  }
}

/**
 * 创建 Python 进程的统一函数
 * @param {string[]} args - Python 脚本参数
 * @param {Object} options - spawn 选项
 * @returns {Promise<import('child_process').ChildProcess>}
 */
async function spawnPythonProcess(args, options = {}) {
  const pythonCommand = await getPythonCommand();
  
  // 验证 Python 命令是否可用
  const validation = await validatePythonCommand(pythonCommand);
  if (!validation.valid) {
    throw new Error(
      `Python 环境不可用: ${validation.error}\n` +
      `请检查配置文件中的 pythonPath 字段，或确保 Python 已正确安装并添加到系统 PATH`
    );
  }
  
  return spawn(pythonCommand, args, options);
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

/**
 * 处理模型输出中的路径信息，保护用户隐私
 * @param {string} content - 模型输出内容
 * @returns {string} 处理后的内容
 */
function processModelOutput(content) {
  if (!content) return content;
  
  const config = loadConfigSync();
  
  // 替换桌面路径
  if (config.desktopPath) {
    const desktopPathRegex = new RegExp(config.desktopPath.replace(/[\\/]/g, '[\\/\\/]'), 'gi');
    content = content.replace(desktopPathRegex, '桌面');
  }
  
  // 替换下载路径
  if (config.downloadsPath) {
    const downloadsPathRegex = new RegExp(config.downloadsPath.replace(/[\\/]/g, '[\\/\\/]'), 'gi');
    content = content.replace(downloadsPathRegex, '下载');
  }
  
  // 替换常见的Windows路径格式
  content = content.replace(/C:[\\/\\/]Users[\\/\\/][^\\/\\/]+[\\/\\/]Desktop/gi, '桌面');
  content = content.replace(/C:[\\/\\/]Users[\\/\\/][^\\/\\/]+[\\/\\/]Downloads/gi, '下载');
  
  return content;
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

    // 使用环境变量或配置中的API密钥
    const apiKey = process.env.SILICONFLOW_API_KEY || config.apiKey;
    
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
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
    // 读取现有配置
    let existingConfig = {};
    if (fs.existsSync(configPath)) {
      const existingData = fs.readFileSync(configPath, 'utf8');
      existingConfig = JSON.parse(existingData);
    }
    
    // 合并新配置
    const updatedConfig = {
      ...DEFAULT_CONFIG,
      ...existingConfig,
      ...config
    };
    
    // 写入配置文件
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
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
    
    // 检查脚本是否存在
    if (!fs.existsSync(voiceScriptPath)) {
      return { 
        success: false, 
        error: `语音识别脚本不存在: ${voiceScriptPath}` 
      };
    }
    
    // 使用统一的 Python 进程创建函数
    voiceProcess = await spawnPythonProcess([voiceScriptPath], {
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
      
      // 提供更友好的错误提示
      let errorMessage = error.message;
      if (error.code === 'ENOENT') {
        errorMessage = `找不到 Python 命令，请检查配置文件中的 pythonPath 字段`;
      }
      
      event.sender.send('voice-error', { error: errorMessage });
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

    let systemPrompt = `你是一个智能桌面文件助手，可以帮助用户操作桌面文件系统，包括读取、编辑和创建文档。你有以下工具可以使用：

${tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

文件编辑功能说明：
- 你可以帮助用户编辑.docx、.pdf、.pptx等文档文件
- 支持的编辑操作包括：添加内容、修改文本、删除内容、调整格式等
- 对于图片和文档，你可以分析内容并提供编辑建议
- 编辑前请先读取文件内容，然后基于内容提供编辑方案

当用户需要桌面操作文件时，选择适合的工具进行调用。工具调用格式如下：
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
- 当用户询问桌面文件操作时，必须返回 tool_calls 字段
- tool_calls 必须是一个数组
- arguments 必须是 JSON 对象，不是字符串
- 如果不需要使用工具，直接在 content 字段中回答

注意：
1. 只能访问 ${config.desktopPath} 和 ${config.downloadsPath} 目录
2. 文件路径必须是完整路径
3. 使用 list_directory 列出目录相关内容
4. 使用 list_directory_with_sizes 列出目录内容（包含大小）
5. 使用 directory_tree 生成目录树结构
6. 使用 read_text_file 读取文本文件的全部内容
7. 使用 read_file 读取文件内容
8. 使用 read_media_file 读取图像/音频文件
9. 使用 read_multiple_files 批量读取多个文件
10. 使用 write_file 写入文件
11. 使用 edit_file 高级编辑文件（支持精准替换）
12. 使用 create_directory 创建目录
13. 使用 move_file 移动/重命名文件
14. 使用 search_files 搜索文件
15. 使用 get_file_info 获取文件信息
16. 使用 list_allowed_directories 查看授权目录

特别重要：
- 对于.docx、.pdf、.xls/.xlsx 和 .ppt/.pptx 文件，必须使用 read_text_file 或 read_file 工具来读取和分析它们的内容
- 绝对不要使用 read_media_file 工具来读取这些文档文件
- 不要尝试直接分析这些文件的二进制内容，使用工具获取文本内容后再进行分析
- 工具会自动处理这些文件的解析，返回可读的文本内容
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
        // 对于图片附件，使用多模态格式，包含文本和图片数据
        const imageContent = userMessage || '请分析这张图片';
        messages.push({ 
          role: 'user', 
          content: [
            {
              type: 'text',
              text: imageContent
            },
            {
              type: 'image_url',
              image_url: {
                url: attachment.data
              }
            }
          ]
        });
      } else {
        // 对于其他文件附件，使用文本格式，包含文件内容
        const fileContent = `${userMessage || `请分析文件：${attachment.name}`}\n\n文件内容：${attachment.data}`;
        messages.push({ 
          role: 'user', 
          content: fileContent
        });
      }
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    let maxIterations = 8;
    let iteration = 0;
    const toolCalls = [];
    
    while (iteration < maxIterations) {
      iteration++;

      const assistantMessage = await callSiliconFlowAPI(config, messages, toolDefinitions);
      messages.push(assistantMessage);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const history = event.sender.history || [];
        
        const processedContent = processModelOutput(assistantMessage.content);
        
        history.push({ role: 'user', content: userMessage });
        history.push({ role: 'assistant', content: processedContent });
        
        event.sender.history = history;
        
        return { 
          success: true, 
          content: processedContent,
          toolCalls: toolCalls
        };
      }

      for (const toolCall of assistantMessage.tool_calls) {
        let args;
        let filePath = null;
        try {
          args = JSON.parse(toolCall.function.arguments);
          filePath = args.path;
        } catch (e) {
          args = toolCall.function.arguments;
          // 尝试从字符串中提取文件路径
          if (typeof args === 'string') {
            try {
              const parsed = JSON.parse(args);
              filePath = parsed.path;
              // 更新args为解析后的对象
              args = parsed;
            } catch (e2) {
              // 无法解析，使用原始字符串
            }
          }
        }
        console.log('工具调用参数:', args);
        console.log('提取的文件路径:', filePath);
        
        const toolCallInfo = {
          name: toolCall.function.name,
          args: args,
          timestamp: new Date().toISOString()
        };
        toolCalls.push(toolCallInfo);

        // 检查是否为doc、docx或pdf文件，如果是则使用自定义处理
        console.log('工具名称:', toolCall.function.name);
        console.log('文件路径:', filePath);
        console.log('文件扩展名检查:', filePath ? filePath.toLowerCase().endsWith('.doc') || filePath.toLowerCase().endsWith('.docx') || filePath.toLowerCase().endsWith('.pdf') : '无文件路径');
        
        let result;
        if ((toolCall.function.name === 'read_text_file' || toolCall.function.name === 'read_file' || toolCall.function.name === 'read_media_file') && filePath && 
            (filePath.toLowerCase().endsWith('.doc') || 
             filePath.toLowerCase().endsWith('.docx') || 
             filePath.toLowerCase().endsWith('.pdf') ||
             filePath.toLowerCase().endsWith('.xls') ||
             filePath.toLowerCase().endsWith('.xlsx') ||
             filePath.toLowerCase().endsWith('.ppt') ||
             filePath.toLowerCase().endsWith('.pptx'))) {
          console.log(`检测到${filePath.toLowerCase().endsWith('.pdf') ? 'pdf' : filePath.toLowerCase().endsWith('.xls') || filePath.toLowerCase().endsWith('.xlsx') ? 'excel' : filePath.toLowerCase().endsWith('.ppt') || filePath.toLowerCase().endsWith('.pptx') ? 'ppt' : 'doc'}文件，使用自定义处理`);
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
    if file_ext == '.docx':
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
    elif file_ext in ['.xls', '.xlsx']:
        import pandas as pd
        try:
            # 读取Excel文件
            excel_file = pd.ExcelFile(file_path)
            result = []
            
            # 获取所有sheet名称
            sheets = excel_file.sheet_names
            result.append(f"Excel文件包含 {len(sheets)} 个工作表: {', '.join(sheets)}")
            
            # 遍历每个sheet
            for sheet_name in sheets:
                result.append(f"\\n=== 工作表: {sheet_name} ===")
                # 读取sheet数据
                df = pd.read_excel(file_path, sheet_name=sheet_name)
                # 转换为文本格式
                result.append(df.to_string())
            
            print('\\n'.join(result))
        except Exception as e:
            print(f"[解析错误] 读取Excel文件失败: {str(e)}")
    elif file_ext in ['.ppt', '.pptx']:
        from pptx import Presentation
        try:
            # 读取PPT文件
            prs = Presentation(file_path)
            result = []
            
            # 获取幻灯片数量
            result.append(f"PPT文件包含 {len(prs.slides)} 张幻灯片")
            
            # 遍历每张幻灯片
            for i, slide in enumerate(prs.slides, 1):
                result.append(f"\\n=== 幻灯片 {i} ===")
                
                # 提取幻灯片中的所有文本
                text_runs = []
                for shape in slide.shapes:
                    if hasattr(shape, 'text'):
                        text_runs.append(shape.text)
                
                if text_runs:
                    result.append('\\n'.join(text_runs))
                else:
                    result.append("[无文本内容]")
            
            print('\\n'.join(result))
        except Exception as e:
            print(f"[解析错误] 读取PPT文件失败: {str(e)}")
    else:
        print(f"[不支持的文件格式] {file_ext}")
except ImportError as e:
    if 'docx' in str(e):
        print(f"[导入错误] python-docx库未安装，无法解析Word文档")
    elif 'PyPDF2' in str(e):
        print(f"[导入错误] PyPDF2库未安装，无法解析PDF文档")
    elif 'pandas' in str(e):
        print(f"[导入错误] pandas库未安装，无法解析Excel文档")
    elif 'pptx' in str(e):
        print(f"[导入错误] python-pptx库未安装，无法解析PPT文档")
    else:
        print(f"[导入错误] {str(e)}")
except Exception as e:
    print(f"[解析错误] {str(e)}")
            `;
            
            const tempScriptPath = path.join(__dirname, 'temp_doc_reader.py');
            fs.writeFileSync(tempScriptPath, pythonScript);
            
            const { stdout: stdoutData, stderr: stderrData } = await new Promise((resolve, reject) => {
              spawnPythonProcess([tempScriptPath, filePath], {
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'pipe']
              }).then((process) => {
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
                
                process.on('error', (error) => {
                  fs.unlinkSync(tempScriptPath);
                  reject(error);
                });
              }).catch(reject);
            });
            
            if (stderrData) {
              console.error('doc文件解析错误:', stderrData);
              result = { isError: true, content: `解析doc文件失败: ${stderrData}` };
            } else {
              result = { isError: false, content: stdoutData };
            }
          } catch (e) {
            console.error('处理doc文件时出错:', e);
            result = { isError: true, content: `处理doc文件失败: ${e.message}` };
          }
        } else {
          // 使用标准MCP工具调用
          // 确保arguments是一个对象
          let callArgs = args;
          if (typeof callArgs === 'string') {
            try {
              callArgs = JSON.parse(callArgs);
              console.log('解析后的工具参数:', callArgs);
            } catch (e) {
              console.error('无法解析工具参数:', e);
            }
          }
          // 添加超时处理，避免长时间等待
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('工具调用超时')), 30000); // 30秒超时
          });
          
          try {
            result = await Promise.race([
              mcpClient.callTool({
                name: toolCall.function.name,
                arguments: callArgs
              }),
              timeoutPromise
            ]);
          } catch (error) {
            console.error('工具调用超时或失败:', error);
            result = { isError: true, content: `工具调用超时: ${error.message}` };
          }
        }

        // 处理MCP工具返回值
        console.log('工具调用结果:', result);
        let toolContent;
        if (result.isError) {
          // 处理错误情况
          console.log('工具调用错误:', result.content);
          if (result.content) {
            if (typeof result.content === 'string') {
              toolContent = result.content;
            } else if (Array.isArray(result.content) && result.content.length > 0) {
              if (result.content[0].text) {
                toolContent = result.content[0].text;
              } else {
                toolContent = JSON.stringify(result.content);
              }
            } else {
              toolContent = JSON.stringify(result.content);
            }
          } else {
            toolContent = '工具执行失败';
          }
        } else {
          // 处理成功情况
          console.log('工具调用成功，内容:', result.content);
          if (result.content) {
            if (typeof result.content === 'string') {
              toolContent = result.content;
            } else if (Array.isArray(result.content) && result.content.length > 0) {
              if (result.content[0].text) {
                toolContent = result.content[0].text;
              } else if (result.content[0].type === 'text' && result.content[0].text) {
                toolContent = result.content[0].text;
              } else {
                // 对于非文本内容，转换为字符串
                toolContent = JSON.stringify(result.content);
              }
            } else {
              toolContent = JSON.stringify(result.content);
            }
          } else if (result.structuredContent) {
            // 处理结构化内容
            toolContent = JSON.stringify(result.structuredContent);
          } else {
            // 处理其他情况
            toolContent = '工具执行成功';
          }
        }
        console.log('最终工具内容:', toolContent);

        const toolMessage = {
          role: 'tool',
          content: toolContent,
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
      spawnPythonProcess(args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      }).then((process) => {
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
      }).catch((error) => {
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
      spawnPythonProcess(args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      }).then((process) => {
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
      }).catch((error) => {
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
      spawnPythonProcess(args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      }).then((process) => {
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
      }).catch((error) => {
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
      spawnPythonProcess(args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      }).then((process) => {
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
      }).catch((error) => {
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
    
    const processedContent = processModelOutput(fullContent);
    
    return { 
      success: true, 
      content: processedContent
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
        spawnPythonProcess(args, {
          cwd: __dirname,
          stdio: ['pipe', 'pipe', 'pipe']
        }).then((process) => {
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
        }).catch((error) => {
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
      spawnPythonProcess(args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      }).then((process) => {
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
            const processedResponse = processModelOutput(stdout.trim());
            resolve({ success: true, response: processedResponse });
          } else {
            console.error('PageIndex对话失败:', stderr);
            resolve({ success: false, error: stderr || '对话失败' });
          }
        });
        
        process.on('error', (error) => {
          console.error('启动Vectorless RAG失败:', error);
          resolve({ success: false, error: error.message });
        });
      }).catch((error) => {
        console.error('启动Vectorless RAG失败:', error);
        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    console.error('PageIndex对话失败:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(async () => {
  createWindow();
  
  // 初始化 Python 环境
  try {
    console.log('正在初始化 Python 环境...');
    const pythonCommand = await getPythonCommand();
    const validation = await validatePythonCommand(pythonCommand);
    
    if (!validation.valid) {
      console.error('Python 环境验证失败:', validation.error);
      // 可以在这里通知用户配置 Python 路径
    } else {
      console.log('Python 环境初始化成功:', validation.version);
    }
  } catch (error) {
    console.error('Python 环境初始化失败:', error.message);
    // 可以在这里通知用户配置 Python 路径
  }
  
  // 监听登录成功事件
  ipcMain.on('login-success', (event, data) => {
    console.log('登录成功:', data.username);
    
    // 调整窗口大小为应用主界面大小
    mainWindow.setSize(1400, 900);
    mainWindow.setMinimumSize(1000, 700);
    mainWindow.setResizable(true);
    
    // 加载主应用界面
    mainWindow.loadFile('index.html');
  });
  
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

ipcMain.handle('get-ollama-models', async () => {
  try {
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
      const ollamaProcess = spawn('ollama', ['list'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000
      });
      
      let stdout = '';
      let stderr = '';
      
      ollamaProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ollamaProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ollamaProcess.on('close', (code) => {
        if (code === 0 && stdout) {
          try {
            const lines = stdout.trim().split('\n');
            const models = [];
            
            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line) {
                const parts = line.split(/\s+/);
                if (parts.length > 0) {
                  models.push(parts[0]);
                }
              }
            }
            
            resolve({ success: true, models: models });
          } catch (error) {
            resolve({ success: false, error: '解析模型列表失败' });
          }
        } else {
          resolve({ success: false, error: 'Ollama未运行或未安装' });
        }
      });
      
      ollamaProcess.on('error', () => {
        resolve({ success: false, error: 'Ollama未运行或未安装' });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.on('before-quit', async () => {
  if (mcpClient) {
    await mcpClient.close();
  }
  if (voiceProcess) {
    voiceProcess.kill();
  }
  if (dbConnection) {
    await dbConnection.end();
  }
});

// 日常文件管理相关IPC处理

ipcMain.handle('upload-daily-files', async (event, filePaths) => {
  try {
    const connection = await getDbConnection();
    
    // 创建存储日常文件的目录
    const dailyFilesDir = path.join(__dirname, 'daily_files');
    if (!fs.existsSync(dailyFilesDir)) {
      fs.mkdirSync(dailyFilesDir, { recursive: true });
    }
    
    for (const filePath of filePaths) {
      const stats = fs.statSync(filePath);
      const filename = path.basename(filePath);
      const fileType = path.extname(filePath).toLowerCase();
      const fileSize = stats.size;
      
      // 生成唯一的文件名，避免重复
      const uniqueFilename = `${Date.now()}_${filename}`;
      const destPath = path.join(dailyFilesDir, uniqueFilename);
      
      // 复制文件到本地目录
      fs.copyFileSync(filePath, destPath);
      
      await connection.execute(
        'INSERT INTO daily_files (filename, file_path, file_type, file_size) VALUES (?, ?, ?, ?)',
        [filename, destPath, fileType, fileSize]
      );
    }
    
    return { success: true };
  } catch (error) {
    console.error('上传日常文件失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-daily-files', async () => {
  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute('SELECT * FROM daily_files ORDER BY upload_date DESC');
    return { success: true, files: rows };
  } catch (error) {
    console.error('获取日常文件列表失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-daily-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      await shell.openPath(filePath);
      return { success: true };
    } else {
      return { success: false, error: '文件不存在' };
    }
  } catch (error) {
    console.error('打开日常文件失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-daily-file', async (event, fileId) => {
  try {
    const connection = await getDbConnection();
    
    // 先获取文件路径
    const [rows] = await connection.execute('SELECT file_path FROM daily_files WHERE id = ?', [fileId]);
    if (rows.length > 0) {
      const filePath = rows[0].file_path;
      
      // 删除本地文件
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    // 删除数据库记录
    await connection.execute('DELETE FROM daily_files WHERE id = ?', [fileId]);
    return { success: true };
  } catch (error) {
    console.error('删除日常文件失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-daily-file', async (event, filePath, filename) => {
  try {
    const { dialog } = require('electron');
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    
    const { filePath: savePath } = await dialog.showSaveDialog({
      defaultPath: filename,
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (savePath) {
      fs.copyFileSync(filePath, savePath);
      return { success: true };
    } else {
      return { success: false, error: '取消下载' };
    }
  } catch (error) {
    console.error('下载日常文件失败:', error);
    return { success: false, error: error.message };
  }
});