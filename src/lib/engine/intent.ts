import type { ReplyIntent } from "@prisma/client";

/**
 * Works out what a reply means, so interested people get the booking link straight away
 * and "not interested" or "remove me" never get another email.
 *
 * Rules first (fast, free, predictable). If ANTHROPIC_API_KEY is set, an AI model reads the
 * reply instead and the rules are the fallback when it is unavailable.
 */

export const INTENT_LABEL: Record<ReplyIntent, string> = {
  INTERESTED: "Interested",
  QUESTION: "Has a question",
  NOT_NOW: "Not right now",
  NOT_INTERESTED: "Not interested",
  UNSUBSCRIBE: "Asked to be removed",
  WRONG_PERSON: "Wrong person",
  OTHER: "Other",
};

export const INTENTS = Object.keys(INTENT_LABEL) as ReplyIntent[];

/** Removes quoted history, signatures and greetings so only what the person wrote is classified. */
export function cleanReply(text: string): string {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (/^>/.test(line)) continue;
    if (/^(on .+wrote:|-{2,}\s*original message|from:\s|sent from my|get outlook for)/i.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

const RULES: [ReplyIntent, RegExp][] = [
  ["UNSUBSCRIBE", /\b(unsubscribe|remove me|take me off|stop (e-?mailing|contacting|sending|writing)|do not (contact|e-?mail)|don'?t (contact|e-?mail|write)|opt[ -]?out|no more emails)\b/i],
  ["WRONG_PERSON", /(not the right (person|contact)|wrong (person|contact)|no longer (work|with|at)|(left|leaving) the company|isn'?t my (area|department)|better (person|contact) (would be|is)|you should (reach|speak|talk|contact)|please (reach out|contact|speak) to my colleague)/i],
  ["NOT_INTERESTED", /(not interested|no interest|no,? thanks|no thank you|not a (good )?fit|not relevant|we'?re (all )?(set|good)|we are (all )?(set|good)|already (have|use|using|work(ing)? with)|pass on this|not for us|no need|not looking)/i],
  ["NOT_NOW", /(not (right )?now|maybe later|(next|in a few|in the new) (quarter|year|month|weeks|months)|circle back|reach out (again )?(in|after|later)|bad timing|timing isn'?t right|busy (right now|at the moment|until)|after the holidays|early next year|in (january|february|march|q[1-4]))/i],
  ["INTERESTED", /(\binterested\b|let'?s (talk|chat|connect|meet|set|schedule|book|do it)|sounds (good|great|interesting)|happy to (chat|talk|connect|meet|hop)|open to (a )?(chat|call|conversation|meeting)|set up (a )?(call|time|meeting|chat)|(book|schedule|arrange) (a )?(call|time|meeting|demo|chat)|send (me |over )?(a |your )?(calendar|link|calendly|times|availability)|what (times?|does your (calendar|availability))|when are you (free|available)|i'?m (free|available)|are you (free|available)|\bdemo\b|tell me more|learn more|more (info|information|details)|(call|ring) me|give me a call|\byes\b|\bsure\b|absolutely|would love to|love to (chat|talk|learn)|worth a (chat|call|conversation))/i],
];

export function classifyByRules(text: string): ReplyIntent {
  const t = cleanReply(text);
  if (!t) return "OTHER";
  for (const [intent, re] of RULES) if (re.test(t)) return intent;
  if (t.includes("?")) return "QUESTION";
  return "OTHER";
}

async function classifyWithAi(text: string): Promise<ReplyIntent | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 10,
        system:
          "You sort replies to B2B cold emails. Answer with exactly one label: INTERESTED (wants a call, a demo, more info, or says yes), QUESTION (asks something before deciding), NOT_NOW (maybe later), NOT_INTERESTED, UNSUBSCRIBE (asks to stop or be removed), WRONG_PERSON (points to someone else or left), OTHER.",
        messages: [{ role: "user", content: cleanReply(text).slice(0, 2000) || "(empty)" }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[] };
    const label = (data.content?.[0]?.text ?? "").trim().toUpperCase().replace(/[^A-Z_]/g, "");
    return (INTENTS as string[]).includes(label) ? (label as ReplyIntent) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function classifyReply(text: string): Promise<{ intent: ReplyIntent; by: "ai" | "rules" }> {
  const ai = await classifyWithAi(text);
  if (ai) return { intent: ai, by: "ai" };
  return { intent: classifyByRules(text), by: "rules" };
}
