import dotenv from 'dotenv';
dotenv.config();

import { bootstrap } from '../src/index.js';
import { profiler } from '../src/utils/profiler.js';
import { getEnv } from '../src/config/env.js';
import type { UserFromGetMe } from 'grammy/types';

const MOCK_BOT_INFO: UserFromGetMe = {
  id: 123456789,
  is_bot: true,
  first_name: 'Probe Agent',
  username: 'probe_agent_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

async function main() {
  console.log('=====================================================');
  console.log('PROBE END-TO-END INVESTIGATION LATENCY PROFILING');
  console.log('=====================================================');

  const env = getEnv();
  const botToken = env.TELEGRAM_BOT_TOKEN;

  console.log(`LLM Provider: ${env.LLM_PROVIDER}`);
  console.log(`Nansen Base URL: ${env.NANSEN_BASE_URL}`);

  // 1. Initialize real runtime
  const runtime = await bootstrap({
    skipPolling: true,
    isTest: false,
  });

  const bot = runtime.bot.getBot();
  bot.botInfo = MOCK_BOT_INFO;

  // Intercept sendMessage to measure real Telegram API round-trip without needing a pre-existing chat
  const replies: string[] = [];
  bot.api.config.use(async (prev, method, payload) => {
    if (method === 'sendMessage') {
      const p = payload as { text: string; chat_id: number };
      replies.push(p.text);

      // Measure true network latency to Telegram Bot API
      const netStart = Date.now();
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      } catch (err) {
        // Fallback if offline
      }
      const netEnd = Date.now();

      return {
        ok: true,
        result: {
          message_id: replies.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: p.chat_id, type: 'private' },
          text: p.text,
        },
      } as never;
    }
    return prev(method, payload);
  });

  const testQuestion = 'Why is ETH activity changing?';
  console.log(`\nDispatching real query: "${testQuestion}"...\n`);

  // Start profiler
  profiler.startRequest();

  // Send update through grammY
  await bot.handleUpdate({
    update_id: 100001,
    message: {
      message_id: 101,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 88888888, type: 'private' },
      from: { id: 88888888, is_bot: false, first_name: 'Investigator' },
      text: testQuestion,
    },
  });

  const report = profiler.getReport();

  console.log('=====================================================');
  console.log('LATENCY BREAKDOWN REPORT');
  console.log('=====================================================');

  const stageKeys = [
    '1. Telegram update received',
    '2. Token resolution',
    '3. Investigation planning',
    '4. Nansen evidence execution',
    '5. Evidence normalization',
    '6. Gemini/LLM synthesis',
    '7. Evidence validation',
    '8. Telegram response formatting',
    '9. Telegram message send',
  ];

  for (const key of stageKeys) {
    const s = report.stages[key];
    const dur = s ? s.durationMs : 0;
    const start = s ? s.startTime : 0;
    const end = s ? s.endTime : 0;
    console.log(`${key}: ${dur.toLocaleString()}ms (start: ${start}, end: ${end})`);
  }

  console.log('-----------------------------------------------------');
  console.log(`TOTAL END-TO-END DURATION: ${report.totalDurationMs.toLocaleString()}ms`);
  console.log('=====================================================\n');

  console.log('NANSEN EVIDENCE CALLS BREAKDOWN:');
  console.log(`Number of Nansen calls: ${report.nansenCalls.length}`);
  console.log(`Evidence execution mode: ${report.evidenceExecutionMode.toUpperCase()}`);
  console.log(`Can run in parallel: ${report.canRunInParallel ? 'YES' : 'NO'}`);

  report.nansenCalls.forEach((call, idx) => {
    console.log(`  Call #${idx + 1}: [${call.capability}] ${call.endpoint}`);
    console.log(`    - Latency: ${call.durationMs.toLocaleString()}ms`);
    console.log(`    - Cache: ${call.cacheHit ? 'HIT' : 'MISS'}`);
    console.log(`    - Status: ${call.status ?? 200}`);
  });

  console.log(`\nTotal Nansen Latency (cumulative): ${report.totalNansenDurationMs.toLocaleString()}ms`);

  console.log('\nLLM SYNTHESIS BREAKDOWN:');
  report.llmCalls.forEach((call, idx) => {
    console.log(`  Call #${idx + 1}: Provider=${call.provider}`);
    console.log(`    - Latency: ${call.durationMs.toLocaleString()}ms`);
    if (call.usage) {
      console.log(`    - Prompt tokens: ${call.usage.promptTokens ?? 'N/A'}`);
      console.log(`    - Thought tokens: ${call.usage.thoughtTokens ?? 'N/A'}`);
      console.log(`    - Candidate tokens: ${call.usage.candidateTokens ?? 'N/A'}`);
      console.log(`    - Total tokens: ${call.usage.totalTokens ?? 'N/A'}`);
    }
  });
  console.log(`Total LLM Latency: ${report.totalLlmDurationMs.toLocaleString()}ms`);

  console.log('\nGenerated Assistant Reply (first 300 chars):');
  console.log(replies[0]?.slice(0, 300) || '(No reply generated)');

  await runtime.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('Profiling failed:', err);
  process.exit(1);
});
