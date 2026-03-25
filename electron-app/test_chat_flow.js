const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const fs = require('fs');
const path = require('path');

// 加载配置
function loadConfig() {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    }
    return {
        modelType: 'api',
        apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
        apiKey: '',
        model: 'Qwen/Qwen3-VL-32B-Instruct',
        desktopPath: 'C:\\Users\\Administrator\\Desktop',
        downloadsPath: 'C:\\Users\\Administrator\\Downloads'
    };
}

const config = loadConfig();

// 调用 SiliconFlow API
async function callSiliconFlowAPI(messages, tools = []) {
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

        console.log(`调用 API: ${config.apiUrl}`);
        console.log(`使用模型: ${config.model}`);

        const response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.choices[0].message;
    } catch (error) {
        console.error('API 调用失败:', error.message);
        throw error;
    }
}

// 解析工具调用
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

async function testChatFlow() {
    console.log('=== 桌面对话功能测试 ===');
    
    try {
        // 连接 MCP
        console.log('1. 连接 MCP...');
        const transport = new StdioClientTransport({
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', config.desktopPath, config.downloadsPath]
        });
        
        const client = new Client({
            name: 'mcp-test-client',
            version: '1.0.0'
        }, {
            capabilities: {}
        });
        
        await client.connect(transport);
        console.log('✓ MCP 连接成功');
        
        // 获取工具列表
        const toolsResult = await client.listTools();
        const tools = toolsResult.tools;
        console.log(`✓ 获取到 ${tools.length} 个工具`);
        
        // 构建工具定义
        const toolDefinitions = tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
            }
        }));
        
        // 测试案例列表
        const testCases = [
            {
                name: '列出桌面文件',
                question: '请列出我桌面上的文件',
                expectedTool: 'list_directory'
            },
            {
                name: '读取桌面文件',
                question: '请读取 文件ai助手文件 的内容',
                expectedTool: 'read_text_file'
            },
            {
                name: '搜索PDF文件',
                question: '请在我的桌面中搜索所有PDF文件',
                expectedTool: 'search_files'
            },
            {
                name: '获取文件信息',
                question: '请查看桌面文件 新闻.docx 的详细信息',
                expectedTool: 'get_file_info'
            }
        ];
        
        // 构建系统提示
        const systemPrompt = `你是一个智能助手，可以帮助用户操作文件系统。你有以下工具可以使用：

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

请用中文回答用户的问题。`;
        
        // 运行测试案例
        for (const testCase of testCases) {
            console.log(`\n=== 测试案例: ${testCase.name} ===`);
            console.log(`问题: ${testCase.question}`);
            
            // 构建消息
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: testCase.question }
            ];
            
            try {
                // 调用模型
                console.log('调用模型...');
                const assistantMessage = await callSiliconFlowAPI(messages, toolDefinitions);
                messages.push(assistantMessage);
                
                console.log('模型响应:', JSON.stringify(assistantMessage, null, 2));
                
                // 处理工具调用 - 从 reasoning_content 解析
                let toolCalls = [];
                
                if (assistantMessage.reasoning_content) {
                    const parsed = parseToolCallsFromReasoning(assistantMessage.reasoning_content);
                    if (parsed && parsed.tool_calls) {
                        toolCalls = parsed.tool_calls;
                    }
                }
                
                if (toolCalls.length > 0) {
                    console.log('检测到工具调用');
                    
                    for (const toolCall of toolCalls) {
                        console.log(`执行工具: ${toolCall.function.name}`);
                        
                        let args;
                        try {
                            args = JSON.parse(toolCall.function.arguments);
                        } catch (e) {
                            args = toolCall.function.arguments;
                        }
                        
                        console.log('工具参数:', args);
                        
                        // 执行工具调用
                        const result = await client.callTool({
                            name: toolCall.function.name,
                            arguments: args
                        });
                        
                        console.log('工具执行结果:', JSON.stringify(result, null, 2));
                        
                        // 添加工具响应到消息历史
                        const toolMessage = {
                            role: 'tool',
                            content: JSON.stringify(result.isError ? { error: result.content[0].text } : { content: result.content[0].text }),
                            tool_call_id: toolCall.id
                        };
                        messages.push(toolMessage);
                    }
                    
                    // 获取最终回答
                    console.log('获取最终回答...');
                    const finalMessage = await callSiliconFlowAPI(messages, toolDefinitions);
                    console.log('工具执行结果:', JSON.stringify(messages[messages.length - 1], null, 2));
                    console.log('最终回答内容:', finalMessage.content || finalMessage.reasoning_content || '无回答内容');
                    console.log('完整最终回答:', JSON.stringify(finalMessage, null, 2));
                    
                } else {
                    console.log('直接回答:', assistantMessage.content || assistantMessage.reasoning_content);
                }
                
                console.log(`✓ 测试案例 ${testCase.name} 完成`);
                
            } catch (error) {
                console.error(`✗ 测试案例 ${testCase.name} 失败:`, error.message);
            }
        }
        
        // 关闭连接
        await client.close();
        console.log('\n✓ MCP 连接已关闭');
        console.log('\n=== 测试完成 ===');
        
    } catch (error) {
        console.error('测试失败:', error);
    }
}

// 运行测试
testChatFlow();
