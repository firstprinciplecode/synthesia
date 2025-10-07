import { memoryService } from '../memory/memory-service.js';
import { db, agents, actors } from '../db/index.js';
import { eq } from 'drizzle-orm';

export interface ParticipationCandidate {
	agentId: string;
	name: string;
	score: number;
	reason: string;
}

export class ParticipationRouter {
	private readonly MAX_AGENTS: number;

	constructor(maxAgents: number = 5) {
		this.MAX_AGENTS = maxAgents;
	}

	// Basic mention parsing: returns explicit agentId list and @all flag
	parseMentions(text: string, roomAgentIds: string[], agentIdByName: Map<string, string>): { all: boolean; mentionedIds: string[] } {
		const lower = String(text || '').toLowerCase();
		const all = /(^|\W)@all(\W|$)/i.test(text);
		const mentionedIds: string[] = [];
		const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		for (const [name, id] of agentIdByName.entries()) {
			const full = String(name || '').toLowerCase();
			const first = full.split(/\s+/)[0] || full;
			const slug = full.replace(/\s+/g, '');
			// Also recognize @v33-style handles by stripping spaces and punctuation
			const handle = '@' + slug;
			const candidates = [full, first, slug, handle.replace(/^@/, '')].filter(Boolean);
			for (const c of candidates) {
				const pattern = new RegExp(`(^|\\W)@${escape(c)}(\\W|$)`);
				if (pattern.test(lower) && roomAgentIds.includes(id)) { mentionedIds.push(id); break; }
			}
		}
		// Deduplicate while preserving order to make selection deterministic when duplicate handles exist
		const seen = new Set<string>();
		const unique = mentionedIds.filter((aid) => { if (seen.has(aid)) return false; seen.add(aid); return true; });
		return { all, mentionedIds: unique };
	}

	// Placeholder similarity using keywords only for now; future: embeddings
	private computeKeywordScore(message: string, keywords: string[] | null | undefined): number {
		if (!keywords || keywords.length === 0) return 0;
		const text = message.toLowerCase();
		for (const k of keywords) {
			if (!k) continue;
			if (text.includes(String(k).toLowerCase())) {
				// Any match yields a positive decision (1.0). Thresholds then gate the response.
				return 1;
			}
		}
		return 0;
	}

	private getAgentRoomInterest(agentRow: any): { tokens: string[]; threshold: number } {
		try {
			const tp = (agentRow?.toolPreferences || {}) as any;
			const roomCfg = tp?.roomConfig || {};
			const pubCfg = tp?.publicConfig || {};
			const enabled = !!roomCfg?.enabled;
			const roomTokens: string[] = Array.isArray(roomCfg?.interests) ? roomCfg.interests : [];
			const publicTokens: string[] = Array.isArray(pubCfg?.interests) ? pubCfg.interests : [];
			const tokens = enabled && roomTokens.length ? roomTokens : publicTokens;
			const threshold = typeof roomCfg?.matchThreshold === 'number'
				? Math.max(0.3, Math.min(0.95, roomCfg.matchThreshold))
				: (typeof pubCfg?.publicMatchThreshold === 'number' ? pubCfg.publicMatchThreshold : 0.7);
			return { tokens: tokens.filter((t: any) => typeof t === 'string' && t.trim().length > 0), threshold };
		} catch {
			return { tokens: [], threshold: 0.7 };
		}
	}

	async scoreAgentsForMessage(roomId: string, message: string, eligibleAgentIds: string[]): Promise<ParticipationCandidate[]> {
		// Load agents
		const rows = await db.select().from(agents).where(eq(agents.id as any, eligibleAgentIds[0] as any));
		// NOTE: Drizzle doesn't support IN here in this quick skeleton; fetch individually
		const infos: any[] = [];
		for (const aid of eligibleAgentIds) {
			try {
				const r = await db.select().from(agents).where(eq(agents.id as any, aid as any));
				if (r.length) infos.push(r[0]);
			} catch {}
		}

		// Load actor capability tags for these agents (via actors.settings.agentId)
		const capsByAgentId = new Map<string, string[]>();
		try {
			const list = await db.select().from(actors).where(eq(actors.type as any, 'agent' as any));
			for (const act of list as any[]) {
				const aid = act?.settings?.agentId;
				if (aid && eligibleAgentIds.includes(aid)) {
					const tags = Array.isArray(act.capabilityTags) ? (act.capabilityTags as string[]) : [];
					capsByAgentId.set(aid, tags);
				}
			}
		} catch {}

		const scored: ParticipationCandidate[] = infos
			.map((a) => {
				const { tokens, threshold } = this.getAgentRoomInterest(a);
				const interestScore = this.computeKeywordScore(message, tokens);
				const tagScore = this.computeKeywordScore(message, capsByAgentId.get(a.id) || []);
				const score = Math.max(interestScore, tagScore);
				const reason = tagScore > interestScore
					? 'capability tag match'
					: (interestScore > 0 ? 'room/public interest match' : 'low relevance');
				// Only keep agents meeting threshold
				if (score < Math.max(0.01, threshold)) return null;
				return { agentId: a.id, name: a.name, score, reason } as ParticipationCandidate;
			})
			.filter((c): c is ParticipationCandidate => !!c);

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, this.MAX_AGENTS);
	}
}
