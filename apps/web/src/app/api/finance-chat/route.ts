/**
 * Flying Co-Pilot chat endpoint. Resolves the member's own AI provider/model
 * (their key), streams a tool-calling conversation over their flying + finance
 * data. memberId comes from the session only — never the request body.
 *
 * See docs/flying-copilot-design.md §7.
 */

import { type UIMessage, convertToModelMessages, stepCountIs, streamText } from "ai";
import { UI_TOOLS, buildFinanceTools } from "@/lib/ai/tools";
import { COPILOT_SYSTEM } from "@/lib/ai/prompt";
import { resolveMemberModel } from "@/lib/ai/provider";
import { getSession } from "@/lib/session";

export const maxDuration = 30;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const resolved = await resolveMemberModel(session.tornId);
  if (!resolved) {
    return Response.json(
      { error: "No AI configured. Add your provider and key in the AI co-pilot settings." },
      { status: 400 },
    );
  }

  let messages: UIMessage[];
  try {
    ({ messages } = (await req.json()) as { messages: UIMessage[] });
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const result = streamText({
    model: resolved.model,
    system: COPILOT_SYSTEM,
    messages: await convertToModelMessages(messages),
    tools: { ...buildFinanceTools(session.tornId), ...UI_TOOLS },
    stopWhen: stepCountIs(6),
  });

  // Map provider/runtime errors to a safe message — never echo the error (it
  // can contain the Authorization header / key).
  return result.toUIMessageStreamResponse({
    onError: () =>
      `The AI request failed via ${resolved.providerLabel}. Check your key, model, and quota in AI co-pilot settings.`,
  });
}
