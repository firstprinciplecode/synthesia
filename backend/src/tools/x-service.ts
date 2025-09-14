import { createHash, randomBytes } from 'crypto';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

type XTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number; // epoch ms
  scope?: string;
  token_type?: string;
  user?: { id: string; username?: string; name?: string };
};

const AUTH_BASE = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const API_BASE = 'https://api.twitter.com/2';

function toBase64Url(buffer: Buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export class XOauthStore {
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
    try { mkdirSync(dir, { recursive: true }); } catch {}
  }
  save(userId: string, tokens: XTokens) {
    const file = join(this.dir, `x-auth-${userId}.json`);
    writeFileSync(file, JSON.stringify(tokens, null, 2), 'utf8');
  }
  load(userId: string): XTokens | null {
    const file = join(this.dir, `x-auth-${userId}.json`);
    if (!existsSync(file)) return null;
    try {
      const json = JSON.parse(readFileSync(file, 'utf8')) as XTokens;
      return json;
    } catch {
      return null;
    }
  }
  clear(userId: string) {
    const file = join(this.dir, `x-auth-${userId}.json`);
    try { writeFileSync(file, '', 'utf8'); } catch {}
  }
}

class XService {
  private store: XOauthStore;
  private stateCache = new Map<string, { codeVerifier: string; userId: string }>();
  constructor() {
    this.store = new XOauthStore(join(process.cwd(), 'uploads'));
  }

  generatePkcePair() {
    const codeVerifier = toBase64Url(randomBytes(32));
    const codeChallenge = toBase64Url(createHash('sha256').update(codeVerifier).digest());
    return { codeVerifier, codeChallenge };
  }

  buildAuthUrl(params: { state: string; codeChallenge: string; redirectUri: string; scopes: string[] }) {
    const { state, codeChallenge, redirectUri, scopes } = params;
    const clientId = process.env.X_CLIENT_ID || process.env.X_ID || '';
    const url = new URL(AUTH_BASE);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('scope', scopes.join(' '));
    return url.toString();
  }

  createAuthStart(userId: string, redirectUri: string, scopes: string[]) {
    const { codeVerifier, codeChallenge } = this.generatePkcePair();
    const state = toBase64Url(randomBytes(16));
    this.stateCache.set(state, { codeVerifier, userId });
    const url = this.buildAuthUrl({ state, codeChallenge, redirectUri, scopes });
    return { url, state };
  }

  async exchangeCode(code: string, state: string, redirectUri: string) {
    const record = this.stateCache.get(state);
    if (!record) throw new Error('Invalid state');
    const clientId = process.env.X_CLIENT_ID || process.env.X_ID || '';
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: code,
      redirect_uri: redirectUri,
      code_verifier: record.codeVerifier,
    });
    const secret = process.env.X_CLIENT_SECRET || process.env.X_SECRET || '';
    const basic = secret ? Buffer.from(`${clientId}:${secret}`).toString('base64') : '';
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(basic ? { Authorization: `Basic ${basic}` } : {}),
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`X token exchange failed ${res.status}: ${text}`);
    }
    const json: any = await res.json();
    const now = Date.now();
    const tokens: XTokens = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_in: json.expires_in,
      expires_at: json.expires_in ? now + json.expires_in * 1000 : undefined,
      scope: json.scope,
      token_type: json.token_type,
    };
    // Fetch user identity
    try {
      const me = await this.getMe(tokens.access_token);
      tokens.user = me;
    } catch {}
    this.store.save(record.userId, tokens);
    this.stateCache.delete(state);
    return { userId: record.userId, tokens };
  }

  async refresh(userId: string): Promise<XTokens | null> {
    const saved = this.store.load(userId);
    if (!saved?.refresh_token) return saved || null;
    if (saved.expires_at && saved.expires_at - Date.now() > 60_000) return saved;
    const clientIdRefresh = process.env.X_CLIENT_ID || process.env.X_ID || '';
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: saved.refresh_token,
      client_id: clientIdRefresh,
    });
    const clientId = clientIdRefresh;
    const secret = process.env.X_CLIENT_SECRET || process.env.X_SECRET || '';
    const basic = secret ? Buffer.from(`${clientId}:${secret}`).toString('base64') : '';
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(basic ? { Authorization: `Basic ${basic}` } : {}),
      },
      body: body.toString(),
    });
    if (!res.ok) return saved;
    const json: any = await res.json();
    const now = Date.now();
    const tokens: XTokens = {
      access_token: json.access_token,
      refresh_token: json.refresh_token || saved.refresh_token,
      expires_in: json.expires_in,
      expires_at: json.expires_in ? now + json.expires_in * 1000 : undefined,
      scope: json.scope || saved.scope,
      token_type: json.token_type || saved.token_type,
      user: saved.user,
    };
    this.store.save(userId, tokens);
    return tokens;
  }

  getSaved(userId: string): XTokens | null {
    return this.store.load(userId);
  }

  disconnect(userId: string) {
    this.store.clear(userId);
  }

  async getMe(accessToken: string): Promise<{ id: string; username?: string; name?: string }> {
    const res = await fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`getMe failed ${res.status}`);
    const json: any = await res.json();
    const d = json.data || {};
    return { id: d.id, username: d.username, name: d.name };
  }

  async postTweet(userId: string, text: string): Promise<any> {
    const tokens = (await this.refresh(userId)) || this.getSaved(userId);
    if (!tokens?.access_token) throw new Error('Not connected to X');
    const res = await fetch(`${API_BASE}/tweets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`tweet failed ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async sendDm(userId: string, recipientId: string, text: string): Promise<any> {
    const tokens = (await this.refresh(userId)) || this.getSaved(userId);
    if (!tokens?.access_token) throw new Error('Not connected to X');
    const url = `${API_BASE}/dm_conversations/with/${encodeURIComponent(recipientId)}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`dm failed ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async searchRecent(userId: string, query: string, maxResults = 10): Promise<any> {
    const tokens = (await this.refresh(userId)) || this.getSaved(userId);
    if (!tokens?.access_token) throw new Error('Not connected to X');
    const url = new URL(`${API_BASE}/tweets/search/recent`);
    url.searchParams.set('query', query);
    url.searchParams.set('max_results', String(Math.min(Math.max(maxResults, 10), 100)));
    // Request rich fields + expansions so we can reconstruct full context
    url.searchParams.set('tweet.fields', 'created_at,author_id,public_metrics,lang,entities,referenced_tweets,attachments');
    url.searchParams.set('expansions', 'author_id,referenced_tweets.id,referenced_tweets.id.author_id,attachments.media_keys,entities.mentions.username');
    url.searchParams.set('user.fields', 'name,username,profile_image_url,verified');
    url.searchParams.set('media.fields', 'media_key,type,url,preview_image_url,width,height');
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!res.ok) throw new Error(`search failed ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async getOwnedLists(userId: string): Promise<any> {
    const tokens = (await this.refresh(userId)) || this.getSaved(userId);
    if (!tokens?.access_token || !tokens.user?.id) throw new Error('Not connected to X');
    const res = await fetch(`${API_BASE}/users/${tokens.user.id}/owned_lists`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!res.ok) throw new Error(`owned_lists failed ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async getUserByUsername(userId: string, username: string): Promise<{ id: string; username?: string; name?: string } | null> {
    const tokens = (await this.refresh(userId)) || this.getSaved(userId);
    if (!tokens?.access_token) throw new Error('Not connected to X');
    const handle = username.replace(/^@/, '');
    const res = await fetch(`${API_BASE}/users/by/username/${encodeURIComponent(handle)}`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!res.ok) return null;
    const json: any = await res.json();
    const d = json.data || {};
    return d?.id ? { id: d.id, username: d.username, name: d.name } : null;
  }

  async getOwnedListsByUsername(userId: string, username: string): Promise<any> {
    const tokens = (await this.refresh(userId)) || this.getSaved(userId);
    if (!tokens?.access_token) throw new Error('Not connected to X');
    const user = await this.getUserByUsername(userId, username);
    if (!user?.id) throw new Error('Target user not found');
    const res = await fetch(`${API_BASE}/users/${user.id}/owned_lists`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!res.ok) throw new Error(`owned_lists (by username) failed ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async getListTweets(userId: string, listId: string, maxResults = 20): Promise<any> {
    const tokens = (await this.refresh(userId)) || this.getSaved(userId);
    if (!tokens?.access_token) throw new Error('Not connected to X');
    const url = new URL(`${API_BASE}/lists/${encodeURIComponent(listId)}/tweets`);
    url.searchParams.set('max_results', String(Math.min(Math.max(maxResults, 5), 100)));
    url.searchParams.set('tweet.fields', 'created_at,author_id,public_metrics,lang');
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!res.ok) throw new Error(`list tweets failed ${res.status}: ${await res.text()}`);
    return await res.json();
  }
}

export const xService = new XService();


