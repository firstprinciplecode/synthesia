export function formatXSearchMarkdown(result: any, query: string): string {
  const data: any[] = Array.isArray(result?.data) ? result.data : [];
  const users: Record<string, any> = Object.fromEntries((result?.includes?.users || []).map((u: any) => [u.id, u]));
  const mediaByKey: Record<string, any> = Object.fromEntries((result?.includes?.media || []).map((m: any) => [m.media_key, m]));

  const toTweetUrl = (username?: string, id?: string) =>
    username ? `https://twitter.com/${username}/status/${id}` : `https://twitter.com/i/web/status/${id}`;

  const escapeMd = (s: string) => String(s ?? '')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\|/g, '\\|');

  const blocks: string[] = [];

  for (const t of data.slice(0, 10)) {
    const u = users[t.author_id] || {};
    const viewUrl = toTweetUrl(u.username, t.id);
    const nameDisplay = u.name || (u.username ? `@${u.username}` : 'Unknown');

    // Tweet text (unchanged except minimal escaping to avoid markdown collisions)
    const text = escapeMd(String(t.text || ''));
    const quote = text.split(/\r?\n/).map((line: string) => `> ${line}`).join('\n');

    // Engagement
    const likes = t.public_metrics?.like_count ?? 0;
    const rts = t.public_metrics?.retweet_count ?? 0;
    const replies = t.public_metrics?.reply_count ?? 0;
    const bookmarks = t.public_metrics?.bookmark_count ?? 0;
    const engagement = `❤️ ${likes} · 🔁 ${rts} · 💬 ${replies} · 🔖 ${bookmarks}`;

    // Media (photos only for now)
    const media = (t.attachments?.media_keys || [])
      .map((k: string) => mediaByKey[k])
      .filter(Boolean);
    let mediaBlock = '';
    const photos = media.filter((m: any) => m?.type === 'photo' && m?.url);
    if (photos.length) {
      mediaBlock += '\n';
      for (const m of photos) mediaBlock += `![image](${m.url})\n`;
    }

    // Create side-by-side layout: avatar on left, content on right
    const contentLines: string[] = [];
    if (u.username) contentLines.push(`[${escapeMd(nameDisplay)}](https://twitter.com/${u.username})`);
    else contentLines.push(escapeMd(nameDisplay));
    contentLines.push('');
    contentLines.push(quote);
    contentLines.push('');
    contentLines.push(engagement);
    if (mediaBlock.trimEnd()) contentLines.push(mediaBlock.trimEnd());
    contentLines.push('');
    contentLines.push(`[View](${viewUrl})`);
    
    const contentBlock = contentLines.join('\n');
    
    let block = '';
    if (u.profile_image_url) {
      block = `![avatar](${u.profile_image_url})\n${contentBlock}`;
    } else {
      block = contentBlock;
    }

    blocks.push(block);
  }

  return blocks.length ? `X search for "${query}":\n\n${blocks.join('\n\n---\n\n')}` : 'No results.';
}


