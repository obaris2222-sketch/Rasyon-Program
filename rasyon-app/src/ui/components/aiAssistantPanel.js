import { state } from '../app.js';
import { t } from '../i18n.js';
import { askGemini } from '../../core/aiService.js';
import { showToast } from '../utils.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { newId } from '../../data/uuid.js';
import { getAiChats, saveAiChat, deleteAiChat, rationGetAll, animalProfileGetAll, observationGetAll, getActiveFarm, feedGetAll, herdGroupGetAll, priceHistoryGetAll } from '../../data/db.js';
import { getSettings } from '../../data/settings.js';

// ─── Sabit Limitler ───────────────────────────────────────────────────────────
const MAX_HISTORY_MESSAGES = 10; // API'ya gönderilecek maksimum önceki mesaj sayısı
const MAX_RATIONS = 5;           // Bağlama dahil edilecek son rasyon sayısı
const MAX_OBSERVATIONS_PER_PROFILE = 3; // Her profil için maksimum son gözlem sayısı

let chats = [];
let activeChatId = null;

// ─── Zengin Bağlam Verisi Oluşturucu ─────────────────────────────────────────

/**
 * IndexedDB'den güncel verileri çekerek AI'ın kullanacağı zengin bağlam nesnesini oluşturur.
 * Her mesaj gönderiminde çalışır — veriler her zaman güncel kalır.
 */
async function buildContextData(includeData = false) {
  try {
    if (!includeData) {
      return {
        currentSession: null,
        rationHistory: [],
        animalProfiles: [],
        recentObservations: [],
        farm: {}
      };
    }

    const [allRations, allProfiles, allObservations, activeFarm, allFeeds, allHerdGroups, allPrices] = await Promise.all([
      rationGetAll().catch(() => []),
      animalProfileGetAll().catch(() => []),
      observationGetAll().catch(() => []),
      getActiveFarm().catch(() => null),
      feedGetAll().catch(() => []),
      herdGroupGetAll().catch(() => []),
      priceHistoryGetAll().catch(() => []),
    ]);

    const settings = getSettings();

    // Tüm rasyonlar — son 5 rasyon ile sınırla, hammaddeler, besin bileşimi ve IIS/Relaxation dahil
    const rationHistory = allRations
      .sort((a, b) => new Date(b.savedAt || b.createdAt || 0) - new Date(a.savedAt || a.createdAt || 0))
      .slice(0, 5)
      .map(r => ({
        name: r.name || 'İsimsiz Rasyon',
        savedAt: r.savedAt || r.createdAt || r.updatedAt || null,
        status: r.result?.statusName ?? null,
        totalCost: r.result?.totalCost ?? r.result?.cost ?? null,
        // Hayvan profili snapshot'u
        animal: r.animal ? {
          breed: r.animal.breed || null,
          bw: r.animal.bw || null,
          milkYield: r.animal.milkYield || null,
          milkFat: r.animal.milkFat || null,
          milkProtein: r.animal.milkProtein || null,
          parity: r.animal.parity || null,
          lactationStage: r.animal.lactationStage || null,
          dim: r.animal.dim || null,
        } : null,
        // Kullanılan hammaddeler (solver'ın items dizisinden)
        ingredients: (r.result?.items || []).map(item => ({
          name: item.name || item.tr_name || item.en_name || null,
          dmKg: item.dmKg ?? null,   // KM kg/gün
          asFedKg: item.asFedKg ?? null,   // Yaş madde kg/gün
          pctDm: item.pctDm ?? null,   // KM içindeki pay %
          costPerDay: item.costPerDay ?? null,  // Günlük maliyet
        })),
        // Tam besin madde bileşimi (solver'ın composition nesnesinden)
        composition: r.result?.composition ? {
          nel_mcal: r.result.composition.nel_mcal ?? null,
          cp_g: r.result.composition.cp_g ?? null,
          cp_pct: r.result.composition.cp_pct ?? null,
          mp_g: r.result.composition.mp_g ?? null,
          rup_g: r.result.composition.rup_g ?? null,
          rdp_g: r.result.composition.rdp_g ?? null,
          ndf_pct: r.result.composition.ndf_pct ?? null,
          adf_pct: r.result.composition.adf_pct ?? null,
          nfc_pct: r.result.composition.nfc_pct ?? null,
          starch_pct: r.result.composition.starch_pct ?? null,
          fat_pct: r.result.composition.fat_pct ?? null,
          ash_pct: r.result.composition.ash_pct ?? null,
          ca_g: r.result.composition.ca_g ?? null,
          p_g: r.result.composition.p_g ?? null,
          mg_g: r.result.composition.mg_g ?? null,
          k_g: r.result.composition.k_g ?? null,
          na_g: r.result.composition.na_g ?? null,
          dcad_meq: r.result.composition.dcad_meq ?? null,
        } : null,
        // Hedef gereksinimler
        requirements: r.result?.requirements ? {
          nel: r.result.requirements.nel ?? null,
          mp: r.result.requirements.mp ?? null,
        } : null,
        milkFever: r.result?.milkFever ?? null,
        infeasibilityDiagnosis: r.result?.infeasibilityDiagnosis ?? null,
        relaxation: r.result?.relaxation ?? null,
      }));


    // Tüm hayvan profilleri — özet alanlar
    const animalProfiles = allProfiles.map(p => ({
      name: p.name || 'İsimsiz Profil',
      breed: p.breed || null,
      bw: p.bw || null,
      milkYield: p.milkYield || null,
      milkFat: p.milkFat || null,
      milkProtein: p.milkProtein || null,
      parity: p.parity || null,
      lactationStage: p.lactationStage || null,
      dim: p.dim || null,
    }));

    // Sürü Grupları
    const herdGroups = allHerdGroups.map(g => ({
      name: g.name || 'İsimsiz Grup',
      headCount: g.headCount || 0,
      profileId: g.profileId || null,
      notes: g.notes || null,
    }));

    // Özel (Kullanıcı) Yemleri
    const userFeeds = allFeeds.filter(f => f.source === 'user' || /^(user_|custom_)/.test(f.id || '')).map(f => {
      // Yalnızca anlamlı değerleri tut (gereksiz null'ları temizle)
      const feedData = { name: f.name, category: f.category };
      for (const key in f) {
        if (key !== 'id' && key !== 'name' && key !== 'category' && key !== 'source' && key !== 'farmId' && key !== 'updatedAt' && key !== 'deletedAt' && key !== '_dirty' && f[key] !== null && f[key] !== undefined && f[key] !== 0 && f[key] !== '') {
          feedData[key] = f[key];
        }
      }
      return feedData;
    });

    // En Güncel Fiyatlar (Sadece Son Fiyatları Alır)
    const latestPricesMap = new Map();
    allPrices.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)); // Eskiden yeniye sırala
    for (const p of allPrices) {
      if (p.feedId) {
        latestPricesMap.set(p.feedId, {
          feedName: p.feedName || 'Bilinmeyen Yem',
          price: p.price,
          date: p.date,
        });
      }
    }
    const currentPrices = Array.from(latestPricesMap.values());

    // Saha Gözlemleri — Her profil için son 3 gözlem
    const obsByProfile = {};
    for (const o of allObservations) {
      const pid = o.profileId || 'unknown';
      if (!obsByProfile[pid]) obsByProfile[pid] = [];
      obsByProfile[pid].push(o);
    }
    const recentObservations = [];
    for (const pid in obsByProfile) {
      const sorted = obsByProfile[pid].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      recentObservations.push(...sorted.slice(0, MAX_OBSERVATIONS_PER_PROFILE).map(o => ({
        date: o.date || null,
        profileId: o.profileId || null,
        milkYield: o.milkYield ?? null,
        milkFat: o.milkFat ?? null,
        milkProtein: o.milkProtein ?? null,
        bcs: o.bcs ?? null,
        dmiActual: o.dmiActual ?? null,
        notes: o.notes || null,
      })));
    }

    // Anlık oturum verisi
    const currentSession = {
      animal: state.animal,
      feeds: (state.selectedFeeds || []).map(f => ({
        name: f.name,
        category: f.category,
        amountKg: f.val || 0,
      })),
      rationResult: state.rationResult ? {
        dmi: state.rationResult.dmi,
        nel: state.rationResult.nel,
        cp: state.rationResult.cp,
        ndf: state.rationResult.ndf,
        cost: state.rationResult.cost,
        statusName: state.rationResult.statusName,
        composition: state.rationResult.composition ? {
          nel_mcal: state.rationResult.composition.nel_mcal ?? null,
          cp_g: state.rationResult.composition.cp_g ?? null,
          cp_pct: state.rationResult.composition.cp_pct ?? null,
          mp_g: state.rationResult.composition.mp_g ?? null,
          rup_g: state.rationResult.composition.rup_g ?? null,
          rdp_g: state.rationResult.composition.rdp_g ?? null,
          ndf_pct: state.rationResult.composition.ndf_pct ?? null,
          adf_pct: state.rationResult.composition.adf_pct ?? null,
          nfc_pct: state.rationResult.composition.nfc_pct ?? null,
          starch_pct: state.rationResult.composition.starch_pct ?? null,
          fat_pct: state.rationResult.composition.fat_pct ?? null,
          ash_pct: state.rationResult.composition.ash_pct ?? null,
          ca_g: state.rationResult.composition.ca_g ?? null,
          p_g: state.rationResult.composition.p_g ?? null,
          mg_g: state.rationResult.composition.mg_g ?? null,
          k_g: state.rationResult.composition.k_g ?? null,
          na_g: state.rationResult.composition.na_g ?? null,
          dcad_meq: state.rationResult.composition.dcad_meq ?? null,
        } : null,
        requirements: state.rationResult.requirements ? {
          nel: state.rationResult.requirements.nel ?? null,
          mp: state.rationResult.requirements.mp ?? null,
        } : null,
        infeasibilityDiagnosis: state.rationResult.infeasibilityDiagnosis ?? null,
        relaxation: state.rationResult.relaxation ?? null,
      } : null,
    };

    return {
      currentSession,
      rationHistory,
      animalProfiles,
      herdGroups,
      userFeeds,
      currentPrices,
      recentObservations,
      settings: {
        scienceSystem: settings.science?.system || null,
        dmiMethod: settings.science?.dmiMethod || null,
        calcMode: settings.science?.calcMode || null,
        units: settings.units || null,
        defaults: settings.defaults || null,
      },
      farm: {
        name: activeFarm?.name || settings.farm?.name || null,
        address: activeFarm?.address || settings.farm?.address || null,
        advisor: activeFarm?.advisor || settings.farm?.advisor || null,
        herdSize: state.economics?.herdSize || null,
      },
    };
  } catch (err) {
    console.warn('buildContextData hatası (kısmi bağlam kullanılacak):', err);
    // Fallback: sadece anlık oturum
    return {
      currentSession: {
        animal: state.animal,
        feeds: (state.selectedFeeds || []).map(f => ({ name: f.name, category: f.category, amountKg: f.val || 0 })),
        rationResult: state.rationResult ? { dmi: state.rationResult.dmi, nel: state.rationResult.nel, cp: state.rationResult.cp, cost: state.rationResult.cost } : null,
      },
      rationHistory: [],
      animalProfiles: [],
      recentObservations: [],
      farm: {},
    };
  }
}

// ─── Ana Panel Renderlayıcı ───────────────────────────────────────────────────

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
    <style>
      .custom-toggle-switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
      .custom-toggle-switch input[type="checkbox"] { display: none; }
      .custom-toggle-switch-bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: #e8e8e8; border-radius: 20px; transition: all 0.3s ease-in-out; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1); }
      .custom-toggle-switch-handle { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background-color: #fff; border-radius: 50%; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2); transition: transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1); }
      .custom-toggle-switch input[type="checkbox"]:checked ~ .custom-toggle-switch-bg { background-color: #0d6efd; }
      .custom-toggle-switch input[type="checkbox"]:checked ~ .custom-toggle-switch-bg .custom-toggle-switch-handle { transform: translateX(20px); }
    </style>
    <div class="ai-panel">
      <!-- SOL MENÜ: GEÇMİŞ SOHBETLER (Mobilde Bottom Sheet) -->
      <div class="ai-sidebar-overlay" id="aiSidebarOverlay"></div>
      <div class="ai-sidebar" id="aiSidebar">
        <div class="ai-sidebar-header d-flex d-md-none align-items-center mb-3" style="width: 100%; justify-content: space-between;">
          <h4 class="m-0 d-flex align-items-center gap-2" style="font-weight: bold;"><i class="ti ti-message-circle-2"></i> Sohbetler</h4>
          <button id="aiCloseSidebarBtn" class="btn btn-icon p-0" style="background: transparent; border:none; color: var(--text-primary);"><i class="ti ti-x" style="font-size: 1.5rem;"></i></button>
        </div>
        <button id="aiNewChatBtn" class="btn btn-primary w-100 mb-3" style="margin-bottom: 1rem; background-color: #1c5237; border-color: #1c5237; border-radius: 1rem; padding: 0.75rem;">
          <i class="ti ti-plus"></i> ${t('ai.new_chat')}
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
        
        <div class="ai-chat-history" id="aiChatHistory">
          <!-- Messages will appear here -->
        </div>
        
        <div class="ai-chat-input-wrapper" style="flex-direction: column; align-items: stretch;">
          <div class="mb-2 px-2">
            <label class="m-0 d-flex align-items-center gap-2" style="cursor: pointer; user-select: none;" title="${t('ai.add_farm_data')}">
              <div class="custom-toggle-switch">
                <input type="checkbox" id="aiIncludeDataToggle">
                <div class="custom-toggle-switch-bg">
                  <div class="custom-toggle-switch-handle"></div>
                </div>
              </div>
              <span style="font-size: 0.85rem; color: var(--text-secondary); padding-top: 2px;">${t('ai.add_farm_data')}</span>
            </label>
          </div>
          <div style="display: flex; gap: 0.5rem; width: 100%;">
            <textarea id="aiChatInput" placeholder="${t('ai.placeholder')}" rows="2" style="flex:1;"></textarea>
            <button id="aiSendBtn" class="btn btn-primary" title="${t('ai.send')}">
              <i class="ti ti-send"></i>
            </button>
          </div>
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

      let dateHtml = '';
      if (chat.updatedAt) {
        const d = new Date(chat.updatedAt);
        const dateStr = d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        dateHtml = `<span style="font-size: 0.7rem; opacity: 0.6; margin-left: 1.5rem; white-space: nowrap;">${dateStr} - ${timeStr}</span>`;
      }

      const html = `
        <div class="ai-chat-item ${isActive}" data-id="${chat.id}">
          <div style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
            <div class="ai-chat-item-title"><i class="ti ti-message-circle"></i> <span>${title}</span></div>
            ${dateHtml}
          </div>
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
    const bannersHtml = `
      <div class="ai-disclaimer" style="margin: 0; flex-shrink: 0;">
        <i class="ti ti-alert-triangle"></i>
        <span>${t('ai.disclaimer')}</span>
      </div>
      <div class="ai-context-info" id="aiContextInfo" style="margin: 0; flex-shrink: 0;">
        <i class="ti ti-brain"></i>
        <span>${t('ai.contextInfo')}</span>
      </div>
    `;

    chatHistoryEl.innerHTML = bannersHtml;
    const activeChat = chats.find(c => c.id === activeChatId);
    const messages = activeChat ? (activeChat.messages || []) : [];

    if (messages.length === 0) {
      chatHistoryEl.insertAdjacentHTML('beforeend', `
        <div class="ai-empty-state">
          <i class="ti ti-sparkles"></i>
          <p>${t('ai.welcome_title')}</p>
          <p style="font-size:0.8rem; opacity:0.7;">${t('ai.welcome_subtitle')}</p>
        </div>
      `);
      return;
    }

    messages.forEach(msg => {
      let msgClass = msg.role === 'user' ? 'ai-message-user' : 'ai-message-assistant';
      if (msg.isError) msgClass += ' ai-message-error';

      let formattedContent = '';
      if (msg.role === 'assistant') {
        formattedContent = DOMPurify.sanitize(marked.parse(msg.content));
      } else {
        const div = document.createElement('div');
        div.innerText = msg.content;
        formattedContent = div.innerHTML.replace(/\n/g, '<br/>');
      }

      let timeHtml = '';
      if (msg.timestamp) {
        const d = new Date(msg.timestamp);
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timeHtml = `<div style="font-size: 0.7rem; opacity: 0.6; text-align: right; margin-top: 6px;">${timeStr}</div>`;
      }

      const html = `
        <div class="ai-message ${msgClass}">
          <div class="ai-message-content markdown-body">
            ${formattedContent}
            ${timeHtml}
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
    if (!activeChat.title || activeChat.title === t('ai.new_chat')) {
      activeChat.title = text.length > 25 ? text.substring(0, 25) + '...' : text;
    }

    activeChat.updatedAt = Date.now();
    activeChat.messages.push({ role: 'user', content: text, timestamp: Date.now() });
    await saveAiChat(activeChat);

    chatInput.value = '';
    renderSidebar();
    renderHistory();

    // Show typing indicator
    const typingId = 'typing-indicator';
    const typingHtml = `
      <div class="ai-message ai-message-assistant" id="${typingId}">
        <div class="ai-message-content typing" style="display: flex; align-items: center; gap: 0.5rem; opacity: 0.7;">
          <i class="ti ti-loader ti-spin" style="font-size: 1.2rem;"></i>
          <span style="font-style: italic;">${t('ai.assistant_thinking')}</span>
        </div>
      </div>
    `;
    chatHistoryEl.insertAdjacentHTML('beforeend', typingHtml);
    chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;

    sendBtn.disabled = true;

    try {
      const includeData = document.getElementById('aiIncludeDataToggle')?.checked || false;
      // ── 1. Zengin bağlam verisini async olarak derle ────────────────────
      const contextData = await buildContextData(includeData);

      // ── 2. System prompt'u bağlamla doldur ─────────────────────────────
      const systemPromptTemplate = t('ai.systemPrompt');
      const systemPrompt = systemPromptTemplate.replace(
        '{{data}}',
        JSON.stringify(contextData, null, 2)
      );

      // ── 3. Konuşma geçmişini hazırla (son MAX_HISTORY_MESSAGES mesaj) ──
      // Yeni kullanıcı mesajı zaten activeChat.messages'e eklendi, onu dahil et
      const allMessages = activeChat.messages;
      const historySlice = allMessages.length > MAX_HISTORY_MESSAGES
        ? allMessages.slice(-MAX_HISTORY_MESSAGES)
        : allMessages;

      // ── 4. Groq'a gönderilecek tam mesaj dizisi ─────────────────────────
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...historySlice.map(m => ({ role: m.role, content: m.content })),
      ];

      const response = await askGemini(apiMessages);

      const typingEl = document.getElementById(typingId);
      if (typingEl) typingEl.remove();

      activeChat.updatedAt = Date.now();
      activeChat.messages.push({ role: 'assistant', content: response, timestamp: Date.now() });
      await saveAiChat(activeChat);

      renderSidebar();
      renderHistory();

    } catch (error) {
      console.error(error);
      const typingEl = document.getElementById(typingId);
      if (typingEl) typingEl.remove();

      // Hata mesajını sohbet ekranında göster
      const errorMessage = "⚠️ Sunucu ile iletişim kurulamadı veya bir hata oluştu. Lütfen tekrar deneyin. Detay: " + error.message;
      activeChat.updatedAt = Date.now();
      activeChat.messages.push({ role: 'assistant', content: errorMessage, isError: true, timestamp: Date.now() });
      await saveAiChat(activeChat);

      renderSidebar();
      renderHistory();

      showToast(t('ai.error') || "Bir hata oluştu", "error");
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
  const newChat = { id: newIdStr, title: t('ai.new_chat'), messages: [], updatedAt: Date.now() };
  chats.unshift(newChat);
  activeChatId = newIdStr;
}
