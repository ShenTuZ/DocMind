# DocMind - 智能文档助手

DocMind是一款基于Electron框架开发的智能文档助手应用，集成了先进的AI技术，旨在提供高效、智能的文档管理和交互体验。通过结合本地文件系统操作与AI能力，DocMind为用户提供了一个全方位的文档处理解决方案。

## 🌟 功能特性

### 核心功能
- **智能文档分析**：通过AI模型分析和理解各种格式文档的内容，包括PDF、Word、Excel、PPT等
- **语音交互**：集成Vosk语音识别引擎，支持语音命令和输入
- **知识库管理**：基于RAG（检索增强生成）技术构建和管理知识库，实现智能检索
- **多模态交互**：支持文本、图像等多种输入方式
- **文件系统操作**：读取、编辑、创建和管理本地文件
- **PageIndex文档索引**：构建文档索引，实现快速查询和定位

### 技术亮点
- **跨进程通信**：实现Electron主进程与渲染进程的高效通信
- **Python子进程管理**：动态检测和管理Python环境，确保依赖库正确加载
- **多格式文件解析**：支持多种文档格式的智能解析和内容提取
- **智能工具调用**：AI模型根据用户需求自动调用相应工具执行操作
- **安全路径处理**：保护用户隐私，处理模型输出中的路径信息
- **流式响应**：实现AI模型的流式输出，提升用户体验

## 🛠️ 技术栈

### 前端
- **Electron.js**：跨平台桌面应用框架
- **HTML5/CSS3/JavaScript**：前端界面开发

### 后端
- **Node.js**：JavaScript运行时
- **Python**：用于文件处理和语音识别

### AI技术
- **MCP (Model Context Protocol) SDK**：模型上下文协议
- **Ollama**：本地AI模型
- **Vosk**：开源语音识别引擎

### 文件处理
- **PyPDF2**：PDF文件解析
- **python-docx**：Word文件解析
- **pandas**：Excel文件处理
- **python-pptx**：PPT文件解析

## 📦 安装说明

### 前提条件
- **Node.js** 16.x 或更高版本
- **Python** 3.7 或更高版本
- **npm** 或 **yarn** 包管理器

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/ShenTuZ/DocMind.git
   cd DocMind
   ```

2. **安装Node.js依赖**
   ```bash
   cd electron-app
   npm install
   ```

3. **安装Python依赖**
   ```bash
   pip install -r requirements.txt
   ```

4. **配置应用**
   复制配置文件示例并填写相关信息：
   ```bash
   cp config.example.json config.json
   ```
   编辑`config.json`文件，填写以下信息：
   - `apiKey`：SiliconFlow API密钥（如果使用API模式）
   - `desktopPath`：桌面路径
   - `downloadsPath`：下载路径
   - `pythonPath`：Python可执行文件路径

5. **下载语音模型**
   下载Vosk中文语音模型并解压到项目根目录：
   - 下载地址：[Vosk Chinese Model](https://alphacephei.com/vosk/models/vosk-model-cn-0.22.zip)
   - 解压后目录名应为：`vosk-model-cn-0.22`

6. **运行应用**
   ```bash
   npm start
   ```

## 📁 项目结构

```
DocMind/
├── electron-app/          # 主应用目录
│   ├── pageindex/         # 文档索引模块
│   │   ├── __init__.py
│   │   ├── config.yaml
│   │   ├── page_index.py
│   │   ├── page_index_md.py
│   │   └── utils.py
│   ├── .gitignore         # 忽略文件配置
│   ├── README.md          # 应用详细文档
│   ├── config.example.json # 配置文件示例
│   ├── index.html         # 主界面
│   ├── login.html         # 登录界面
│   ├── main.js            # Electron主进程
│   ├── package.json       # Node.js依赖配置
│   ├── preload.js         # 预加载脚本
│   ├── rag_processor.py   # RAG知识库处理器
│   ├── renderer.js        # 渲染进程
│   ├── requirements.txt   # Python依赖配置
│   ├── run_pageindex.py   # 运行PageIndex
│   ├── styles.css         # 样式文件
│   ├── test_mcp.js        # MCP测试
│   ├── vectorless_rag.py  # 无向量RAG实现
│   └── voice_recognition.py # 语音识别模块
├── vosk-model-cn-0.22/    # 中文语音识别模型（已忽略）
├── q1-fy25-earnings.pdf   # 测试文档（已忽略）
├── .gitignore             # 全局忽略文件配置
└── README.md              # 项目主文档
```

## 🚀 使用方法

### 智能聊天
1. 在聊天界面输入问题，AI会根据上下文和知识库内容给出回答
2. 支持发送文本消息和上传文件/图片
3. 可以使用语音输入功能，点击语音按钮开始录音

### 知识库管理
1. 点击"知识库"标签页
2. 点击"选择文件"或"选择文件夹"按钮添加文档到知识库
3. 等待文档处理完成后，即可在知识库中查询相关内容

### PageIndex文档索引
1. 点击"PageIndex"标签页
2. 选择文档进行处理，系统会构建文档索引
3. 处理完成后，可以针对该文档进行详细查询

### 配置管理
1. 点击设置按钮打开配置界面
2. 选择模型类型（API或Ollama）
3. 填写相关配置信息，点击保存

## ⚙️ 配置说明

### 模型配置
- **API模式**：使用SiliconFlow API，需要填写API密钥
  - `apiUrl`：API地址，默认为`https://api.siliconflow.cn/v1/chat/completions`
  - `apiKey`：SiliconFlow API密钥
  - `model`：模型名称，默认为`Qwen/Qwen3-VL-32B-Instruct`

- **Ollama模式**：使用本地Ollama模型，需要安装Ollama并下载相应模型
  - `ollamaModel`：Ollama模型名称，默认为`qwen3.5:4b`

### 路径配置
- `desktopPath`：桌面路径，用于访问桌面文件
- `downloadsPath`：下载路径，用于访问下载文件夹
- `pythonPath`：Python可执行文件路径，用于运行Python脚本

## ❓ 常见问题

### 1. Python环境错误
**症状**：应用无法启动或提示Python相关错误
**解决方案**：确保Python已正确安装并添加到系统路径，或在配置文件中指定正确的Python路径

### 2. 语音识别失败
**症状**：语音识别无响应或报错
**解决方案**：检查Vosk模型是否正确下载并放置在正确位置

### 3. API调用失败
**症状**：使用API模式时提示API调用失败
**解决方案**：检查API密钥是否正确配置，确保网络连接正常

### 4. 文件访问权限
**症状**：无法访问或处理文件
**解决方案**：确保应用有足够的权限访问指定路径，检查文件是否存在

### 5. 模型响应慢
**症状**：AI模型响应时间长
**解决方案**：使用本地Ollama模型，或选择较小的模型以提高响应速度

## 🤝 贡献

欢迎提交Issue和Pull Request！如果您有任何问题或建议， please feel free to contact us.

### 贡献流程
1. Fork本仓库
2. 创建您的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开Pull Request

## 📄 许可证

本项目采用 **MIT 许可证**。MIT License 是一种宽松的开源许可证，允许您自由使用、修改和分发软件，只要保留原始版权和许可证声明。

## 📞 联系方式

- **GitHub**：[https://github.com/ShenTuZ/DocMind](https://github.com/ShenTuZ/DocMind)

---

*DocMind - 让文档处理更智能*