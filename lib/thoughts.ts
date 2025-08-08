export const sequenceThoughts: Record<string, string> = {
  "1123": "Begin with two simple passes, then add structure and a fresh angle.",
  "3211": "Start complex, simplify, then reinforce the fundamentals twice.",
  "3422": "Explore widely, then stabilize with repeated execution.",
};

const fallbackThoughts = [
  "Focus the story: one sentence, one promise.",
  "Ship a smaller version; learn from reality.",
  "Ask a sharper question; better answers follow.",
  "Name the trade-off and choose it deliberately.",
  "Energy first, then efficiency.",
];

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function thoughtForSequence(seq: string): string {
  if (sequenceThoughts[seq]) return sequenceThoughts[seq];
  return fallbackThoughts[hashString(seq) % fallbackThoughts.length];
}
