import { state } from '../app.js';
import { t } from '../i18n.js';
import { askGemini } from '../../core/aiService.js';
import { showToast } from '../utils.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { newId } from '../../data/uuid.js';
import { getAiChats, saveAiChat, deleteAiChat } from '../../data/db.js';

let chats = [];
let activeChatId = null;

export async function renderAiAssistantPanel(container) {
  // Yükleme sırasında geçici ekran
  container.innerHTML = `<div class="p-4 text-center text-muted"><i class="ti ti-loader ti-spin"></i> Yükleniyor...</div>`;

  try {
    chats = await getAiChats();
  } catch (e) {
    console.error("Sohbetler yüklenemedi:", e);
    chats = [];
  }

  if (chats.length === 0) {
    startNewChat();
  } else if (!activeChatId || !chats.find(c => c.id === activeChatId)) {
    activeChatId = chats[0].id;
  }

  container.innerHTML = `
    <div class="ai-panel">
      <!-- SOL MENÜ: GEÇMİŞ SOHBETLER (Mobilde Bottom Sheet) -->
      <div class="ai-sidebar-overlay" id="aiSidebarOverlay"></div>
      <div class="ai-sidebar" id="aiSidebar">
        <div class="ai-sidebar-header d-flex d-md-none align-items-center mb-3" style="width: 100%; justify-content: space-between;">
          <h4 class="m-0 d-flex align-items-center gap-2" style="font-weight: bold;"><i class="ti ti-message-circle-2"></i> Sohbetler</h4>
          <button id="aiCloseSidebarBtn" class="btn btn-icon p-0" style="background: transparent; border:none; color: var(--text-primary);"><i class="ti ti-x" style="font-size: 1.5rem;"></i></button>
        </div>
        <button id="aiNewChatBtn" class="btn btn-primary w-100 mb-3" style="margin-bottom: 1rem; background-color: #1c5237; border-color: #1c5237;">
          <i class="ti ti-plus"></i> Yeni Sohbet
        </button>
        <div id="aiChatList" class="ai-chat-list">
          <!-- Sohbet Listesi -->
        </div>
      </div>

      <!-- SAĞ EKRAN: AKTİF SOHBET -->
      <div class="ai-main">
        <div class="ai-mobile-header d-flex d-md-none align-items-center p-3 border-bottom" style="position: relative; justify-content: flex-end;">
          <h3 class="ai-chat-title m-0 font-weight-bold" style="position: absolute; left: 50%; transform: translateX(-50%); font-size: 1.25rem;">Sohbet</h3>
          <div class="ai-mobile-header-actions d-flex gap-3">
            <button id="aiMenuBtn" class="btn btn-icon p-0" style="background:transparent; border:none; color:var(--text-primary);"><i class="ti ti-menu-2" style="font-size: 1.5rem;"></i></button>
            <button id="aiDeleteCurrentChatBtn" class="btn btn-icon p-0" style="background:transparent; border:none; color:var(--text-secondary);"><i class="ti ti-trash" style="font-size: 1.5rem;"></i></button>
          </div>
        </div>
        
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
    </div>
  `;

  const chatListEl = document.getElementById('aiChatList');
  const chatHistoryEl = document.getElementById('aiChatHistory');
  const chatInput = document.getElementById('aiChatInput');
  const sendBtn = document.getElementById('aiSendBtn');
  const newChatBtn = document.getElementById('aiNewChatBtn');
  
  // Mobile specific elements
  const menuBtn = document.getElementById('aiMenuBtn');
  const closeSidebarBtn = document.getElementById('aiCloseSidebarBtn');
  const sidebar = document.getElementById('aiSidebar');
  const overlay = document.getElementById('aiSidebarOverlay');
  const deleteCurrentChatBtn = document.getElementById('aiDeleteCurrentChatBtn');

  const openSidebar = () => {
    sidebar.classList.add('open');
    overlay.classList.add('show');
  };

  const closeSidebar = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  };

  if (menuBtn) menuBtn.addEventListener('click', openSidebar);
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  if (deleteCurrentChatBtn) {
    deleteCurrentChatBtn.addEventListener('click', async () => {
      if (!activeChatId) return;
      if (confirm("Mevcut sohbeti silmek istediğinize emin misiniz?")) {
        await deleteAiChat(activeChatId);
        chats = chats.filter(c => c.id !== activeChatId);
        activeChatId = chats.length > 0 ? chats[0].id : null;
        if (!activeChatId) startNewChat();
        renderSidebar();
        renderHistory();
      }
    });
  }

  const renderSidebar = () => {
    chatListEl.innerHTML = '';
    chats.forEach(chat => {
      const isActive = chat.id === activeChatId ? 'active' : '';
      const title = chat.title || 'Yeni Sohbet';
      const html = `
        <div class="ai-chat-item ${isActive}" data-id="${chat.id}">
          <div class="ai-chat-item-title"><i class="ti ti-message-circle"></i> <span>${title}</span></div>
          <button class="ai-chat-delete-btn" data-id="${chat.id}" title="Sil"><i class="ti ti-trash"></i></button>
        </div>
      `;
      chatListEl.insertAdjacentHTML('beforeend', html);
    });

    // Event listeners for sidebar items
    chatListEl.querySelectorAll('.ai-chat-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.ai-chat-delete-btn')) return; // Silme butonuna basıldıysa yoksay
        activeChatId = item.dataset.id;
        renderSidebar();
        renderHistory();
        if (window.innerWidth <= 768) closeSidebar();
      });
    });

    chatListEl.querySelectorAll('.ai-chat-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idToDelete = btn.dataset.id;
        if (confirm("Bu sohbeti silmek istediğinize emin misiniz?")) {
          await deleteAiChat(idToDelete);
          chats = chats.filter(c => c.id !== idToDelete);
          if (activeChatId === idToDelete) {
            activeChatId = chats.length > 0 ? chats[0].id : null;
            if (!activeChatId) startNewChat();
          }
          renderSidebar();
          renderHistory();
        }
      });
    });
  };

  const renderHistory = () => {
    chatHistoryEl.innerHTML = '';
    const activeChat = chats.find(c => c.id === activeChatId);
    const messages = activeChat ? (activeChat.messages || []) : [];
    
    if (messages.length === 0) {
      chatHistoryEl.innerHTML = `
        <div class="ai-empty-state">
          <i class="ti ti-robot"></i>
          <p>Merhaba! Rasyon veya hayvan besleme ile ilgili sorularınızı sorabilirsiniz.</p>
        </div>
      `;
      return;
    }

    messages.forEach(msg => {
      const msgClass = msg.role === 'user' ? 'ai-message-user' : 'ai-message-assistant';
      let formattedContent = '';
      if (msg.role === 'assistant') {
        formattedContent = DOMPurify.sanitize(marked.parse(msg.content));
      } else {
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
      chatHistoryEl.insertAdjacentHTML('beforeend', html);
    });
    
    chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
  };

  const sendMessage = async () => {
    const text = chatInput.value.trim();
    if (!text) return;

    let activeChat = chats.find(c => c.id === activeChatId);
    if (!activeChat) {
      startNewChat();
      activeChat = chats[0];
    }

    // İlk mesajsa başlık oluştur
    if (!activeChat.title || activeChat.title === 'Yeni Sohbet') {
      activeChat.title = text.length > 25 ? text.substring(0, 25) + '...' : text;
    }

    activeChat.messages.push({ role: 'user', content: text });
    await saveAiChat(activeChat); // Hemen kaydet
    
    chatInput.value = '';
    renderSidebar();
    renderHistory();
    
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

      const response = await askGemini(text, systemPrompt);

      const typingEl = document.getElementById(typingId);
      if (typingEl) typingEl.remove();

      activeChat.messages.push({ role: 'assistant', content: response });
      await saveAiChat(activeChat); // IndexedDB + Supabase'e kaydet
      
      renderSidebar();
      renderHistory();

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

  newChatBtn.addEventListener('click', () => {
    startNewChat();
    renderSidebar();
    renderHistory();
    chatInput.focus();
    if (window.innerWidth <= 768) closeSidebar();
  });

  sendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Initial render
  renderSidebar();
  renderHistory();
}

function startNewChat() {
  const newIdStr = newId();
  const newChat = { id: newIdStr, title: 'Yeni Sohbet', messages: [] };
  chats.unshift(newChat);
  activeChatId = newIdStr;
}
