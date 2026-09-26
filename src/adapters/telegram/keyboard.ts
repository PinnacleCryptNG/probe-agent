import { InlineKeyboard } from 'grammy';

export const TelegramKeyboards = {
  /**
   * Investigation shortcut buttons displayed after a token has been selected.
   */
  tokenShortcuts(): InlineKeyboard {
    return new InlineKeyboard()
      .text("What's happening?", 'shortcut_whats_happening')
      .row()
      .text('Who is buying?', 'shortcut_who_buying')
      .row()
      .text('Who is selling?', 'shortcut_who_selling')
      .row()
      .text('Biggest transactions', 'shortcut_biggest_txs');
  },

  /**
   * Initial suggestion keyboard kept for backwards compatibility.
   */
  exampleQuestions(): InlineKeyboard {
    return new InlineKeyboard()
      .text('Why is activity changing?', 'prompt_activity_changing')
      .row()
      .text('Who is accumulating?', 'prompt_who_accumulating');
  },

  investigationActions(): InlineKeyboard {
    return new InlineKeyboard()
      .text('📁 View Evidence', 'action_view_evidence')
      .text('⏱️ Timeline', 'action_view_timeline')
      .row()
      .text('⚔️ Challenge Finding', 'action_challenge');
  },
};
