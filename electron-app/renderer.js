let currentTab = 'chat';
let chatHistory = [];
let knowledgeList = [];
let isProcessing = false;
let isVoiceRecording = false;
let currentVoiceText = '';
let currentAttachment = null;

const DEFAULT_MODEL = 'Qwen/Qwen3-VL-235B-A22B-Instruct';
let DEFAULT_DESKTOP_PATH = '';
let DEFAULT_DOWNLOADS_PATH = '';

// 异步初始化默认路径
async function initDefaultPaths() {
  try {
    const userHome = window.electronAPI.getUserHome ? await window.electronAPI.getUserHome() : '';
    DEFAULT_DESKTOP_PATH = userHome ? `${userHome}\\Desktop` : '';
    DEFAULT_DOWNLOADS_PATH = userHome ? `${userHome}\\Downloads` : '';
  } catch (error) {
    console.error('初始化默认路径失败:', error);
    // 使用系统默认路径作为备选
    DEFAULT_DESKTOP_PATH = 'C:\\Users\\' + (process.env.USERNAME || 'User') + '\\Desktop';
    DEFAULT_DOWNLOADS_PATH = 'C:\\Users\\' + (process.env.USERNAME || 'User') + '\\Downloads';
  }
}

async function init() {
  await initDefaultPaths();
  await loadKnowledge();
  await loadKnowledgeStats();
  await loadConfig();
  renderChatHistory();
  renderKnowledgeList();
  setupVoiceListeners();
  setupKnowledgeStreamListener();
}

function setupVoiceListeners() {
  window.electronAPI.onVoiceStatus((event, data) => {
    console.log('语音状态:', data);
    if (data.status === 'started') {
      isVoiceRecording = true;
      updateVoiceButtonState(true);
    } else if (data.status === 'stopped') {
      isVoiceRecording = false;
      updateVoiceButtonState(false);
    }
  });
  
  window.electronAPI.onVoiceResult((event, data) => {
    console.log('语音识别结果:', data);
    const inputField = document.getElementById('message-input');
    if (inputField) {
      if (data.isFinal) {
        currentVoiceText = data.text;
        inputField.value = data.text;
        inputField.focus();
      } else {
        inputField.value = data.text + '...';
        inputField.focus();
      }
    }
  });
  
  window.electronAPI.onVoiceError((event, data) => {
    console.error('语音识别错误:', data);
    alert('语音识别错误: ' + data.error);
    isVoiceRecording = false;
    updateVoiceButtonState(false);
  });
}

function updateVoiceButtonState(isRecording) {
  const voiceButton = document.getElementById('voice-button');
  const voiceText = voiceButton.querySelector('.voice-text');
  
  if (voiceButton) {
    if (isRecording) {
      voiceButton.classList.add('recording');
      voiceText.textContent = '结束';
    } else {
      voiceButton.classList.remove('recording');
      voiceText.textContent = '语音';
    }
  }
}

async function toggleVoiceRecording() {
  try {
    if (isVoiceRecording) {
      const result = await window.electronAPI.stopVoiceRecognition();
      if (!result.success) {
        alert('停止录音失败: ' + result.error);
      }
    } else {
      const result = await window.electronAPI.startVoiceRecognition();
      if (!result.success) {
        alert('启动录音失败: ' + result.error);
      }
    }
  } catch (error) {
    alert('语音识别操作失败: ' + error.message);
  }
}

async function loadConfig() {
  try {
    const config = await window.electronAPI.loadConfig();
    if (config) {
      const modelType = config.modelType || 'api';
      document.getElementById('model-type').value = modelType;
      document.getElementById('desktop-path').value = config.desktopPath || '';
      document.getElementById('downloads-path').value = config.downloadsPath || '';
      
      const apiUrlElement = document.getElementById('api-url');
      if (apiUrlElement) {
        apiUrlElement.value = config.apiUrl || 'https://api.siliconflow.cn/v1/chat/completions';
      }
      
      const apiKeyElement = document.getElementById('api-key');
      if (apiKeyElement) {
        apiKeyElement.value = config.apiKey || '';
      }
      
      const pythonPathElement = document.getElementById('python-path');
      if (pythonPathElement) {
        pythonPathElement.value = config.pythonPath || '';
      }
      
      const apiModelSection = document.getElementById('api-model-section');
      const ollamaModelSection = document.getElementById('ollama-model-section');
      
      if (modelType === 'api') {
        apiModelSection.style.display = 'block';
        ollamaModelSection.style.display = 'none';
        document.getElementById('model-name').value = config.model || DEFAULT_MODEL;
      } else {
        apiModelSection.style.display = 'none';
        ollamaModelSection.style.display = 'block';
        document.getElementById('ollama-model-name').value = config.model || 'qwen3.5:4b';
      }
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
}

async function clearHistory() {
  try {
    await window.electronAPI.clearHistory();
    chatHistory = [];
    renderChatHistory();
    alert('历史记录已清空');
  } catch (error) {
    console.error('清空历史失败:', error);
  }
}

async function saveConfig() {
  try {
    const modelType = document.getElementById('model-type').value;
    let modelName;
    
    if (modelType === 'api') {
      modelName = document.getElementById('model-name').value || DEFAULT_MODEL;
    } else {
      modelName = document.getElementById('ollama-model-name').value || 'qwen3.5:4b';
    }
    
    const config = {
      modelType: modelType,
      model: modelName,
      desktopPath: document.getElementById('desktop-path').value || DEFAULT_DESKTOP_PATH,
      downloadsPath: document.getElementById('downloads-path').value || DEFAULT_DOWNLOADS_PATH,
      pythonPath: document.getElementById('python-path').value || ''
    };
    
    const apiUrlElement = document.getElementById('api-url');
    if (apiUrlElement) {
      config.apiUrl = apiUrlElement.value || 'https://api.siliconflow.cn/v1/chat/completions';
    }
    
    const apiKeyElement = document.getElementById('api-key');
    if (apiKeyElement) {
      config.apiKey = apiKeyElement.value || '';
    }

    const result = await window.electronAPI.saveConfig(config);
    if (result.success) {
      alert('配置保存成功！');
      closeConfig();
    } else {
      alert('配置保存失败：' + result.error);
    }
  } catch (error) {
    alert('配置保存失败：' + error.message);
  }
}

async function loadKnowledge() {
  try {
    knowledgeList = await window.electronAPI.loadKnowledge();
  } catch (error) {
    console.error('加载知识库失败:', error);
    knowledgeList = [];
  }
}

async function addKnowledge() {
  try {
    const title = document.getElementById('knowledge-title').value.trim();
    const content = document.getElementById('knowledge-content').value.trim();

    if (!title || !content) {
      alert('请填写标题和内容');
      return;
    }

    const newKnowledge = {
      id: Date.now().toString(),
      title: title,
      content: content,
      createdAt: new Date().toISOString()
    };

    knowledgeList.push(newKnowledge);
    await saveKnowledgeData();
    renderKnowledgeList();

    document.getElementById('knowledge-title').value = '';
    document.getElementById('knowledge-content').value = '';
  } catch (error) {
    alert('添加知识失败：' + error.message);
  }
}

async function deleteKnowledge(id) {
  try {
    if (!confirm('确定要删除这条知识吗？')) {
      return;
    }

    knowledgeList = knowledgeList.filter(k => k.id !== id);
    await saveKnowledgeData();
    renderKnowledgeList();
  } catch (error) {
    alert('删除知识失败：' + error.message);
  }
}

async function saveKnowledgeData() {
  try {
    await window.electronAPI.saveKnowledge(knowledgeList);
  } catch (error) {
    console.error('保存知识库失败:', error);
    throw error;
  }
}

async function renderKnowledgeList() {
  const container = document.getElementById('knowledge-list');
  const fileSelect = document.getElementById('knowledge-file-select');
  
  try {
    const result = await window.electronAPI.getKnowledgeFiles();
    
    if (!result.success || result.files.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>暂无知识库内容</p>
        </div>
      `;
      
      // 重置文件选择下拉框
      if (fileSelect) {
        fileSelect.innerHTML = '<option value="">所有文件</option>';
      }
      return;
    }

    // 限制显示最多10个文件
    const displayFiles = result.files.slice(0, 10);
    const hasMore = result.files.length > 10;

    container.innerHTML = displayFiles.map((file, index) => {
      // 转义文件路径中的反斜杠，避免HTML解析问题
      const escapedPath = file.path.replace(/\\/g, '\\\\');
      return `
        <div class="knowledge-card">
          <div class="knowledge-card-title">${escapeHtml(file.name)}</div>
          <div class="knowledge-card-meta">
            <span>大小: ${formatFileSize(file.size)}</span>
            <span>分块: ${file.chunks}</span>
          </div>
          <div class="knowledge-card-actions">
            <button class="action-button" onclick="deleteKnowledgeFile('${escapedPath}')">删除</button>
          </div>
        </div>
      `;
    }).join('');

    // 如果有更多文件，显示提示
    if (hasMore) {
      container.innerHTML += `
        <div class="more-files-info">
          <p>还有 ${result.files.length - 10} 个文件未显示</p>
        </div>
      `;
    }
    
    // 更新文件选择下拉框
    if (fileSelect) {
      fileSelect.innerHTML = '<option value="">所有文件</option>';
      result.files.forEach(file => {
        const option = document.createElement('option');
        option.value = file.path;
        option.textContent = file.name;
        fileSelect.appendChild(option);
      });
    }
  } catch (error) {
    console.error('加载知识库文件列表失败:', error);
    container.innerHTML = `
      <div class="empty-state">
        <p>加载失败</p>
      </div>
    `;
  }
}

async function renderPageIndexList() {
  const container = document.getElementById('pageindex-list');
  const fileSelect = document.getElementById('pageindex-file-select');
  
  try {
    const result = await window.electronAPI.getPageIndexFiles();
    
    if (!result.success || result.files.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>暂无已处理文档</p>
        </div>
      `;
      
      // 重置文件选择下拉框
      if (fileSelect) {
        fileSelect.innerHTML = '<option value="">选择文档</option>';
      }
      return;
    }

    // 限制显示最多10个文件
    const displayFiles = result.files.slice(0, 10);
    const hasMore = result.files.length > 10;

    container.innerHTML = displayFiles.map((file, index) => {
      // 转义文件路径中的反斜杠，避免HTML解析问题
      const escapedPath = file.path.replace(/\\/g, '\\\\');
      return `
        <div class="knowledge-card">
          <div class="knowledge-card-title">${escapeHtml(file.name)}</div>
          <div class="knowledge-card-meta">
            <span>大小: ${formatFileSize(file.size)}</span>
            <span>状态: ${file.status}</span>
          </div>
          <div class="knowledge-card-actions">
            <button class="action-button" onclick="deletePageIndexFile('${escapedPath}')">删除</button>
          </div>
        </div>
      `;
    }).join('');

    // 如果有更多文件，显示提示
    if (hasMore) {
      container.innerHTML += `
        <div class="more-files-info">
          <p>还有 ${result.files.length - 10} 个文件未显示</p>
        </div>
      `;
    }
    
    // 更新文件选择下拉框
    if (fileSelect) {
      fileSelect.innerHTML = '<option value="">选择文档</option>';
      result.files.forEach(file => {
        const option = document.createElement('option');
        option.value = file.path;
        option.textContent = file.name;
        fileSelect.appendChild(option);
      });
    }
  } catch (error) {
    console.error('加载PageIndex文件列表失败:', error);
    container.innerHTML = `
      <div class="empty-state">
        <p>加载失败</p>
      </div>
    `;
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function deleteKnowledgeFile(filePath) {
  if (!confirm('确定要删除这个文件吗？')) return;
  
  try {
    const result = await window.electronAPI.deleteKnowledgeFile(filePath);
    
    if (result.success) {
      alert('文件已成功删除');
      renderKnowledgeList();
    } else {
      alert(`删除失败: ${result.error}`);
    }
  } catch (error) {
    alert(`删除失败: ${error.message}`);
  }
}

async function deletePageIndexFile(filePath) {
  if (!confirm('确定要删除这个文件吗？')) return;
  
  try {
    const result = await window.electronAPI.deletePageIndexFile(filePath);
    
    if (result.success) {
      alert('文件已成功删除');
      renderPageIndexList();
    } else {
      alert(`删除失败: ${result.error}`);
    }
  } catch (error) {
    alert(`删除失败: ${error.message}`);
  }
}

function switchTab(tab) {
  currentTab = tab;

  document.querySelectorAll('.nav-card').forEach(card => {
    card.classList.remove('active');
  });

  document.getElementById(`nav-${tab}`).classList.add('active');

  if (tab === 'chat') {
    document.getElementById('chat-container').classList.remove('hidden');
    document.getElementById('knowledge-container').classList.add('hidden');
    document.getElementById('pageindex-container').classList.add('hidden');
    document.getElementById('skills-container').classList.add('hidden');
    document.getElementById('daily-container').classList.add('hidden');
  } else if (tab === 'knowledge') {
    document.getElementById('chat-container').classList.add('hidden');
    document.getElementById('knowledge-container').classList.remove('hidden');
    document.getElementById('pageindex-container').classList.add('hidden');
    document.getElementById('skills-container').classList.add('hidden');
    document.getElementById('daily-container').classList.add('hidden');
  } else if (tab === 'pageindex') {
    document.getElementById('chat-container').classList.add('hidden');
    document.getElementById('knowledge-container').classList.add('hidden');
    document.getElementById('pageindex-container').classList.remove('hidden');
    document.getElementById('skills-container').classList.add('hidden');
    document.getElementById('daily-container').classList.add('hidden');
    renderPageIndexList();
  } else if (tab === 'skills') {
    document.getElementById('chat-container').classList.add('hidden');
    document.getElementById('knowledge-container').classList.add('hidden');
    document.getElementById('pageindex-container').classList.add('hidden');
    document.getElementById('skills-container').classList.remove('hidden');
    document.getElementById('daily-container').classList.add('hidden');
    loadSkillsList();
  } else if (tab === 'daily') {
    document.getElementById('chat-container').classList.add('hidden');
    document.getElementById('knowledge-container').classList.add('hidden');
    document.getElementById('pageindex-container').classList.add('hidden');
    document.getElementById('skills-container').classList.add('hidden');
    document.getElementById('daily-container').classList.remove('hidden');
    loadDailyFiles();
  }
}

function openConfig() {
  document.getElementById('config-modal').classList.remove('hidden');
  
  const modelTypeSelect = document.getElementById('model-type');
  const apiModelSection = document.getElementById('api-model-section');
  const apiUrlSection = document.getElementById('api-url-section');
  const apiKeySection = document.getElementById('api-key-section');
  const ollamaModelSection = document.getElementById('ollama-model-section');
  const ollamaModelSelect = document.getElementById('ollama-model-name');
  
  const updateModelSections = function() {
    if (modelTypeSelect.value === 'api') {
      apiModelSection.style.display = 'block';
      if (apiUrlSection) apiUrlSection.style.display = 'block';
      if (apiKeySection) apiKeySection.style.display = 'block';
      ollamaModelSection.style.display = 'none';
    } else {
      apiModelSection.style.display = 'none';
      if (apiUrlSection) apiUrlSection.style.display = 'none';
      if (apiKeySection) apiKeySection.style.display = 'none';
      ollamaModelSection.style.display = 'block';
      loadOllamaModels();
    }
  };
  
  modelTypeSelect.addEventListener('change', updateModelSections);
  updateModelSections();
}

async function loadOllamaModels() {
  try {
    const result = await window.electronAPI.getOllamaModels();
    const ollamaModelSelect = document.getElementById('ollama-model-name');
    
    if (result.success && result.models.length > 0) {
      const currentValue = ollamaModelSelect.value;
      ollamaModelSelect.innerHTML = '';
      
      result.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        ollamaModelSelect.appendChild(option);
      });
      
      if (result.models.includes(currentValue)) {
        ollamaModelSelect.value = currentValue;
      }
    } else {
      console.log('未找到Ollama模型:', result.error || '无可用模型');
    }
  } catch (error) {
    console.error('加载Ollama模型失败:', error);
  }
}

function closeConfig() {
  document.getElementById('config-modal').classList.add('hidden');
}

function handleKeyPress(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  if (isProcessing) {
    return;
  }

  const input = document.getElementById('message-input');
  const message = input.value.trim();

  if (!message && !currentAttachment) {
    return;
  }

  isProcessing = true;
  input.value = '';
  input.disabled = true;
  document.getElementById('send-button').disabled = true;

  addMessageToChat('user', message, [], currentAttachment);
  showTypingIndicator();

  try {
    const result = await window.electronAPI.sendMessage(message, currentAttachment);

    removeTypingIndicator();

    if (result.success) {
      addMessageToChat('assistant', result.content, result.toolCalls);
    } else {
      addMessageToChat('assistant', `错误：${result.error}`);
    }
  } catch (error) {
    removeTypingIndicator();
    addMessageToChat('assistant', `处理失败：${error.message}`);
  } finally {
    isProcessing = false;
    input.disabled = false;
    document.getElementById('send-button').disabled = false;
    input.focus();
    removeAttachment();
  }
}

function createMessageElement(role, content, toolCalls = [], timestamp = null, attachment = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  let attachmentHtml = '';
  if (attachment) {
    if (attachment.type === 'image') {
      attachmentHtml = `
        <div class="message-attachment">
          <img src="${attachment.data}" alt="${attachment.name}" class="attachment-image">
        </div>
      `;
    } else {
      attachmentHtml = `
        <div class="message-attachment">
          <div class="attachment-file">
            <span class="attachment-file-name">${escapeHtml(attachment.name)}</span>
          </div>
        </div>
      `;
    }
  }

  let toolCallsHtml = '';
  if (toolCalls && toolCalls.length > 0) {
    toolCallsHtml = `
      <div class="tool-calls">
        <div class="tool-calls-title">🔧 工具调用 (${toolCalls.length})</div>
        ${toolCalls.map(tc => `
          <div class="tool-call-item">
            <div class="tool-call-name">${tc.name}</div>
            <div class="tool-call-args">${escapeHtml(JSON.stringify(tc.args, null, 2))}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  const time = (timestamp || new Date()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  messageDiv.innerHTML = `
    <div class="message-bubble">
      ${attachmentHtml}
      ${formatMessage(content)}
      ${toolCallsHtml}
    </div>
    <div class="message-time">${time}</div>
  `;

  return messageDiv;
}

function renderChatHistory() {
  const container = document.getElementById('chat-messages');
  
  if (chatHistory.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>暂无对话历史</p>
      </div>
    `;
    return;
  }

  chatHistory.forEach(msg => {
    container.appendChild(createMessageElement(msg.role, msg.content, msg.toolCalls, new Date(msg.timestamp)));
  });
  
  container.scrollTop = container.scrollHeight;
}

function addMessageToChat(role, content, toolCalls = [], attachment = null) {
  const container = document.getElementById('chat-messages');
  
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  container.appendChild(createMessageElement(role, content, toolCalls, null, attachment));
  container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
  const container = document.getElementById('chat-messages');
  
  const indicator = document.createElement('div');
  indicator.className = 'message assistant typing-indicator';
  indicator.id = 'typing-indicator';
  indicator.innerHTML = `
    <div class="message-bubble">
      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;

  container.appendChild(indicator);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) {
    indicator.remove();
  }
}

function formatMessage(content) {
  if (!content) return '';
  
  let formatted = escapeHtml(content);
  
  formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre class="code-block"><code>${code}</code></pre>`;
  });

  formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
}

function selectImage() {
  document.getElementById('image-input').click();
}

function selectFile() {
  document.getElementById('file-input').click();
}

function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    currentAttachment = {
      type: 'image',
      name: file.name,
      data: e.target.result,
      mimeType: file.type
    };
    showAttachmentPreview();
  };
  reader.readAsDataURL(file);
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    currentAttachment = {
      type: 'file',
      name: file.name,
      data: e.target.result,
      mimeType: file.type
    };
    showAttachmentPreview();
  };
  reader.readAsText(file, 'utf-8');
}

function showAttachmentPreview() {
  const preview = document.getElementById('attachment-preview');
  const name = document.getElementById('attachment-name');

  if (currentAttachment) {
    name.textContent = currentAttachment.name;
    preview.style.display = 'block';
  }
}

function removeAttachment() {
  currentAttachment = null;
  document.getElementById('attachment-preview').style.display = 'none';
  document.getElementById('image-input').value = '';
  document.getElementById('file-input').value = '';
}

function selectFilesForRAG() {
  document.getElementById('rag-file-input').click();
}

function selectFolderForRAG() {
  document.getElementById('rag-folder-input').click();
}

function handleRAGFileSelect(event) {
  const files = event.target.files;
  if (files.length === 0) return;
  
  const filePaths = Array.from(files).map(file => file.path);
  processRAGFiles(filePaths);
}

function handleRAGFolderSelect(event) {
  const files = event.target.files;
  if (files.length === 0) return;
  
  const filePaths = Array.from(files).map(file => file.path);
  processRAGFiles(filePaths);
}

function selectFilesForPageIndex() {
  document.getElementById('pageindex-file-input').click();
}

function selectFolderForPageIndex() {
  document.getElementById('pageindex-folder-input').click();
}

function handlePageIndexFileSelect(event) {
  const files = event.target.files;
  if (files.length === 0) return;
  
  const filePaths = Array.from(files).map(file => file.path);
  processPageIndexFiles(filePaths);
}

function handlePageIndexFolderSelect(event) {
  const files = event.target.files;
  if (files.length === 0) return;
  
  const filePaths = Array.from(files).map(file => file.path);
  processPageIndexFiles(filePaths);
}

async function processRAGFiles(filePaths) {
  try {
    isProcessing = true;
    
    // 显示进度区域并添加处理中样式
    const progressSection = document.getElementById('rag-progress-section');
    if (progressSection) {
      progressSection.classList.remove('hidden');
      progressSection.classList.add('processing');
    }
    
    showRAGProgress(0, `开始处理 ${filePaths.length} 个文件...`);
    
    const result = await window.electronAPI.processRAGFiles(filePaths);
    
    if (result.success) {
      showRAGProgress(100, '文档处理完成');
      setTimeout(() => {
        showRAGProgress(0, '准备中...');
        // 移除处理中样式，恢复准备状态样式
        if (progressSection) {
          progressSection.classList.remove('processing');
        }
      }, 2000);
      alert('文档已成功添加到知识库！');
      await loadKnowledgeStats();
      renderKnowledgeList();
    } else {
      showRAGProgress(0, `处理失败: ${result.error}`);
      alert(`处理失败: ${result.error}`);
    }
  } catch (error) {
    showRAGProgress(0, `处理失败: ${error.message}`);
    alert(`处理失败: ${error.message}`);
  } finally {
    isProcessing = false;
    // 确保移除处理中样式
    const progressSection = document.getElementById('rag-progress-section');
    if (progressSection) {
      progressSection.classList.remove('processing');
    }
  }
}

async function processPageIndexFiles(filePaths) {
  try {
    isProcessing = true;
    
    // 显示进度区域并添加处理中样式
    const progressSection = document.getElementById('pageindex-progress-section');
    if (progressSection) {
      progressSection.classList.remove('hidden');
      progressSection.classList.add('processing');
    }
    
    showPageIndexProgress(0, `开始处理 ${filePaths.length} 个文件...`);
    
    const result = await window.electronAPI.processPageIndexFiles(filePaths);
    
    if (result.success) {
      showPageIndexProgress(100, '文档处理完成');
      setTimeout(() => {
        showPageIndexProgress(0, '准备中...');
        // 移除处理中样式，恢复准备状态样式
        if (progressSection) {
          progressSection.classList.remove('processing');
        }
      }, 2000);
      alert('文档已成功处理！');
      renderPageIndexList();
    } else {
      showPageIndexProgress(0, `处理失败: ${result.error}`);
      alert(`处理失败: ${result.error}`);
    }
  } catch (error) {
    showPageIndexProgress(0, `处理失败: ${error.message}`);
    alert(`处理失败: ${error.message}`);
  } finally {
    isProcessing = false;
    // 确保移除处理中样式
    const progressSection = document.getElementById('pageindex-progress-section');
    if (progressSection) {
      progressSection.classList.remove('processing');
    }
  }
}

function showRAGProgress(progress, message) {
  const progressText = document.getElementById('rag-progress-text');
  
  if (progressText) {
    progressText.textContent = message;
  }
}

function showPageIndexProgress(progress, message) {
  const progressText = document.getElementById('pageindex-progress-text');
  
  if (progressText) {
    progressText.textContent = message;
  }
}

async function loadKnowledgeStats() {
  try {
    const stats = await window.electronAPI.getKnowledgeStats();
    updateKnowledgeStats(stats);
  } catch (error) {
    console.error('加载知识库统计失败:', error);
  }
}

function updateKnowledgeStats(stats) {
  const docCount = document.getElementById('doc-count');
  const chunkCount = document.getElementById('chunk-count');
  const vectorCount = document.getElementById('vector-count');
  
  if (docCount) docCount.textContent = stats.documentCount || 0;
  if (chunkCount) chunkCount.textContent = stats.chunkCount || 0;
  if (vectorCount) vectorCount.textContent = stats.vectorCount || 0;
}

let currentKnowledgeMessageId = null;
let currentPageIndexMessageId = null;

async function sendKnowledgeMessage() {
  const chatInput = document.getElementById('knowledge-chat-input');
  const fileSelect = document.getElementById('knowledge-file-select');
  const message = chatInput.value.trim();
  const selectedFilePath = fileSelect.value;
  
  if (!message) {
    alert('请输入问题');
    return;
  }
  
  try {
    // 添加用户消息到聊天界面
    addChatMessage(message, 'user');
    chatInput.value = '';
    
    // 显示正在输入状态
    currentKnowledgeMessageId = addChatMessage('正在思考...', 'bot', true);
    
    // 调用知识库对话API
    const result = await window.electronAPI.chatWithKnowledge(message, selectedFilePath);
    
    if (result.success) {
      // 如果已经有流式输出，不需要额外处理
      if (!result.content && !currentKnowledgeMessageId) {
        addChatMessage('对话完成', 'bot');
      }
    } else {
      removeChatMessage(currentKnowledgeMessageId);
      currentKnowledgeMessageId = null;
      addChatMessage(`对话失败: ${result.error}`, 'bot');
    }
  } catch (error) {
    if (currentKnowledgeMessageId) {
      removeChatMessage(currentKnowledgeMessageId);
      currentKnowledgeMessageId = null;
    }
    addChatMessage(`对话失败: ${error.message}`, 'bot');
  }
}

async function sendPageIndexMessage() {
  const chatInput = document.getElementById('pageindex-chat-input');
  const fileSelect = document.getElementById('pageindex-file-select');
  const message = chatInput.value.trim();
  const selectedFilePath = fileSelect.value;
  
  if (!message) {
    alert('请输入问题');
    return;
  }
  
  if (!selectedFilePath) {
    alert('请先选择文档');
    return;
  }
  
  try {
    // 添加用户消息到聊天界面
    addPageIndexChatMessage(message, 'user');
    chatInput.value = '';
    
    // 显示正在输入状态
    currentPageIndexMessageId = addPageIndexChatMessage('正在思考...', 'bot', true);
    
    // 调用PageIndex对话API
    const result = await window.electronAPI.chatWithPageIndex(message, selectedFilePath);
    
    if (result.success) {
      // 移除临时消息并添加实际回答
      removePageIndexChatMessage(currentPageIndexMessageId);
      currentPageIndexMessageId = null;
      addPageIndexChatMessage(result.response || '对话完成', 'bot');
    } else {
      removePageIndexChatMessage(currentPageIndexMessageId);
      currentPageIndexMessageId = null;
      addPageIndexChatMessage(`对话失败: ${result.error}`, 'bot');
    }
  } catch (error) {
    if (currentPageIndexMessageId) {
      removePageIndexChatMessage(currentPageIndexMessageId);
      currentPageIndexMessageId = null;
    }
    addPageIndexChatMessage(`对话失败: ${error.message}`, 'bot');
  }
}

function addChatMessage(content, type, isTemp = false) {
  const chatMessages = document.getElementById('knowledge-chat-messages');
  const messageId = isTemp ? `temp-${Date.now()}` : `msg-${Date.now()}`;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${type}`;
  messageDiv.id = messageId;
  messageDiv.innerHTML = `<div>${escapeHtml(content)}</div>`;
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  return messageId;
}

function addPageIndexChatMessage(content, type, isTemp = false) {
  const chatMessages = document.getElementById('pageindex-chat-messages');
  const messageId = isTemp ? `temp-${Date.now()}` : `msg-${Date.now()}`;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${type}`;
  messageDiv.id = messageId;
  messageDiv.innerHTML = `<div>${escapeHtml(content)}</div>`;
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  return messageId;
}

function removeChatMessage(messageId) {
  const message = document.getElementById(messageId);
  if (message) {
    message.remove();
  }
}

function removePageIndexChatMessage(messageId) {
  const message = document.getElementById(messageId);
  if (message) {
    message.remove();
  }
}

function handleKnowledgeChatKeyPress(event) {
  if (event.key === 'Enter') {
    sendKnowledgeMessage();
  }
}

function handlePageIndexChatKeyPress(event) {
  if (event.key === 'Enter') {
    sendPageIndexMessage();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setupKnowledgeStreamListener() {
  window.electronAPI.onKnowledgeStream((event, data) => {
    if (currentKnowledgeMessageId) {
      const message = document.getElementById(currentKnowledgeMessageId);
      if (message) {
        if (message.textContent === '正在思考...') {
          message.textContent = data.content;
        } else {
          message.textContent += data.content;
        }
        // 滚动到底部
        const chatMessages = document.getElementById('knowledge-chat-messages');
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    } else {
      // 如果没有当前消息ID，创建一个新消息
      currentKnowledgeMessageId = addChatMessage(data.content, 'bot');
    }
  });
}

// 技能管理相关函数
function selectSkillFile() {
  document.getElementById('skill-file-input').click();
}

async function handleSkillFileSelect(event) {
  const files = event.target.files;
  if (!files.length) return;

  const uploadStatus = document.getElementById('skill-upload-status');
  uploadStatus.textContent = '正在上传技能文件...';

  try {
    // 这里可以添加上传到服务器的逻辑
    // 目前只是模拟上传成功
    await new Promise(resolve => setTimeout(resolve, 1000));

    uploadStatus.textContent = `成功上传 ${files.length} 个技能文件`;
    
    // 重新加载技能列表
    loadSkillsList();
  } catch (error) {
    console.error('上传技能文件失败:', error);
    uploadStatus.textContent = '上传失败: ' + error.message;
  }
}

async function loadSkillsList() {
  const skillsListContent = document.getElementById('skills-list-content');
  
  try {
    // 这里可以添加从服务器获取技能列表的逻辑
    // 目前只是模拟数据
    const mockSkills = [
      { name: '天气查询', type: 'skill.json' },
      { name: '计算器', type: 'skill.json' },
      { name: '翻译', type: 'mcp' }
    ];

    if (mockSkills.length === 0) {
      skillsListContent.innerHTML = '<p class="no-skills">暂无已安装的技能</p>';
      return;
    }

    skillsListContent.innerHTML = mockSkills.map(skill => `
      <div class="skill-item">
        <div class="skill-info">
          <div class="skill-name">${skill.name}</div>
          <div class="skill-type ${skill.type === 'skill.json' ? 'type-skill' : 'type-mcp'}">
            ${skill.type === 'skill.json' ? '技能' : 'MCP'}
          </div>
        </div>
        <div class="skill-actions">
          <button class="skill-action-button use-button" onclick="useSkill('${skill.name}', '${skill.type}')">使用</button>
          <button class="skill-action-button" onclick="editSkill('${skill.name}')">编辑</button>
          <button class="skill-action-button" onclick="deleteSkill('${skill.name}')">删除</button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('加载技能列表失败:', error);
    skillsListContent.innerHTML = '<p class="no-skills">加载技能列表失败</p>';
  }
}

function editSkill(skillName) {
  alert(`编辑技能: ${skillName}`);
  // 这里可以添加编辑技能的逻辑
}

function deleteSkill(skillName) {
  if (confirm(`确定要删除技能 "${skillName}" 吗？`)) {
    // 这里可以添加删除技能的逻辑
    loadSkillsList();
  }
}

function useSkill(skillName, skillType) {
  alert(`使用${skillType === 'skill.json' ? '技能' : 'MCP'}: ${skillName}`);
  // 这里可以添加使用技能的逻辑
}

// 日常文件管理相关函数
function selectDailyFile() {
  document.getElementById('daily-file-input').click();
}

async function handleDailyFileSelect(event) {
  const files = event.target.files;
  if (!files.length) return;

  const uploadStatus = document.getElementById('daily-upload-status');
  uploadStatus.textContent = '正在上传文件...';

  try {
    const filePaths = Array.from(files).map(file => file.path);
    const result = await window.electronAPI.uploadDailyFiles(filePaths);
    
    if (result.success) {
      uploadStatus.textContent = `成功上传 ${files.length} 个文件`;
      loadDailyFiles();
    } else {
      uploadStatus.textContent = `上传失败: ${result.error}`;
    }
  } catch (error) {
    console.error('上传日常文件失败:', error);
    uploadStatus.textContent = '上传失败: ' + error.message;
  }
}

async function loadDailyFiles() {
  const dailyListContent = document.getElementById('daily-list-content');
  
  try {
    const result = await window.electronAPI.getDailyFiles();
    
    if (!result.success || result.files.length === 0) {
      dailyListContent.innerHTML = '<p class="no-files">暂无已上传的文件</p>';
      return;
    }

    dailyListContent.innerHTML = result.files.map(file => {
      const date = new Date(file.upload_date).toLocaleString('zh-CN');
      return `
        <div class="daily-item">
          <div class="daily-info">
            <div class="daily-name">${escapeHtml(file.filename)}</div>
            <div class="daily-meta">
              <span>类型: ${file.file_type}</span>
              <span>大小: ${formatFileSize(file.file_size)}</span>
              <span>上传时间: ${date}</span>
            </div>
          </div>
          <div class="daily-actions">
            <button class="daily-action-button" onclick="downloadDailyFile('${file.file_path}', '${file.filename}')">下载</button>
            <button class="daily-action-button" onclick="deleteDailyFile(${file.id})">删除</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('加载日常文件列表失败:', error);
    dailyListContent.innerHTML = '<p class="no-files">加载文件列表失败</p>';
  }
}

async function downloadDailyFile(filePath, filename) {
  try {
    const result = await window.electronAPI.downloadDailyFile(filePath, filename);
    if (result.success) {
      alert('文件下载成功');
    } else {
      alert(`下载失败: ${result.error}`);
    }
  } catch (error) {
    alert(`下载失败: ${error.message}`);
  }
}

async function deleteDailyFile(fileId) {
  if (confirm('确定要删除这个文件吗？')) {
    try {
      const result = await window.electronAPI.deleteDailyFile(fileId);
      
      if (result.success) {
        alert('文件已成功删除');
        loadDailyFiles();
      } else {
        alert(`删除失败: ${result.error}`);
      }
    } catch (error) {
      alert(`删除失败: ${error.message}`);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
