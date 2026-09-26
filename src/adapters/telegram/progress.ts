import { Context } from 'grammy';
import { InvestigationProgressStage } from '../../core/investigation/types.js';
import { logger } from '../../utils/logger.js';

export interface TelegramProgressTrackerOptions {
  chatId: number | string;
  tokenSymbol: string;
  ctx: Context;
  botApi?: {
    editMessageText: (chatId: number | string, messageId: number, text: string) => Promise<unknown>;
  };
}

/**
 * TelegramProgressTracker manages the lifecycle of the single temporary Telegram
 * investigation progress message without impacting core investigation logic.
 *
 * Lifecycle:
 * 1. start() -> sends "🔎 Investigating {SYMBOL}..."
 * 2. updateStage('token_identified') -> edits to:
 *    🔎 Investigating {SYMBOL}...
 *    ✓ Token identified
 * 3. updateStage('activity_analyzed') -> edits to:
 *    🔎 Investigating {SYMBOL}...
 *    ✓ Token identified
 *    ✓ On-chain activity analyzed
 * 4. updateStage('building_report') -> edits to:
 *    🔎 Investigating {SYMBOL}...
 *    ✓ Token identified
 *    ✓ On-chain activity analyzed
 *    ⏳ Building evidence report...
 * 5. finish(chunks) -> replaces progress message with final result (chunk 0)
 *    and sends any remaining chunks as new messages.
 * 6. fail(fallbackText) -> replaces progress message with sanitized error message.
 */
export class TelegramProgressTracker {
  private readonly chatId: number | string;
  private readonly tokenSymbol: string;
  private readonly ctx: Context;
  private readonly botApi?: {
    editMessageText: (chatId: number | string, messageId: number, text: string) => Promise<unknown>;
  };

  private progressMessageId?: number;
  private lastRenderedText?: string;
  private currentStage?: InvestigationProgressStage;
  private isFinalized = false;

  constructor(options: TelegramProgressTrackerOptions) {
    this.chatId = options.chatId;
    this.tokenSymbol = options.tokenSymbol;
    this.ctx = options.ctx;
    this.botApi = options.botApi;
  }

  /**
   * Sends the initial temporary progress message: "🔎 Investigating {SYMBOL}..."
   */
  public async start(): Promise<void> {
    const initialText = this.formatProgress(undefined);
    try {
      const sent = await this.ctx.reply(initialText);
      if (sent && typeof sent === 'object' && 'message_id' in sent) {
        this.progressMessageId = (sent as { message_id: number }).message_id;
      }
      this.lastRenderedText = initialText;
    } catch (err) {
      logger.warn('Failed to send initial Telegram progress message', {
        chatId: this.chatId,
        error: String(err),
      });
    }
  }

  /**
   * Updates the single Telegram message as the investigation advances.
   */
  public async updateStage(stage: InvestigationProgressStage): Promise<void> {
    if (this.isFinalized) return;
    this.currentStage = stage;
    const newText = this.formatProgress(stage);
    await this.editText(newText);
  }

  /**
   * Edits/replaces the temporary progress message with the final formatted investigation report.
   * If the report spans multiple chunks (split at paragraph boundaries), the first chunk replaces
   * the progress message, and subsequent chunks are sent via ctx.reply.
   */
  public async finish(chunks: string[]): Promise<void> {
    if (this.isFinalized) return;
    this.isFinalized = true;

    if (chunks.length === 0) return;

    const firstChunk = chunks[0];
    const edited = await this.editText(firstChunk);

    if (!edited) {
      try {
        await this.ctx.reply(firstChunk);
      } catch (replyErr) {
        logger.error('Failed to send final investigation response chunk', {
          chatId: this.chatId,
          error: String(replyErr),
        });
      }
    }

    for (let i = 1; i < chunks.length; i++) {
      try {
        await this.ctx.reply(chunks[i]);
      } catch (replyErr) {
        logger.error('Failed to send supplementary response chunk', {
          chatId: this.chatId,
          chunkIndex: i,
          error: String(replyErr),
        });
      }
    }
  }

  /**
   * Replaces the temporary progress message with a sanitized error message upon failure.
   */
  public async fail(fallbackText: string): Promise<void> {
    if (this.isFinalized) return;
    this.isFinalized = true;

    const edited = await this.editText(fallbackText);
    if (!edited) {
      try {
        await this.ctx.reply(fallbackText);
      } catch (replyErr) {
        logger.error('Failed to send fallback error reply', {
          chatId: this.chatId,
          error: String(replyErr),
        });
      }
    }
  }

  /**
   * Internal helper to edit the progress message.
   * Returns true if edit succeeded, false otherwise.
   */
  private async editText(text: string): Promise<boolean> {
    if (!this.progressMessageId) {
      return false;
    }
    if (this.lastRenderedText === text) {
      return true; // No-op
    }

    try {
      if (this.ctx.api?.editMessageText) {
        await this.ctx.api.editMessageText(this.chatId, this.progressMessageId, text);
      } else if (this.botApi?.editMessageText) {
        await this.botApi.editMessageText(this.chatId, this.progressMessageId, text);
      } else {
        return false;
      }
      this.lastRenderedText = text;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('message is not modified')) {
        this.lastRenderedText = text;
        return true;
      }
      logger.warn('Failed to edit Telegram progress message', {
        chatId: this.chatId,
        messageId: this.progressMessageId,
        error: msg,
      });
      return false;
    }
  }

  /**
   * Formats the progress checklist text according to the current stage.
   */
  public formatProgress(stage?: InvestigationProgressStage): string {
    const lines = [`🔎 Investigating ${this.tokenSymbol}...`];
    if (stage === 'token_identified') {
      lines.push('✓ Token identified');
    } else if (stage === 'activity_analyzed') {
      lines.push('✓ Token identified');
      lines.push('✓ On-chain activity analyzed');
    } else if (stage === 'building_report') {
      lines.push('✓ Token identified');
      lines.push('✓ On-chain activity analyzed');
      lines.push('⏳ Building evidence report...');
    }
    return lines.join('\n');
  }

  public getMessageId(): number | undefined {
    return this.progressMessageId;
  }

  public getCurrentStage(): InvestigationProgressStage | undefined {
    return this.currentStage;
  }

  public isDone(): boolean {
    return this.isFinalized;
  }
}
