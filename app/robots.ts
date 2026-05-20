import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const disallow = ['/api/', '/wallet-intel/'];
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow },
      // OpenAI ecosystem
      { userAgent: 'GPTBot',             allow: '/', disallow },
      { userAgent: 'OAI-SearchBot',      allow: '/', disallow },
      { userAgent: 'ChatGPT-User',       allow: '/', disallow },
      // Anthropic ecosystem
      { userAgent: 'anthropic-ai',       allow: '/', disallow },
      { userAgent: 'ClaudeBot',          allow: '/', disallow },
      { userAgent: 'Claude-Web',         allow: '/', disallow },
      { userAgent: 'Claude-SearchBot',   allow: '/', disallow },
      // Perplexity
      { userAgent: 'PerplexityBot',      allow: '/', disallow },
      { userAgent: 'Perplexity-User',    allow: '/', disallow },
      // Google ecosystem (Bard/Gemini)
      { userAgent: 'Google-Extended',    allow: '/', disallow },
      { userAgent: 'GoogleOther',        allow: '/', disallow },
      // Apple Intelligence
      { userAgent: 'Applebot-Extended',  allow: '/', disallow },
      // Common Crawl (base de muitos LLMs)
      { userAgent: 'CCBot',              allow: '/', disallow },
      // Meta AI
      { userAgent: 'Meta-ExternalAgent', allow: '/', disallow },
      { userAgent: 'Meta-ExternalFetcher', allow: '/', disallow },
      { userAgent: 'FacebookBot',        allow: '/', disallow },
      // Cohere
      { userAgent: 'cohere-ai',          allow: '/', disallow },
      { userAgent: 'cohere-training-data-crawler', allow: '/', disallow },
      // ByteDance/TikTok (Doubao LLM)
      { userAgent: 'Bytespider',         allow: '/', disallow },
      // Mistral
      { userAgent: 'MistralAI-User',     allow: '/', disallow },
      // You.com
      { userAgent: 'YouBot',             allow: '/', disallow },
      // DuckDuckGo (alimenta DuckAssist)
      { userAgent: 'DuckAssistBot',      allow: '/', disallow },
      // Brave Search (alimenta Brave Leo)
      { userAgent: 'Brave-Search',       allow: '/', disallow },
    ],
    sitemap: 'https://afos-analytics.com/sitemap.xml',
  };
}
