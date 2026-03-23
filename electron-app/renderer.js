let currentTab = 'chat';
let chatHistory = [];
let knowledgeList = [];
let isProcessing = false;
let isVoiceRecording = false;
let currentVoiceText = '';
let currentAttachment = null;

const DEFAULT_MODEL = 'Qwen/Qwen3-VL-32B-Instruct';
const DEFAULT_DESKTOP_PATH = 'C:\\Users\\Administrator\\Desktop';
const DEFAULT_DOWNLOADS_PATH = 'C:\\Users\\Administrator\\Downloads';

async function init() {
  await loadKnowledge();
  await loadKnowledgeStats();
  await loadConfig();
  renderChatHistory();
  renderKnowledgeList();
  setupVoiceListeners();
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
  const voiceStatus = document.getElementById('voice-status');
  const voiceText = voiceButton.querySelector('.voice-text');
  
  if (voiceButton) {
    if (isRecording) {
      voiceButton.classList.add('recording');
      voiceText.textContent = '结束输入';
      if (voiceStatus) {
        voiceStatus.style.display = 'flex';
      }
    } else {
      voiceButton.classList.remove('recording');
      voiceText.textContent = '开始输入';
      if (voiceStatus) {
        voiceStatus.style.display = 'none';
      }
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
      document.getElementById('model-name').value = config.model || DEFAULT_MODEL;
      document.getElementById('desktop-path').value = config.desktopPath || '';
      document.getElementById('downloads-path').value = config.downloadsPath || '';
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
    const config = {
      model: document.getElementById('model-name').value || DEFAULT_MODEL,
      desktopPath: document.getElementById('desktop-path').value || DEFAULT_DESKTOP_PATH,
      downloadsPath: document.getElementById('downloads-path').value || DEFAULT_DOWNLOADS_PATH
    };

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
  
  try {
    const result = await window.electronAPI.getKnowledgeFiles();
    
    if (!result.success || result.files.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>暂无知识库内容</p>
        </div>
      `;
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
  } catch (error) {
    console.error('加载知识库文件列表失败:', error);
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

function switchTab(tab) {
  currentTab = tab;

  document.querySelectorAll('.nav-card').forEach(card => {
    card.classList.remove('active');
  });

  document.getElementById(`nav-${tab}`).classList.add('active');

  if (tab === 'chat') {
    document.getElementById('chat-container').classList.remove('hidden');
    document.getElementById('knowledge-container').classList.add('hidden');
  } else if (tab === 'knowledge') {
    document.getElementById('chat-container').classList.add('hidden');
    document.getElementById('knowledge-container').classList.remove('hidden');
  }
}

function openConfig() {
  document.getElementById('config-modal').classList.remove('hidden');
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
            <span class="attachment-file-icon">📎</span>
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
  reader.readAsDataURL(file);
}

function showAttachmentPreview() {
  const preview = document.getElementById('attachment-preview');
  const icon = document.getElementById('attachment-icon');
  const name = document.getElementById('attachment-name');

  if (currentAttachment) {
    icon.textContent = currentAttachment.type === 'image' ? '🖼️' : '📎';
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

function showRAGProgress(progress, message) {
  const progressText = document.getElementById('rag-progress-text');
  
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

async function searchKnowledge() {
  const searchInput = document.getElementById('knowledge-search-input');
  const query = searchInput.value.trim();
  
  if (!query) {
    alert('请输入搜索关键词');
    return;
  }
  
  try {
    const results = await window.electronAPI.searchKnowledge(query);
    displaySearchResults(results);
  } catch (error) {
    alert(`搜索失败: ${error.message}`);
  }
}

function displaySearchResults(results) {
  const resultsContainer = document.getElementById('search-results');
  
  if (results.length === 0) {
    resultsContainer.innerHTML = `
      <div class="search-result-item">
        <div class="search-result-title">未找到相关结果</div>
      </div>
    `;
    return;
  }
  
  resultsContainer.innerHTML = results.map(result => `
    <div class="search-result-item">
      <div class="search-result-title">${escapeHtml(result.title || '文档片段')}</div>
      <div class="search-result-content">${escapeHtml(result.content)}</div>
      <div class="search-result-source">来源: ${escapeHtml(result.source || '未知')}</div>
    </div>
  `).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', init);
