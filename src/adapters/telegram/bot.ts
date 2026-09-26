import { Bot, Context } from 'grammy';
import { PROBE_CONSTANTS } from '../../config/constants.js';
import { InvestigationManager, investigationManager as defaultManager } from '../../core/investigation/manager.js';
import { InvestigationOrchestrator } from '../../core/investigation/orchestrator.js';
import { logger } from '../../utils/logger.js';
import { formatInvestigationResult, splitTelegramMessage } from './formatter.js';
import { TelegramKeyboards } from './keyboard.js';
import { TelegramMessages } from './messages.js';
import { detectChainOnlyInput, extractTokenCandidate, isOnlyTokenInput } from './token-extractor.js';
import { ITokenResolver, defaultTokenResolver } from '../../core/token/resolver.js';

export interface TelegramBotDependencies {
  botToken: string;
  orchestrator: InvestigationOrchestrator;
  investigationManager?: InvestigationManager;
  tokenResolver?: ITokenResolver;
}

/**
 * ProbeTelegramBot is a thin transport adapter over InvestigationOrchestrator.
 * It translates incoming Telegram commands, callback buttons, and messages into
 * bounded InvestigationTurnRequest calls and formats the resulting SynthesisResult.
 */
export class ProbeTelegramBot {
  private readonly bot: Bot;
  private readonly orchestrator: InvestigationOrchestrator;
  private readonly investigationManager: InvestigationManager;
  private readonly tokenResolver: ITokenResolver;

  constructor(deps: TelegramBotDependencies) {
    this.bot = new Bot(deps.botToken);
    this.orchestrator = deps.orchestrator;
    this.investigationManager = deps.investigationManager ?? defaultManager;
    this.tokenResolver = deps.tokenResolver ?? defaultTokenResolver;

    this.registerCommands();
    this.registerCallbacks();
    this.registerMessageHandlers();
  }

  private registerCommands(): void {
    // /start - Welcome & token-first onboarding prompt (no buttons)
    this.bot.command('start', async (ctx: Context) => {
      await ctx.reply(TelegramMessages.welcome());
    });

    // /help - Guide on PROBE capabilities
    this.bot.command('help', async (ctx: Context) => {
      await ctx.reply(TelegramMessages.help(), {
        parse_mode: 'Markdown',
      });
    });

    // /new - Start a fresh investigation, clearing current chat context (no buttons)
    this.bot.command('new', async (ctx: Context) => {
      const chatId = ctx.chat?.id;
      if (chatId) {
        this.investigationManager.clearActiveInvestigation(chatId);
      }
      await ctx.reply(TelegramMessages.newInvestigation());
    });
  }

  private registerCallbacks(): void {
    // Investigation shortcut buttons (Requirement 2)
    this.bot.callbackQuery('shortcut_whats_happening', async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.handleUserQuestion(ctx, "What's happening?");
    });

    this.bot.callbackQuery('shortcut_who_buying', async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.handleUserQuestion(ctx, 'Who is buying?');
    });

    this.bot.callbackQuery('shortcut_who_selling', async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.handleUserQuestion(ctx, 'Who is selling?');
    });

    this.bot.callbackQuery('shortcut_biggest_txs', async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.handleUserQuestion(ctx, 'Biggest transactions');
    });

    // Backwards-compatibility for older action buttons
    this.bot.callbackQuery('prompt_activity_changing', async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.handleUserQuestion(ctx, 'Why is activity changing?');
    });

    this.bot.callbackQuery('prompt_who_accumulating', async (ctx) => {
      await ctx.answerCallbackQuery();
      await this.handleUserQuestion(ctx, 'Who is accumulating?');
    });
  }

  private registerMessageHandlers(): void {
    this.bot.on('message:text', async (ctx: Context) => {
      const text = ctx.message?.text?.trim();
      if (!text || text.startsWith('/')) {
        return;
      }
      await this.handleUserQuestion(ctx, text);
    });
  }

  /**
   * Routes text inputs and button clicks through InvestigationOrchestrator.
   * Enforces token-first UX and maintains chat-to-investigation session mapping.
   */
  public async handleUserQuestion(ctx: Context, text: string): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    // Use Telegram user identity only as an adapter-level session key; never as a wallet address
    const userId = String(ctx.from?.id ?? chatId);

    logger.info('Telegram user query received', {
      chatId,
      userId,
      queryLength: trimmed.length,
    });

    try {
      // 1. Check for chain-only input (Requirement 4)
      const chainName = detectChainOnlyInput(trimmed);
      if (chainName) {
        await ctx.reply(TelegramMessages.chainOnly(chainName));
        return;
      }

      // 2. Extract candidate token identifier and inspect active session context
      const activeInv = this.investigationManager.getActiveInvestigationByChatId(chatId);
      const tokenCandidate = extractTokenCandidate(trimmed);

      // Check if this input was intended strictly as a token entry
      const isStandaloneToken = isOnlyTokenInput(trimmed, tokenCandidate);

      if (isStandaloneToken) {
        if (!tokenCandidate || tokenCandidate.type === 'invalid_address') {
          await ctx.reply(TelegramMessages.unresolvedToken());
          return;
        }

        // Asynchronously resolve candidate via Nansen multi-strategy token resolution
        const resolution = await this.tokenResolver.resolveDetailed(tokenCandidate);

        if (resolution.status === 'INVALID_ADDRESS') {
          await ctx.reply(TelegramMessages.unresolvedToken());
          return;
        }

        if (resolution.status === 'NOT_FOUND') {
          // Syntactically valid address or identifier, but not indexed in Nansen data
          await ctx.reply(TelegramMessages.tokenNotIndexed());
          return;
        }

        if (resolution.status === 'AMBIGUOUS_SYMBOL') {
          await ctx.reply(
            TelegramMessages.ambiguousSymbol(
              tokenCandidate.identifier,
              resolution.availableChains ?? []
            )
          );
          return;
        }

        const resolvedToken = resolution.token;
        if (!resolvedToken) {
          await ctx.reply(TelegramMessages.unresolvedToken());
          return;
        }

        // Token resolved! Establish active investigation context for this chat
        this.investigationManager.clearActiveInvestigation(chatId);
        this.investigationManager.createInvestigation({
          telegramChatId: chatId,
          token: resolvedToken,
        });

        await ctx.reply(TelegramMessages.tokenSelected(resolvedToken.symbol), {
          reply_markup: TelegramKeyboards.tokenShortcuts(),
        });
        return;
      }

      // 3. User sent an investigation question or shortcut prompt
      // Determine effective token: explicitly mentioned in question, or inherited from active context
      let effectiveToken = activeInv?.token;
      let investigationId = activeInv?.id;

      if (tokenCandidate) {
        const resolved = await this.tokenResolver.resolve(tokenCandidate);
        if (
          resolved &&
          (!activeInv ||
            resolved.symbol !== activeInv.token.symbol ||
            resolved.address.toLowerCase() !== activeInv.token.address.toLowerCase())
        ) {
          // User switched or introduced a new token in their question
          this.investigationManager.clearActiveInvestigation(chatId);
          const newInv = this.investigationManager.createInvestigation({
            telegramChatId: chatId,
            token: resolved,
            initialQuestion: trimmed,
          });
          effectiveToken = resolved;
          investigationId = newInv.id;
        }
      }

      if (!effectiveToken) {
        // No active token and no token in query (Requirement 10)
        await ctx.reply(TelegramMessages.missingToken());
        return;
      }

      // 4. Delegate execution directly to InvestigationOrchestrator
      const turnResult = await this.orchestrator.executeTurn({
        investigationId,
        chatId,
        question: trimmed,
        token: effectiveToken,
        userId,
      });

      // 5. Format response preserving epistemic structure
      const formattedResponse = formatInvestigationResult(turnResult);

      // 6. Split long messages safely at section/paragraph boundaries
      const maxLen = PROBE_CONSTANTS.TELEGRAM_MAX_MESSAGE_LENGTH - 96;
      const chunks = splitTelegramMessage(formattedResponse, maxLen);

      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } catch (err) {
      // Safe fallback that never leaks internal stack traces or API keys
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Unexpected error in Telegram message handling', {
        chatId,
        error: errMsg,
      });

      await ctx.reply('⚠️ An unexpected issue occurred during the investigation. Please try again.');
    }
  }

  public getBot(): Bot {
    return this.bot;
  }
}

export function createTelegramBot(deps: TelegramBotDependencies): ProbeTelegramBot {
  return new ProbeTelegramBot(deps);
}

export async function startTelegramBot(bot: ProbeTelegramBot): Promise<void> {
  await bot.getBot().start();
}
