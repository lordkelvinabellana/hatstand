export interface Message {
  role: 'user' | 'assistant';
  text: string;
}

export function lastMessages(transcript: string, count: number): Message[] {
  if (count <= 0) return [];
  const messages: Message[] = [];
  for (const line of transcript.split('\n')) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.isSidechain) continue;
    const content = entry.message?.content;
    if (entry.type === 'user' && typeof content === 'string' && !content.startsWith('<'))
      messages.push({ role: 'user', text: content });
    if (entry.type !== 'assistant' || !Array.isArray(content)) continue;
    const text = content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
    if (!text) continue;
    const previous = messages.at(-1);
    if (previous?.role === 'assistant') previous.text += `\n${text}`;
    else messages.push({ role: 'assistant', text });
  }
  return messages.slice(-count).map((message) => ({ ...message, text: message.text.slice(-2000) }));
}

/** A spoken one-liner for what the session last said: the end of its final message (where it asks), markdown stripped. */
export function brief(messages: Message[], max = 220): string {
  const last = [...messages].reverse().find((m) => m.role === 'assistant')?.text ?? '';
  const plain = last
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const picked: string[] = [];
  let length = 0;
  for (const sentence of (plain.match(/\S.*?(?:[.!?](?=\s|$)|$)/g) ?? []).reverse()) {
    if (picked.length && length + sentence.length > max) break;
    picked.unshift(sentence.trim());
    length += sentence.length;
  }
  return picked.join(' ').slice(-max);
}
