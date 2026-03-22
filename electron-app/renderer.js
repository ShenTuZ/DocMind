let currentTab = 'chat';
let chatHistory = [];
let knowledgeList = [];
let isProcessing = false;

async function init() {
  await loadKnowledge();
  await loadConfig();
  renderChatHistory();
  renderKnowledgeList();
}

async function loadConfig() {
  try {
    const config = await window.electronAPI.loadConfig();
    if (config) {
      document.getElementById('model-name').value = config.model || 'Qwen/Qwen3.5-35B-A3B';
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
      model: document.getElementById('model-name').value || 'Qwen/Qwen3.5-35B-A3B',
      desktopPath: document.getElementById('desktop-path').value || 'C:\\Users\\Administrator\\Desktop',
      downloadsPath: document.getElementById('downloads-path').value || 'C:\\Users\\Administrator\\Downloads'
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

function renderKnowledgeList() {
  const container = document.getElementById('knowledge-list');
  
  if (knowledgeList.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>暂无知识库内容</p>
      </div>
    `;
    return;
  }

  container.innerHTML = knowledgeList.map(knowledge => `
    <div class="knowledge-card">
      <div class="knowledge-card-title">${escapeHtml(knowledge.title)}</div>
      <div class="knowledge-card-content">${escapeHtml(knowledge.content)}</div>
      <div class="knowledge-card-actions">
        <button class="action-button" onclick="deleteKnowledge('${knowledge.id}')">删除</button>
      </div>
    </div>
  `).join('');
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

  if (!message) {
    return;
  }

  isProcessing = true;
  input.value = '';
  input.disabled = true;
  document.getElementById('send-button').disabled = true;

  addMessageToChat('user', message);
  showTypingIndicator();

  try {
    const result = await window.electronAPI.sendMessage(message);

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
  }
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

  chatHistory.forEach((msg, index) => {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${msg.role}`;
    
    let toolCallsHtml = '';
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      toolCallsHtml = `
        <div class="tool-calls">
          <div class="tool-calls-title">🔧 工具调用 (${msg.toolCalls.length})</div>
          ${msg.toolCalls.map(tc => `
            <div class="tool-call-item">
              <div class="tool-call-name">${tc.name}</div>
              <div class="tool-call-args">${escapeHtml(JSON.stringify(tc.args, null, 2))}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    const time = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    messageDiv.innerHTML = `
      <div class="message-bubble">
        ${formatMessage(msg.content)}
        ${toolCallsHtml}
      </div>
      <div class="message-time">${time}</div>
    `;

    container.appendChild(messageDiv);
  });
  
  container.scrollTop = container.scrollHeight;
}

function addMessageToChat(role, content, toolCalls = []) {
  const container = document.getElementById('chat-messages');
  
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

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

  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  messageDiv.innerHTML = `
    <div class="message-bubble">
      ${formatMessage(content)}
      ${toolCallsHtml}
    </div>
    <div class="message-time">${time}</div>
  `;

  container.appendChild(messageDiv);
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', init);
