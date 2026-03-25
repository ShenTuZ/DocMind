const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

async function testMCP() {
    console.log('=== MCP 测试脚本 ===');
    
    try {
        // 配置 MCP 连接
        const desktopPath = 'C:\\Users\\Administrator\\Desktop';
        const downloadsPath = 'C:\\Users\\Administrator\\Downloads';
        
        console.log('1. 创建 MCP 传输层...');
        const transport = new StdioClientTransport({
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', desktopPath, downloadsPath]
        });
        
        console.log('2. 创建 MCP 客户端...');
        const client = new Client({
            name: 'mcp-test-client',
            version: '1.0.0'
        }, {
            capabilities: {}
        });
        
        console.log('3. 连接 MCP...');
        await client.connect(transport);
        console.log('✓ MCP 连接成功');
        
        console.log('\n4. 列出可用工具...');
        const toolsResult = await client.listTools();
        console.log('可用工具:');
        toolsResult.tools.forEach((tool, index) => {
            console.log(`${index + 1}. ${tool.name}: ${tool.description}`);
        });
        
        console.log('\n5. 测试工具调用...');
        
        // 测试 list_directory 工具
        console.log('\n5.1 测试 list_directory (桌面目录):');
        try {
            const desktopResult = await client.callTool({
                name: 'list_directory',
                arguments: { path: desktopPath }
            });
            console.log('✓ list_directory 调用成功');
            console.log('返回结果:', JSON.stringify(desktopResult, null, 2));
        } catch (error) {
            console.log('✗ list_directory 调用失败:', error.message);
        }
        
        // 测试 get_file_info 工具
        console.log('\n5.2 测试 get_file_info (config.json):');
        try {
            const configPath = path.join(__dirname, 'config.json');
            const fileInfoResult = await client.callTool({
                name: 'get_file_info',
                arguments: { path: configPath }
            });
            console.log('✓ get_file_info 调用成功');
            console.log('返回结果:', JSON.stringify(fileInfoResult, null, 2));
        } catch (error) {
            console.log('✗ get_file_info 调用失败:', error.message);
        }
        
        // 测试 read_text_file 工具
        console.log('\n5.3 测试 read_text_file (config.json):');
        try {
            const configPath = path.join(__dirname, 'config.json');
            const readResult = await client.callTool({
                name: 'read_text_file',
                arguments: { path: configPath }
            });
            console.log('✓ read_text_file 调用成功');
            console.log('文件内容:', readResult.content[0].text);
        } catch (error) {
            console.log('✗ read_text_file 调用失败:', error.message);
        }
        
        // 测试 search_files 工具
        console.log('\n5.4 测试 search_files (.json 文件):');
        try {
            const searchResult = await client.callTool({
                name: 'search_files',
                arguments: { 
                    path: desktopPath,
                    pattern: '*.json'
                }
            });
            console.log('✓ search_files 调用成功');
            console.log('搜索结果:', JSON.stringify(searchResult, null, 2));
        } catch (error) {
            console.log('✗ search_files 调用失败:', error.message);
        }
        
        console.log('\n6. 关闭 MCP 连接...');
        await client.close();
        console.log('✓ MCP 连接已关闭');
        
        console.log('\n=== MCP 测试完成 ===');
        
    } catch (error) {
        console.error('MCP 测试失败:', error);
    }
}

// 运行测试
testMCP();
