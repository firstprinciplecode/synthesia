import { LLMRouter, ModelConfigs, SupportedModel } from '../llm/providers.js';
import { memoryService } from '../memory/memory-service.js';
import { randomUUID } from 'crypto';
import { buildMessagesFromShortTerm, buildSystemPrompt, parseAgentPersona, buildMemoryContextFromLongTerm, assembleConversationMessages } from './context-builder.js';
import { resolveCapability } from './capability-resolver.js';
 

export type OrchestratorDeps = {
  llmRouter: LLMRouter;
};

export class AgentOrchestrator {
  private llmRouter: LLMRouter;

  constructor(deps: OrchestratorDeps) {
    this.llmRouter = deps.llmRouter;
  }

  async streamPrimaryAgentResponse(options: {
    roomId: string;
    activeUserId: string;
    connectionId: string;
    agentRecord: any | null;
    userProfile: any | null;
    userMessage: string;
    runOptions?: { model?: SupportedModel; temperature?: number; budget?: { maxTokens?: number } };
    onDelta: (delta: string) => void;
  }): Promise<{ fullResponse: string; model: SupportedModel }> {
    const { roomId, activeUserId, connectionId, agentRecord, userProfile, userMessage, runOptions, onDelta } = options;
    // Scope memories per agent (room) to avoid cross-agent leakage
    const shortTerm = memoryService.getShortTerm(roomId);
    const longTerm = await memoryService.searchLongTerm(roomId, userMessage, 3, 'conversation');
    const memoryContext = buildMemoryContextFromLongTerm(longTerm);
    const { agentName, persona, autoExecuteTools } = agentRecord ? parseAgentPersona(agentRecord) : { agentName: '', persona: '', autoExecuteTools: false };
    const systemContent = buildSystemPrompt({
      userName: userProfile?.name || 'there',
      connectionId,
      persona,
      memoryContext,
      autoExecuteTools,
    });
    const shortTermMsgs = buildMessagesFromShortTerm(shortTerm);
    const messages = assembleConversationMessages(systemContent, shortTermMsgs, 'user', userMessage);
    const model = (runOptions?.model || 'gpt-4o') as SupportedModel;
    const modelConfig = ModelConfigs[model];
    let fullResponse = '';
    for await (const chunk of this.llmRouter.stream(
      modelConfig.provider,
      messages,
      { model, temperature: runOptions?.temperature || 0.7, stream: true }
    )) {
      if (chunk.delta) {
        fullResponse += chunk.delta;
        onDelta(chunk.delta);
      }
    }
    return { fullResponse, model };
  }

  // Bounded agent loop (plan–act–observe–reflect)
  async runTask(options: {
    runId?: string;
    roomId: string;
    activeUserId: string;
    connectionId: string;
    agentRecord: any | null;
    userProfile: any | null;
    userMessage: string;
    runOptions?: { model?: SupportedModel; temperature?: number; budget?: { maxTokens?: number }; maxSteps?: number; timeboxMs?: number };
    executeTool?: (call: { name: string; func?: string; args?: any }) => Promise<any>;
    onAnalysis?: (note: string) => void;
    onDelta?: (delta: string) => void;
    getCatalog?: () => Array<{ tool: string; func: string; description?: string; tags?: string[]; synonyms?: string[]; sideEffects?: boolean; approval?: 'auto'|'ask' }>;
    getLatestResultId?: (roomId: string) => string | null;
    pendingApproval?: { tool: string; func: string; args: any; hint: string };
  }): Promise<{ finalText: string; steps: Array<{ decision: any; observation?: any }>; model: SupportedModel; pendingApproval?: { tool: string; func: string; args: any; hint: string } }>{
    const { roomId, activeUserId, connectionId, agentRecord, userProfile, userMessage, runOptions, executeTool, onAnalysis, onDelta, getCatalog, getLatestResultId, pendingApproval } = options;
    const runId = options.runId || randomUUID();

    // Scope memories per agent (room) to avoid cross-agent leakage
    const shortTerm = memoryService.getShortTerm(roomId);
    const longTerm = await memoryService.searchLongTerm(roomId, userMessage, 3, 'conversation');
    const memoryContext = buildMemoryContextFromLongTerm(longTerm);
    const { persona, autoExecuteTools, toolPreferences } = agentRecord ? parseAgentPersona(agentRecord) : { agentName: '', persona: '', autoExecuteTools: false } as any;

    let systemContent = buildSystemPrompt({
      userName: userProfile?.name || 'there',
      connectionId,
      persona,
      memoryContext,
      autoExecuteTools: !!autoExecuteTools,
      toolPreferences,
    });
    // Selection memory instructions for pronoun resolution
    systemContent += `\nCONVERSATION AWARENESS\n- The room maintains a selected article URL when the user says \"read 2\" or similar.\n- If the user references \"this\", \"that\", \"it\", or \"the article\" without a URL, assume they mean the most recently selected article for this room.\n- If no article has been selected in this room yet, ask a single clarifying question: \"Which result number should I open (1-10)?\".\n- After fetching content, use the agent persona to write a brief on-air segment before proposing narration via @elevenlabs.\nTOOL CONTEXT\n- When you say \"Should I run serpapi...\", the UI interprets this as asking approval to run the tool. After approval you will receive either Markdown with [View](url) links or a structured resultId and links list.\n- After results are shown, ask the user to pick a number if they don’t specify which item to read.\n`;
    const shortTermMsgs = buildMessagesFromShortTerm(shortTerm);

    const maxSteps = Math.max(1, Math.min(20, runOptions?.maxSteps ?? 6));
    const timeboxMs = Math.max(1000, Math.min(180000, runOptions?.timeboxMs ?? 45000));
    const startedAt = Date.now();
    const model = (runOptions?.model || 'gpt-4o') as SupportedModel;
    const modelCfg = ModelConfigs[model];

    let finalText = '';
    const steps: Array<{ decision: any; observation?: any }> = [];
    const scratchpad: string[] = [];
    const observedMarkdowns: string[] = [];

    const log = (msg: string, extra?: any) => {
      try {
        const safe = extra ? JSON.stringify(extra).slice(0, 600) : '';
        console.log(`[agent] run=${runId} room=${roomId} ${msg}${safe ? ' ' + safe : ''}`);
      } catch {}
    };
    log('start', { model, userMessage: (userMessage || '').slice(0, 200) });

    // If we already have a pending approval, execute it immediately before any heuristics
    if (pendingApproval && executeTool) {
      try {
        const obs = await executeTool({ name: pendingApproval.tool, func: pendingApproval.func, args: pendingApproval.args });
        steps.push({ decision: { type: 'tool', tool: { name: pendingApproval.tool, func: pendingApproval.func }, args: pendingApproval.args }, observation: obs });
        scratchpad.push(`Approved tool ${pendingApproval.tool}: success`);
        onAnalysis?.(`Tool ${pendingApproval.tool} ok.`);
        log(`approved tool success`, { tool: pendingApproval.tool, func: pendingApproval.func });
        try {
          const obsText = typeof (obs?.markdown) === 'string' ? obs.markdown : (typeof obs === 'string' ? obs : JSON.stringify(obs));
          const brief = String(obsText || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
          if (brief) scratchpad.push(`Observation snippet:\n${brief}`);
          if (typeof (obs?.markdown) === 'string' && obs.markdown.trim()) {
            observedMarkdowns.push(String(obs.markdown));
            finalText = String(obs.markdown);
            onDelta?.(finalText);
            return { finalText, steps, model };
          }
        } catch {}
      } catch (e: any) {
        const err = String(e?.message || e || 'tool error');
        steps.push({ decision: { type: 'tool', tool: { name: pendingApproval.tool, func: pendingApproval.func }, args: pendingApproval.args }, observation: { error: err } });
        onAnalysis?.(`Tool ${pendingApproval.tool} error: ${err}`);
        log(`approved tool error`, { error: err });
        // Continue to loop so the model can handle the error
      }
    }

    // Heuristic: numeric selection like "link 4", "read 4", "open #4", ordinals (3rd/third), or number before noun ("3rd link") → scrape.pick (ask-first if needed)
    if (!autoExecuteTools && !pendingApproval) {
      const msg = String(userMessage || '');
      let pickIndex: number | null = null;
      let mPick = msg.match(/(?:link|article|story|result|read|open|pick)\s*(?:number\s*)?#?\s*(\d{1,2})(?:st|nd|rd|th)?\b/i);
      if (mPick) pickIndex = Number(mPick[1]);
      if (pickIndex == null) {
        const mNumBefore = msg.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:link|article|story|result)\b/i);
        if (mNumBefore) pickIndex = Number(mNumBefore[1]);
      }
      if (pickIndex == null) {
        const mOrd = msg.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:link|article|story|result)?\b/i);
        if (mOrd) {
          const map: Record<string, number> = { first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8, ninth:9, tenth:10 };
          pickIndex = map[mOrd[1].toLowerCase()] || null;
        }
      }
      if (pickIndex != null) {
        const index = Math.max(1, Math.min(50, Number(pickIndex)));
        const rid = getLatestResultId ? getLatestResultId(roomId) : null;
        const question = rid
          ? `Should I run: $ tool.web.scrape.pick { index: ${index}, resultId: "${rid}" }?`
          : `Should I run: $ tool.web.scrape.pick ${index}?`;
        onDelta?.(question);
        return {
          finalText: question,
          steps,
          model,
          pendingApproval: { tool: 'web', func: 'scrape.pick', args: rid ? { index, resultId: rid } : { index }, hint: String(index) },
        };
      }
    }

    // Heuristic: if user asks for latest news and auto-exec is off, ask approval up-front
    if (!autoExecuteTools && !pendingApproval) {
      const text = (userMessage || '').toLowerCase();
      const wantsNews = /(latest|today|headlines|news|what's happening|whats happening)/.test(text);
      if (wantsNews) {
        // If we already have recent Google News results observed in this run or scratchpad, don't refetch
        const haveRecentNews = observedMarkdowns.some(m => /Google News for/i.test(m)) || scratchpad.some(s => /Google News for/i.test(s));
        if (haveRecentNews) {
          const prompt = 'I already fetched Google News just now. Which result number should I open (e.g., 1-10)?';
          onDelta?.(prompt);
          return { finalText: prompt, steps, model };
        }
        // Extract topic, strip suffixes like "from google news"
        const quoted = (userMessage.match(/"([^"]+)"/) || [])[1];
        const about = (text.match(/about\s+([\w\s\-\_\.\#\@]+)\??$/) || [])[1];
        let fallback = text.replace(/\b(can you|get|show|fetch|latest|today|headlines|news|on|about|please)\b/gi, '').trim();
        fallback = fallback.replace(/\bfrom\s+google\s+news\b/gi, '').trim();
        let hintRaw = String(quoted || about || fallback || userMessage).trim();
        hintRaw = hintRaw.replace(/\bfrom\s+google\s+news\b/gi, ' ').replace(/[\)\(\:"\]]+$/g, ' ').replace(/^\s*(the|a|an)\s+/i,'').trim();
        if (/favorite\s+space\s+company/i.test(hintRaw)) hintRaw = 'SpaceX';
        const hint = hintRaw.replace(/\s{2,}/g, ' ').trim();
        const question = `Should I run serpapi.google_news "${hint}" now?`;
        const delta = question; // emit verbatim
        if (delta) onDelta?.(delta);
        return { finalText: delta, steps, model, pendingApproval: { tool: 'serpapi', func: 'google_news', args: { q: hint }, hint } };
      }
    }

    const decisionPrompt = `${systemContent}

You are now in autonomous planning mode. Return ONLY JSON without code fences:
{"type":"tool|think|write|stop","reason":"string","capabilityTags?":string[],"hint?":"string","args?":{},"content?":"string"}

Rules when type=write:
- Content must be the exact user-facing sentence(s) only, following your personality.
- For your first reply in a conversation (no prior assistant text), you may include a brief greeting in your persona. Avoid sign-offs.
- No emojis unless the user used them first.
- Do not include step labels, thoughts, analysis, the words Step/Think/Reflect/Observation, or instructions about writing.
- Do not repeat previous text.
- Keep it concise by default (<= 2 sentences). Do NOT enumerate capabilities unless the user explicitly asks for a list.
- If the user asks what you can do, respond with a brief one-liner and a single clarifying question.
Tool approval policy: ${autoExecuteTools ? 'auto' : 'ask'}
- When policy is "ask": do NOT return type="tool". Instead, return type="write" asking a single, concrete yes/no question specifying the exact tool and arguments you intend to run (e.g., "Fetch Google News for \"SpaceX\" now?"). Wait for user approval in the next turn.

Preferred tool hints:
- For news/web discovery use capabilityTags ["news","search"] and hint with the topic (e.g., "spacex").
- For code lookups use capabilityTags ["code","search","grep"]. Ask first and propose exactly one line: Should I run: $ tool.code.search { pattern: "<text>", path: "<dir>" }?

After a tool success, your next step should normally be type="write" that summarizes the result for the user unless another tool is strictly required.`;

    // log already defined above

    const sanitizeWrite = (text: string, existing: string): string => {
      const raw = String(text || '');
      // Remove planning/meta markers anywhere (aggressively cut trailing meta)
      let out = raw
        .replace(/^\s*(Step\s*\d+|Think|Reflect|Observation)\b[\s\S]*$/gim, '')
        .replace(/\b(Step\s*\d+|evaluation|ensure that|plan aligns|next action)\b[\s\S]*$/gim, '')
        .trim();
      // Drop common boilerplate "I'm here to help" style padding
      out = out.replace(/\b(I['’]m here to help|I['’]m here for you|How can I assist)\b[\s\S]*$/i, '').trim();
      // Sentence-level dedupe vs itself and existing
      const sentenceSplit = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);
      const norm = (s: string) => s.replace(/[\s]+/g, ' ').trim().toLowerCase();
      const seen = new Set<string>(sentenceSplit(existing).map(norm));
      const sentences = sentenceSplit(out);
      const kept: string[] = [];
      for (const s of sentences) {
        const n = norm(s);
        if (!n) continue;
        if (seen.has(n)) continue;
        kept.push(s);
        seen.add(n);
      }
      let cleaned = kept.join(' ').trim();
      // For initial reply (no previous assistant text), keep it concise: max 3 sentences or 400 chars
      // Allow more space for agents with personality
      if (!existing.trim()) {
        const initial = sentenceSplit(cleaned).slice(0, 3).join(' ');
        cleaned = initial.slice(0, 400).trim();
      }
      return cleaned;
    };

    // If we have pending approval and user said yes, execute the tool
    if (pendingApproval && executeTool) {
      try {
        const obs = await executeTool({ name: pendingApproval.tool, func: pendingApproval.func, args: pendingApproval.args });
        steps.push({ decision: { type: 'tool', tool: { name: pendingApproval.tool, func: pendingApproval.func }, args: pendingApproval.args }, observation: obs });
        scratchpad.push(`Approved tool ${pendingApproval.tool}: success`);
        onAnalysis?.(`Tool ${pendingApproval.tool} ok.`);
        log(`approved tool success`, { tool: pendingApproval.tool, func: pendingApproval.func });
        // Surface observation for summary
        try {
          const obsText = typeof (obs?.markdown) === 'string' ? obs.markdown
            : (typeof obs === 'string' ? obs : JSON.stringify(obs));
          const brief = String(obsText || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
          if (brief) scratchpad.push(`Observation snippet:\n${brief}`);
          if (typeof (obs?.markdown) === 'string' && obs.markdown.trim()) {
            observedMarkdowns.push(String(obs.markdown));
          }
        } catch {}
        // Continue to next step to write summary
      } catch (e: any) {
        const err = String(e?.message || e || 'tool error');
        steps.push({ decision: { type: 'tool', tool: { name: pendingApproval.tool, func: pendingApproval.func }, args: pendingApproval.args }, observation: { error: err } });
        scratchpad.push(`Approved tool ${pendingApproval.tool}: ERROR ${err}`);
        onAnalysis?.(`Tool ${pendingApproval.tool} error: ${err}`);
        log(`approved tool error`, { error: err });
      }
    }

    for (let step = 1; step <= maxSteps; step++) {
      if (Date.now() - startedAt > timeboxMs) {
        onAnalysis?.(`Timebox hit at step ${step}.`);
        break;
      }

      const messages = assembleConversationMessages(
        systemContent,
        [...shortTermMsgs, { role: 'user', content: userMessage }],
        'user',
        [
          `Working scratchpad so far:\n${scratchpad.join('\n') || '(empty)'}\n`,
          `Decide the next action. ${decisionPrompt}`,
        ].join('\n')
      );
      log(`step ${step} system prompt`, { systemContent: systemContent.slice(0, 300) });

      const resp = await this.llmRouter.complete(modelCfg.provider, messages, {
        model,
        temperature: runOptions?.temperature ?? 0.7,
        stream: false,
      });

      const raw = String(resp.content || '').trim();
      log(`step ${step} llm response`, { raw: raw.slice(0, 200) });
      let decision: any = undefined;
      try {
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
        decision = JSON.parse(jsonStr);
      } catch {
        onAnalysis?.(`Decision parse failed at step ${step}. Raw= ${raw.slice(0, 160)}`);
        // Fallback: if the model returned plain text, treat it as a write
        if (raw) {
          decision = { type: 'write', content: raw };
        } else {
          break;
        }
      }

      steps.push({ decision });
      log(`step ${step} decision`, { type: decision.type, tags: decision.capabilityTags, hint: decision.hint });

      if (decision.type === 'stop') break;

      if (decision.type === 'think') {
        scratchpad.push(`Step ${step} think: ${decision.reason || ''}`);
        continue;
      }

      if (decision.type === 'write') {
        const originalContent = String(decision.content || '');
        let delta = sanitizeWrite(originalContent, finalText);
        log(`step ${step} write sanitize`, { original: originalContent.slice(0, 100), delta: delta.slice(0, 100) });
        // Avoid appending duplicates
        if (delta && !finalText.includes(delta)) {
          finalText += (finalText ? '\n' : '') + delta;
          onDelta?.(delta);
        }
        scratchpad.push(`Step ${step} wrote ${delta.length} chars.`);
        // For simple chats (no tools yet), stop after one clean write
        if (steps.every(s => s.decision?.type !== 'tool')) break;
        continue;
      }

      if (decision.type === 'tool' && executeTool) {
        // Ask-first policy: if auto execution is disabled, propose a question instead of executing.
        if (!autoExecuteTools) {
          // Resolve the tool first to get proper name/func
          const tags: string[] = Array.isArray(decision.capabilityTags) ? decision.capabilityTags : [];
          let name = String(decision.tool?.name || '');
          let func = decision.tool?.func as string | undefined;
          if (!name || !func) {
            const catalog = typeof getCatalog === 'function' ? (getCatalog() || []) : [];
            const resolved = resolveCapability(catalog, { tags, hint: String(decision.hint || '') });
            if (resolved) { name = resolved.tool; func = resolved.func; }
          }
          const proposed = `Should I run ${name}.${func} for "${String(decision.hint || userMessage)}"?`;
          const delta = sanitizeWrite(proposed, finalText);
          if (delta) {
            finalText += (finalText ? '\n' : '') + delta;
            onDelta?.(delta);
          }
          scratchpad.push(`Tool ${name}.${func} deferred pending user approval.`);
          // Return the pending approval info instead of breaking
          return { finalText, steps, model, pendingApproval: { tool: name, func: func!, args: decision.args || decision.tool?.args, hint: String(decision.hint || '') } };
        }
        try {
          const tags: string[] = Array.isArray(decision.capabilityTags) ? decision.capabilityTags : [];
          let name = String(decision.tool?.name || '');
          let func = decision.tool?.func as string | undefined;
          if (!name || !func) {
            // Resolve against live catalog from host
            const catalog = typeof getCatalog === 'function' ? (getCatalog() || []) : [];
            const resolved = resolveCapability(catalog, { tags, hint: String(decision.hint || '') }, toolPreferences ? { prefer: toolPreferences } : undefined);
            if (resolved) { name = resolved.tool; func = resolved.func; }
          }
          const obs = await executeTool({ name, func, args: decision.args || decision.tool?.args });
          steps[steps.length - 1].observation = obs;
          scratchpad.push(`Step ${step} tool ${name}: success`);
          onAnalysis?.(`Tool ${name} ok.`);
          log(`step ${step} tool success`, { tool: name, func });
          // Surface a concise observation summary to the model for the next step
          try {
            const obsText = typeof (obs?.markdown) === 'string' ? obs.markdown
              : (typeof obs === 'string' ? obs : JSON.stringify(obs));
            const brief = String(obsText || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
            if (brief) scratchpad.push(`Observation snippet:\n${brief}`);
            if (typeof (obs?.markdown) === 'string' && obs.markdown.trim()) {
              observedMarkdowns.push(String(obs.markdown));
              // Emit markdown verbatim and finish
              const m = String(obs.markdown);
              if (m) {
                finalText = m;
                onDelta?.(m);
                log(`step ${step} emitted tool markdown`, { len: m.length });
                break;
              }
            }
          } catch {}
          continue;
        } catch (e: any) {
          const err = String(e?.message || e || 'tool error');
          steps[steps.length - 1].observation = { error: err };
          scratchpad.push(`Step ${step} tool ${String(decision.tool?.name || '')}: ERROR ${err}`);
          onAnalysis?.(`Tool ${String(decision.tool?.name || '')} error: ${err}`);
          log(`step ${step} tool error`, { error: err });
          continue;
        }
      }
      onAnalysis?.('Unknown decision; stopping.');
      log(`step ${step} unknown-decision`, decision);
      break;
    }

    if (!finalText.trim() && observedMarkdowns.length) {
      finalText = observedMarkdowns.join('\n\n');
    }
    log('complete', { textLen: finalText.length, steps: steps.length });
    return { finalText, steps, model };
  }
}


