(() => {
  'use strict';
  const digits = value => String(value || '').replace(/\D/g, '');
  const chatIdFromCurrentChat = (chat, visiblePhone) => {
    const id = typeof chat?.chat_id === 'string' ? chat.chat_id.trim() : '';
    const phone = digits(visiblePhone);
    const selectedPhone = digits(chat?.sender_mobile);
    if (!id || !phone || phone.length < 8 || phone.length > 15) return null;
    if (selectedPhone && selectedPhone !== phone) return null;
    return id;
  };
  const api = Object.freeze({ chatIdFromCurrentChat });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SaleMaxInboxFollowUpChatId = api;
})();
