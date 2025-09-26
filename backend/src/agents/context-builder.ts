import { randomUUID } from 'crypto';

export function parseAgentPersona(agent: any): { agentName: string; persona: string; autoExecuteTools: boolean; toolPreferences?: Array<{ capability?: string[]; prefer?: string[]; approval?: 'auto'|'ask' }> } {
  const agentName = agent?.name || '';
  const instructions: string = agent?.instructions || '';
  const desc = agent?.description ? `Description: ${agent.description}` : '';
  
  // Check for structured format first (Personality: / Extra instructions:)
  const personalityMatch = instructions.match(/Personality:\s*([\s\S]*?)(?:\n\n|$)/);
  const extraMatch = instructions.match(/Extra instructions:\s*([\s\S]*)$/);
  
  let persona = '';
  if (personalityMatch || extraMatch) {
    // Structured format
    const personality = personalityMatch ? personalityMatch[1].trim() : '';
    const extra = extraMatch ? extraMatch[1].trim() : '';
    persona = [
      agentName ? `Agent Name: ${agentName}` : '',
      desc,
      personality ? `Personality: ${personality}` : '',
      extra ? `Extra instructions: ${extra}` : '',
    ].filter(Boolean).join('\n');
  } else {
    // Unstructured format - treat entire instructions as personality
    persona = [
      agentName ? `Agent Name: ${agentName}` : '',
      desc,
      instructions ? `Instructions: ${instructions}` : '',
    ].filter(Boolean).join('\n');
  }
  
  const autoExecuteTools = !!agent?.autoExecuteTools;
  const toolPreferences = Array.isArray(agent?.toolPreferences) ? agent.toolPreferences : undefined;
  return { agentName, persona, autoExecuteTools, toolPreferences };
}

export function buildMemoryContextFromLongTerm(memories: Array<{ content: string }>): string {
  if (!Array.isArray(memories) || memories.length === 0) return '';
  const lines = memories.map(m => `- ${m.content}`).join('\n');
  return `\nRelevant Context from Previous Conversations:\n${lines}`;
}

export function buildUserProfileContext(userProfile: any): string {
  if (!userProfile) return '';
  let ctx = `\nUser Profile:\n- Name: ${userProfile.name || 'User'}\n- Email: ${userProfile.email || 'Not provided'}`;
  if (userProfile.phone) ctx += `\n- Phone: ${userProfile.phone}`;
  if (userProfile.location) ctx += `\n- Location: ${userProfile.location}`;
  if (userProfile.company) ctx += `\n- Company: ${userProfile.company}`;
  if (userProfile.website) ctx += `\n- Website: ${userProfile.website}`;
  if (userProfile.bio) ctx += `\n- Bio: ${userProfile.bio}`;
  ctx += '\n';
  return ctx;
}

export function buildSystemPrompt(options: {
  userName: string;
  connectionId: string;
  persona: string;
  memoryContext: string;
  autoExecuteTools: boolean;
  toolPreferences?: Array<{ capability?: string[]; prefer?: string[]; approval?: 'auto'|'ask' }>;
}): string {
  const { userName, connectionId, persona, memoryContext, autoExecuteTools, toolPreferences } = options;
  const personaBlock = persona ? `AGENT PERSONA\n${persona}\n\n` : '';
  let prompt = `${personaBlock}
ROLE & VOICE
- You are the agent above. Stay strictly in character and tone. Persona overrides any conflicting style or general guidance below.
- When greeting the user, a brief on-air style greeting consistent with your persona is allowed.

USER CONTEXT
- Address the user by first name: "${userName || 'there'}".

STYLE GUIDE
- Be concise by default (1–2 sentences) unless the user asks for detail.
- Do not enumerate general capabilities unless explicitly asked.
- Avoid repeated greetings and generic marketing fluff.
- Emojis: only if your persona prescribes them; use sparingly.

PARTICIPANTS
- User: ${userName || 'User'}

REFERENCE TOKENS
- The user may reference tools or objects with @tokens (e.g., @terminal, @mysql, @x, @twitter, @serpapi, @michaeljames).
- Treat @terminal as a request to run a shell command in a sandbox.
- Twitter/X: Treat @x and @twitter as requests to use native X tools. Use these forms:
  • x.search "<query>" (e.g., "from:@handle", "to:@handle", keywords)
  • x.lists { username: "@handle" } (users may also write "@x.lists @handle")
  • x.dm { recipientId: "<userId>", text: "<message>" }
  • x.tweet "<text>"
  NEVER propose or use serpapi.twitter. If a previous answer used serpapi.twitter, rewrite to the appropriate x.* tool.
- Treat @serpapi as a request to perform a SerpAPI call for web/news/images/video discovery. For Google News specifically, use: $ serpapi.google_news "<query>". For other searches, prefer engine-specific forms like: $ serpapi.google_images "<query>", $ serpapi.bing_images "<query>", $ serpapi.youtube "<query>", $ serpapi.yelp "<query>", $ serpapi.patents "<query>", $ serpapi.google_maps "<query>". The system also accepts $ serpapi.run <engine> "<query>" with optional key=value args. NEVER say you cannot access SerpAPI when @serpapi is mentioned.

IMPORTANT: Agent instructions/persona take precedence over these general tool guidelines.
- To read the content of a specific web page (when you have a concrete URL), use: tool.web.scrape { url: "https://..." }.
- If the user references a numbered result from the last list (e.g., "read #2"), use tool.web.scrape.pick { index: 2 }.
- Treat @elevenlabs as a request to synthesize speech. Propose the tool call in one line: elevenlabs.tts "<text>" voice=<voiceId> format=mp3 (voice optional).
- Finance tools are available when needed. For quotes/news, use finance.getQuote / finance.getNews.
- Prefer canonical tools over raw engine strings across all domains.

- When proposing a terminal command, produce exactly one suggestion line in the format:
  Should I run: $ <command>
  where <command> contains no backticks or extra prose.

${autoExecuteTools 
  ? `TERMINAL EXECUTION POLICY
1) Explain intent briefly.
2) Execute the terminal command directly by outputting: $ <command>
3) Analyze returned output and answer the user's goal.
Note: You have auto-execute enabled, so run commands directly without asking for approval.`
  : `TERMINAL EXECUTION POLICY
1) Explain intent briefly.
2) Propose exactly one clean suggestion line (as above).
3) Wait for approval (Yes/No). After approval the system will execute the command and return output.
4) Analyze returned output and answer the user's goal.`}

SAFETY
- Avoid destructive operations. Ask before any action with side effects.

ENVIRONMENT
- Current working directory: /tmp/superagent-sandbox/agent-${options.connectionId}

${memoryContext}`;

  // Inject TOOL PREFERENCES if provided (data-driven)
  if (toolPreferences && Array.isArray(toolPreferences) && toolPreferences.length) {
    const lines: string[] = [];
    lines.push('\nTOOL PREFERENCES');
    for (const pref of toolPreferences) {
      const caps = (pref.capability || []).join(', ');
      const prefers = (pref.prefer || []).join(', ');
      const appr = pref.approval || 'ask';
      lines.push(`- Capability [${caps}]: prefer ${prefers || '(none)'} (approval: ${appr})`);
    }
    prompt = `${prompt}\n${lines.join('\n')}`;
  }
  return prompt;
}

export function buildMessagesFromShortTerm(shortTerm: any[]): Array<{ role: 'user'|'assistant'|'system'; content: string }> {
  const recent = Array.isArray(shortTerm) ? shortTerm.slice(-10) : [];
  const mapped = recent.map((msg: any) => {
    if (msg.role === 'terminal') {
      return { role: 'system' as const, content: `Terminal output:\n${msg.content}` };
    }
    return { role: (msg.role === 'user' || msg.role === 'assistant') ? msg.role : 'user', content: msg.content };
  });
  return mapped;
}

export function assembleConversationMessages(systemContent: string, shortTermMsgs: Array<{ role: 'user'|'assistant'|'system'; content: string }>, userRole: 'user'|'assistant', userMessage: string) {
  return [
    { role: 'system' as const, content: systemContent },
    ...shortTermMsgs,
    { role: userRole, content: userMessage },
  ];
}


