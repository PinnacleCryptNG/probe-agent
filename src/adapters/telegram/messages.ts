export const TelegramMessages = {
  welcome(): string {
    return [
      '🔎 PROBE',
      '',
      'Evidence-first on-chain investigation.',
      '',
      'Investigate chains, tokens, wallets, and transactions.',
      '',
      'Try:',
      "• What's happening on Ethereum?",
      '• Who are the biggest whales on Solana?',
      '• Investigate $PEPE',
      '• Investigate this wallet: 0x...',
      '• What were the biggest transactions this week?',
    ].join('\n');
  },

  help(): string {
    return [
      '*PROBE Investigation Guide*',
      '',
      '• *Token First:* Send a token symbol or contract address to start.',
      '• *Natural-Language Questions:* Ask questions about token movements, whale accumulation, and flows.',
      '• *Evidence-Grounded:* PROBE queries verified on-chain data and strictly grounds all findings in retrieved evidence.',
      '• *Epistemic Clarity:* Answers distinguish verified Observations, analytical Interpretations, and Hypotheses.',
      '• *Follow-Up Questions:* Ask continuous follow-up questions within the active investigation context.',
      '• *Commands:*',
      '  /start - Introduction',
      '  /help - Learn how PROBE works',
      '  /new - Reset and investigate a new token',
    ].join('\n');
  },

  newInvestigation(): string {
    return [
      '🔎 PROBE',
      '',
      'Send me a token symbol or contract address.',
    ].join('\n');
  },

  tokenSelected(symbol: string, chainDisplayName?: string, isNative?: boolean): string {
    const header = isNative && chainDisplayName ? `🔎 ${symbol} · ${chainDisplayName}` : `🔎 ${symbol}`;
    const question = isNative ? 'What would you like to investigate?' : 'What do you want to investigate?';
    return [
      header,
      '',
      question,
      '',
      'Or ask me anything.',
    ].join('\n');
  },

  walletSelected(address: string, chainDisplayName?: string): string {
    const shortAddr = `${address.toLowerCase().slice(0, 6)}...${address.toLowerCase().slice(-4)}`;
    const header = chainDisplayName ? `${shortAddr} · ${chainDisplayName}` : shortAddr;
    return [
      '🔎 WALLET INVESTIGATION',
      header,
      '',
      'What would you like to investigate about this wallet?',
      '',
      'Or ask me anything.',
    ].join('\n');
  },

  contractSelected(address: string, chainDisplayName?: string): string {
    const shortAddr = `${address.toLowerCase().slice(0, 6)}...${address.toLowerCase().slice(-4)}`;
    const header = chainDisplayName ? `${shortAddr} · ${chainDisplayName}` : shortAddr;
    return [
      '🔎 CONTRACT ADDRESS',
      header,
      '',
      'I can identify this address, but PROBE does not currently have a dedicated smart-contract investigation mode for this contract type.',
    ].join('\n');
  },

  ambiguousAddress(address: string, chains: string[]): string {
    const shortAddr = `${address.toLowerCase().slice(0, 6)}...${address.toLowerCase().slice(-4)}`;
    return [
      '🔎 Address detected',
      '',
      shortAddr,
      '',
      'I need to determine whether this address is a wallet or contract before investigating it.',
      '',
      'Which chain?',
      ...chains.map((c) => `• ${c}`),
    ].join('\n');
  },

  invalidChainForAddress(address: string, invalidChain: string, chains: string[]): string {
    const shortAddr = `${address.toLowerCase().slice(0, 6)}...${address.toLowerCase().slice(-4)}`;
    return [
      '🔎 Address detected',
      '',
      shortAddr,
      '',
      `I don't recognize "${invalidChain}" as a supported chain.`,
      '',
      'Which chain?',
      ...chains.map((c) => `• ${c}`),
    ].join('\n');
  },

  chainOnly(chainName: string): string {
    return [
      `Which token on ${chainName}?`,
      '',
      'Send the token symbol or contract address.',
    ].join('\n');
  },

  unresolvedToken(): string {
    return [
      "I couldn't identify that token.",
      '',
      'Send a token symbol or contract address.',
    ].join('\n');
  },

  tokenNotIndexed(): string {
    return "I couldn't find that token in Nansen's indexed data.";
  },

  capabilityUnavailableOnChain(): string {
    return "That investigation isn't available for this token's chain yet.";
  },

  ambiguousSymbol(_symbol: string, chains: string[]): string {
    if (chains.length === 0) {
      return 'Which chain?';
    }
    return [
      'Which chain?',
      '',
      ...chains.map((c) => `• ${c}`),
    ].join('\n');
  },

  missingToken(): string {
    return [
      'Which token would you like to investigate?',
      '',
      'Send a token symbol or contract address.',
    ].join('\n');
  },
};
