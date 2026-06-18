import { AI_PROVIDERS } from "@torn/shared";
import { getAiConfig } from "@/app/(dash)/finance/ai-actions";
import { AiSettingsForm } from "./AiSettingsForm";

/**
 * Server wrapper for the Flying Co-Pilot AI config. Reads the member's masked
 * status (never the key) and hands the static provider registry to the client
 * form. See docs/flying-copilot-design.md §10.
 */
export async function AiSettings() {
  const initial = await getAiConfig();
  return <AiSettingsForm providers={AI_PROVIDERS} initial={initial} />;
}
