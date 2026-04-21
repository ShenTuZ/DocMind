# DocMind - 智能文档助手

DocMind是一款基于Electron框架开发的智能文档助手应用，集成了先进的AI技术，旨在提供高效、智能的文档管理和交互体验。

## 功能特性

- **智能文档分析**：通过AI模型分析和理解各种格式文档的内容
- **语音交互**：集成Vosk语音识别引擎，支持语音命令和输入
- **知识库管理**：基于RAG技术构建和管理知识库，实现智能检索
- **多模态交互**：支持文本、图像等多种输入方式
- **文件系统操作**：读取、编辑、创建和管理本地文件
- **PageIndex文档索引**：构建文档索引，实现快速查询和定位

## 技术栈

- **前端**：Electron.js、HTML5、CSS3、JavaScript
- **后端**：Node.js、Python
- **AI技术**：MCP (Model Context Protocol) SDK、Ollama本地模型、Vosk语音识别
- **文件处理**：支持PDF、Word、Excel、PPT等多种文档格式

## 安装说明

### 前提条件

- Node.js 16.x 或更高版本
- Python 3.7 或更高版本
- npm 或 yarn 包管理器

### 安装步骤

1. 克隆仓库

```bash
git clone <repository-url>
cd mcp/electron-app
```

1. 安装Node.js依赖

```bash
npm install
```

1. 安装Python依赖

```bash
pip install -r requirements.txt
```

1. 配置应用

复制配置文件示例并填写相关信息：

```bash
cp config.example.json config.json
```

编辑`config.json`文件，填写以下信息：

- `apiKey`：SiliconFlow API密钥（如果使用API模式）
- `desktopPath`：桌面路径
- `downloadsPath`：下载路径
- `pythonPath`：Python可执行文件路径

1. 运行应用

```bash
npm start
```

## 项目结构

- `electron-app/`：主应用目录
  - `pageindex/`：文档索引模块
  - `main.js`：Electron主进程
  - `renderer.js`：渲染进程
  - `preload.js`：预加载脚本
  - `index.html`：主界面
  - `login.html`：登录界面
  - `rag_processor.py`：RAG知识库处理器
  - `voice_recognition.py`：语音识别模块

## 使用方法

1. **智能聊天**：在聊天界面输入问题，AI会根据上下文和知识库内容给出回答
2. **语音输入**：点击语音按钮，使用语音输入问题
3. **文件分析**：上传文件或图片，AI会分析内容并回答相关问题
4. **知识库管理**：添加文档到知识库，实现智能检索
5. **PageIndex**：处理文档并构建索引，实现快速查询
6. 技能（为实现完整使用）
7. 日常文件：可以进行日常文件上传和下载

## 配置说明

### 模型配置

- **API模式**：使用SiliconFlow API，需要填写API密钥
- **Ollama模式**：使用本地Ollama模型，需要安装Ollama并下载相应模型

### 路径配置

- `desktopPath`：桌面路径，用于访问桌面文件
- `downloadsPath`：下载路径，用于访问下载文件夹
- `pythonPath`：Python可执行文件路径，用于运行Python脚本

## 注意事项

- 首次运行时，应用会自动检测Python环境
- 使用语音识别功能需要下载Vosk语音模型
- 处理大型文档可能需要较长时间
- 知识库索引文件会保存在`rag_data`目录中

## 故障排除

### 常见问题

1. **Python环境错误**：确保Python已正确安装并添加到系统路径
2. **语音识别失败**：检查Vosk模型是否正确下载
3. **API调用失败**：检查API密钥是否正确配置
4. **文件访问权限**：确保应用有足够的权限访问指定路径

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request！

## Git上传指南

### 初始化Git仓库（如果尚未初始化）

```bash
git init
git remote add origin <repository-url>
```

### 提交更改

1. 添加文件到暂存区

```bash
git add .
```

1. 提交更改

```bash
git commit -m "提交信息"
```

1. 推送到远程仓库

```bash
git push -u origin master
```

### 分支管理

1. 创建新分支

```bash
git checkout -b <branch-name>
```

1. 切换分支

```bash
git checkout <branch-name>
```

1. 合并分支

```bash
git checkout master
git merge <branch-name>
```

### 常见Git命令

- 查看状态：`git status`
- 查看日志：`git log`
- 查看差异：`git diff`
- 撤销更改：`git checkout -- <file>`
- 撤销暂存：`git reset HEAD <file>`

