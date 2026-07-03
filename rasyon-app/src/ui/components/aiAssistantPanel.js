import { state } from '../app.js';
import { t } from '../i18n.js';
import { askGemini } from '../../core/aiService.js';
import { showToast } from '../utils.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

let messageHistory = [];

export function renderAiAssistantPanel(container) {
  container.innerHTML = `
    <div class="ai-panel">
      <div class="ai-disclaimer">
        <i class="ti ti-alert-triangle"></i>
        <span>${t('ai.disclaimer')}</span>
      </div>
      
      <div class="ai-chat-history" id="aiChatHistory">
        <!-- Messages will appear here -->
      </div>
      
      <div class="ai-chat-input-wrapper">
        <textarea id="aiChatInput" placeholder="${t('ai.placeholder')}" rows="2"></textarea>
        <button id="aiSendBtn" class="btn btn-primary" title="${t('ai.send')}">
          <i class="ti ti-send"></i>
        </button>
      </div>
    </div>
  `;

  const chatHistoryEl = document.getElementById('aiChatHistory');
  const chatInput = document.getElementById('aiChatInput');
  const sendBtn = document.getElementById('aiSendBtn');

  // Render initial history if exists
  renderHistory(chatHistoryEl);

  const sendMessage = async () => {
    const text = chatInput.value.trim();
    if (!text) return;

    // Add user message to history
    messageHistory.push({ role: 'user', content: text });
    chatInput.value = '';
    renderHistory(chatHistoryEl);
    
    // Show typing indicator
    const typingId = 'typing-indicator';
    const typingHtml = `
      <div class="ai-message ai-message-assistant" id="${typingId}">
        <div class="ai-message-content typing">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    `;
    chatHistoryEl.insertAdjacentHTML('beforeend', typingHtml);
    chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;

    sendBtn.disabled = true;

    try {
      // Build context from current state
      const contextData = {
        animal: state.animal,
        feeds: state.selectedFeeds.map(f => ({ name: f.name, category: f.category, currentAmount: f.val || 0 })),
        result: state.rationResult ? {
          dmi: state.rationResult.dmi,
          nel: state.rationResult.nel,
          cp: state.rationResult.cp,
          cost: state.rationResult.cost
        } : null
      };

      const systemPromptTemplate = t('ai.systemPrompt');
      const systemPrompt = systemPromptTemplate.replace('{{data}}', JSON.stringify(contextData, null, 2));

      // Call AI Service
      const response = await askGemini(text, systemPrompt);

      // Remove typing indicator
      const typingEl = document.getElementById(typingId);
      if (typingEl) typingEl.remove();

      // Add AI response to history
      messageHistory.push({ role: 'assistant', content: response });
      renderHistory(chatHistoryEl);

    } catch (error) {
      console.error(error);
      const typingEl = document.getElementById(typingId);
      if (typingEl) typingEl.remove();
      
      showToast("Yapay zeka ile iletişimde bir hata oluştu.", "error");
    } finally {
      sendBtn.disabled = false;
      chatInput.focus();
    }
  };

  sendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

function renderHistory(container) {
  container.innerHTML = '';
  
  if (messageHistory.length === 0) {
    container.innerHTML = `
      <div class="ai-empty-state">
        <i class="ti ti-robot"></i>
        <p>Merhaba! Rasyon veya hayvan besleme ile ilgili sorularınızı sorabilirsiniz.</p>
      </div>
    `;
    return;
  }

  messageHistory.forEach(msg => {
    const msgClass = msg.role === 'user' ? 'ai-message-user' : 'ai-message-assistant';
    
    let formattedContent = '';
    if (msg.role === 'assistant') {
      formattedContent = DOMPurify.sanitize(marked.parse(msg.content));
    } else {
      // Escape user text to prevent XSS
      const div = document.createElement('div');
      div.innerText = msg.content;
      formattedContent = div.innerHTML.replace(/\n/g, '<br/>');
    }

    const html = `
      <div class="ai-message ${msgClass}">
        <div class="ai-message-content markdown-body">
          ${formattedContent}
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
  
  container.scrollTop = container.scrollHeight;
}
