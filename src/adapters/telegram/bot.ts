import { Bot, Context } from 'grammy';
import { PROBE_CONSTANTS } from '../../config/constants.js';
import { InvestigationManager, investigationManager as defaultManager } from '../../core/investigation/manager.js';
import { InvestigationOrchestrator } from '../../core/investigation/orchestrator.js';
import { logger } from '../../utils/logger.js';
import { formatInvestigationResult, splitTelegramMessage } from './formatter.js';
import { TelegramKeyboards } from './keyboard.js';
import { TelegramMessages } from './messages.js';
import { extractTokenCandidate, isOnlyTokenInput } from './token-extractor.js';
import { detectChainOnlyInput } from '../../core/token/detector.js';
import { ITokenResolver, defaultTokenResolver } from '../../core/token/resolver.js';
import { ITargetResolver, TargetResolver, InvestigationTarget } from '../../core/target/index.js';
import { getNativeAssetForTicker } from '../../core/target/native-assets.js';
import { getChainDisplayName } from '../../core/target/chain-resolver.js';
import { truncateAddress } from '../../core/synthesis/formatting.js';
import { profiler } from '../../utils/profiler.js';
import { TelegramProgressTracker } from './progress.js';

export interface TelegramBotDependencies {
  botToken: string;
  orchestrator: InvestigationOrchestrator;
  investigationManager?: InvestigationManager;
  tokenResolver?: ITokenResolver;
  targetResolver?: ITargetResolver;
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
  private readonly targetResolver: ITargetResolver;

  constructor(deps: TelegramBotDependencies) {
    this.bot = new Bot(deps.botToken);
    this.orchestrator = deps.orchestrator;
    this.investigationManager = deps.investigationManager ?? defaultManager;
    this.tokenResolver = deps.tokenResolver ?? defaultTokenResolver;
    this.targetResolver =
      deps.targetResolver ?? new TargetResolver({ tokenResolver: this.tokenResolver });

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
      profiler.startRequest();
      (ctx as { _updateReceivedAt?: number })._updateReceivedAt = Date.now();
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

    const tReceived = (ctx as { _updateReceivedAt?: number })._updateReceivedAt ?? Date.now();
    profiler.recordStage('1. Telegram update received', tReceived, Date.now());

    try {
      // 1. Inspect active session context and resolve target
      const activeInv = this.investigationManager.getActiveInvestigationByChatId(chatId);
      const existingTarget: InvestigationTarget | undefined =
        activeInv?.target ??
        (activeInv?.token
          ? { type: 'token', token: activeInv.token, chain: activeInv.token.chain, rawIdentifier: activeInv.token.symbol }
          : undefined);

      const tTokenStart = Date.now();
      const resolution = await this.targetResolver.resolve({
        question: trimmed,
        existingTarget,
        chatId,
      });
      const tTokenEnd = Date.now();
      profiler.recordStage('2. Target resolution', tTokenStart, tTokenEnd, {
        status: resolution.status,
        target: resolution.status === 'RESOLVED' ? resolution.target.rawIdentifier : resolution.candidateIdentifier,
      });

      if (resolution.status === 'AMBIGUOUS') {
        await ctx.reply(
          resolution.clarificationMessage ??
            TelegramMessages.ambiguousSymbol(
              resolution.candidateIdentifier ?? 'token',
              resolution.availableChains ?? []
            )
        );
        return;
      }

      if (resolution.status === 'INVALID_ADDRESS') {
        await ctx.reply(TelegramMessages.unresolvedToken());
        return;
      }

      if (resolution.status === 'NEEDS_TARGET') {
        await ctx.reply(TelegramMessages.missingToken());
        return;
      }

      if (resolution.status !== 'RESOLVED') {
        await ctx.reply(resolution.clarificationMessage ?? TelegramMessages.unresolvedToken());
        return;
      }

      const target = resolution.target;

      // 2. Standalone chain input (e.g. user simply typed "solana", "on base")
      const words = trimmed.split(/\s+/);
      const isQuestion = /\b(what|who|why|how|when|where|show|find|explain|is|are|tell|did)\b/i.test(trimmed);
      const isStandaloneChain = target.type === 'chain' && !isQuestion && (words.length <= 2 || detectChainOnlyInput(trimmed) !== undefined);

      if (isStandaloneChain && target.type === 'chain') {
        this.investigationManager.clearActiveInvestigation(chatId);
        this.investigationManager.createInvestigation({
          telegramChatId: chatId,
          target,
          initialQuestion: trimmed,
        });
        await ctx.reply(TelegramMessages.chainOnly(target.chainDisplayName));
        return;
      }

      // 3. Check if input was intended strictly as a token selection (standalone)
      const tokenCandidate = extractTokenCandidate(trimmed);
      const isStandaloneToken = target.type === 'token' && isOnlyTokenInput(trimmed, tokenCandidate);

      if (isStandaloneToken && target.type === 'token') {
        this.investigationManager.clearActiveInvestigation(chatId);
        this.investigationManager.createInvestigation({
          telegramChatId: chatId,
          target,
          token: target.token,
        });

        const native = getNativeAssetForTicker(target.token.symbol);
        const chainDisplayName = native
          ? native.chainDisplayName
          : getChainDisplayName(target.token.chain) || target.token.chain;

        await ctx.reply(TelegramMessages.tokenSelected(target.token.symbol, chainDisplayName, Boolean(native)), {
          reply_markup: TelegramKeyboards.tokenShortcuts(),
        });
        return;
      }

      // 4. Investigation question turn
      let investigationId = activeInv?.id;
      const effectiveToken = target.type === 'token' ? target.token : undefined;

      const isNewTarget =
        !activeInv ||
        (target.type === 'token'
          ? !activeInv.token ||
            activeInv.token.symbol !== target.token.symbol ||
            activeInv.token.chain !== target.token.chain
          : target.type === 'chain'
          ? !activeInv.target ||
            activeInv.target.type !== 'chain' ||
            activeInv.target.chain !== target.chain
          : target.type === 'wallet'
          ? !activeInv.target ||
            activeInv.target.type !== 'wallet' ||
            activeInv.target.address.toLowerCase() !== target.address.toLowerCase()
          : true);

      if (isNewTarget && resolution.source !== 'existing_context') {
        this.investigationManager.clearActiveInvestigation(chatId);
        const newInv = this.investigationManager.createInvestigation({
          telegramChatId: chatId,
          target,
          token: effectiveToken,
          initialQuestion: trimmed,
        });
        investigationId = newInv.id;
      }

      const displaySymbol =
        target.type === 'token'
          ? target.token.symbol
          : target.type === 'chain'
          ? target.chainDisplayName
          : target.label || truncateAddress(target.address);

      // Initialize Telegram progress feedback tracker and send initial progress message immediately
      const progressTracker = new TelegramProgressTracker({
        chatId,
        tokenSymbol: displaySymbol,
        ctx,
        botApi: this.bot.api,
      });
      await progressTracker.start();

      // 5. Delegate execution directly to InvestigationOrchestrator
      let turnResult;
      try {
        turnResult = await this.orchestrator.executeTurn({
          investigationId,
          chatId,
          question: trimmed,
          target,
          token: effectiveToken,
          userId,
          onProgress: async (stage) => {
            await progressTracker.updateStage(stage);
          },
        });
      } catch (turnErr) {
        const errMsg = turnErr instanceof Error ? turnErr.message : String(turnErr);
        logger.error('Orchestrator turn execution failed unexpectedly', {
          chatId,
          error: errMsg,
        });
        await progressTracker.fail('⚠️ An unexpected issue occurred during the investigation. Please try again.');
        return;
      }

      // 5. Format response preserving epistemic structure (Stage 8)
      const tFormatStart = Date.now();
      const formattedResponse = formatInvestigationResult(turnResult);

      // 6. Split long messages safely at section/paragraph boundaries
      const maxLen = PROBE_CONSTANTS.TELEGRAM_MAX_MESSAGE_LENGTH - 96;
      const chunks = splitTelegramMessage(formattedResponse, maxLen);
      const tFormatEnd = Date.now();
      profiler.recordStage('8. Telegram response formatting', tFormatStart, tFormatEnd, { chunkCount: chunks.length });

      // 7. Send Telegram messages / replace progress message (Stage 9)
      const tSendStart = Date.now();
      await progressTracker.finish(chunks);
      const tSendEnd = Date.now();
      profiler.recordStage('9. Telegram message send', tSendStart, tSendEnd, { chunkCount: chunks.length });
      profiler.endRequest();
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
