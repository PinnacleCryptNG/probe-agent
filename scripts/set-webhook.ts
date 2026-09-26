import dotenv from 'dotenv';

// Load local environment variables if available
dotenv.config();

async function main(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const rawUrl = process.argv[2] || process.env.VERCEL_WEBHOOK_URL;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!botToken || botToken === 'dummy_telegram_token_for_testing') {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN is missing or set to dummy value.');
    process.exit(1);
  }

  if (!rawUrl || rawUrl.trim() === '') {
    console.error(
      '❌ Error: Webhook URL is missing. Provide it as an argument or set VERCEL_WEBHOOK_URL in .env (e.g. npx tsx scripts/set-webhook.ts https://probe-agent.vercel.app/api/webhook).'
    );
    process.exit(1);
  }

  // Normalize URL to always target /api/webhook over HTTPS
  let webhookUrl = rawUrl.trim();
  if (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://')) {
    webhookUrl = `https://${webhookUrl}`;
  }
  if (!webhookUrl.endsWith('/api/webhook')) {
    webhookUrl = webhookUrl.replace(/\/+$/, '') + '/api/webhook';
  }

  console.log(`Setting Telegram webhook endpoint to: ${webhookUrl}`);

  const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;

  const payload: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
  };

  if (webhookSecret && webhookSecret.trim() !== '') {
    payload.secret_token = webhookSecret.trim();
  }

  try {
    const res = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: boolean;
    };

    if (data.ok) {
      console.log('✅ Webhook successfully registered with Telegram!');
      if (webhookSecret) {
        console.log('🔒 Secret token protection enabled (X-Telegram-Bot-Api-Secret-Token).');
      }
    } else {
      console.error(`❌ Telegram setWebhook failed: ${data.description ?? 'Unknown error'}`);
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Network error while setting webhook: ${msg}`);
    process.exit(1);
  }
}

main();
